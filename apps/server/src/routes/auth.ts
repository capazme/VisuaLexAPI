import { createHash } from 'node:crypto';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { RateLimiterRes, type RateLimiterAbstract } from 'rate-limiter-flexible';
import * as authController from '../controllers/authController';
import { authenticate } from '../middleware/auth';
import { createLimiter, getClientIp } from '../middleware/rateLimiter';

const router = Router();

/**
 * The limits on signing in, registering and refreshing (scan B). They are counted where every other limit is
 * (`createLimiter`: Redis, shared by every server process and kept across a restart, with a limiter in memory
 * behind it when Redis fails), no longer in each process's memory alone.
 *
 * - Failed sign-ins and registrations from one address: 5 in 15 minutes, as before. Sign-in and registration
 *   share the count, as before, and so do the account's routes that check its password (changing it, removing
 *   one's contributions, deleting the account): a stolen session cannot be used to guess it from one address.
 * - Failed attempts on those three routes for one account, from any address (a wrong password, or any other
 *   refusal): 10 in an hour, keyed by the signed-in user's id, so a stolen session cannot guess through many
 *   addresses either. It is not the sign-in's count, so the owner can always sign in. The price: a thief holding
 *   the session can, with 10 wrong tries, stop the owner changing the password or deleting the account for up to
 *   an hour, again each hour. Ending every web session (POST /auth/logout-all) needs no password, so the owner
 *   can throw out a thief holding one; it does not end the access and refresh tokens the web still signs in
 *   with until it moves to the session cookie (spec #517, step 2).
 * - Failed sign-ins for one account, from any address: 10 in an hour. The account is the email as typed,
 *   trimmed and lower-cased, whether or not an account has it, so the answer says nothing about which emails
 *   exist; the key is its SHA-256, so no email is written in Redis. Someone who knows a person's email can
 *   block that person's sign-in for up to an hour this way: the price of stopping guesses spread over many
 *   addresses.
 * - Refreshes from one address: 30 a minute, failed or not (before, only the general limit of 100).
 *
 * An attempt is counted when it arrives, so a burst sent all at once is held like attempts one after the
 * other, and given back when it succeeds (an answer under 400): only failures count, as before. A refusal is
 * a 429 with Retry-After, which the web turns into «Troppe richieste in poco tempo. Riprova tra N minuti.»
 */
export const FAILED_ATTEMPTS_PER_ADDRESS = 5;
export const ADDRESS_WINDOW_SECONDS = 15 * 60;
export const FAILED_SIGN_INS_PER_ACCOUNT = 10;
export const ACCOUNT_WINDOW_SECONDS = 60 * 60;
export const FAILED_PASSWORD_CHECKS_PER_USER = 10;
export const USER_WINDOW_SECONDS = 60 * 60;
export const REFRESHES_PER_ADDRESS = 30;
const REFRESH_WINDOW_SECONDS = 60;

const attemptsByAddress = createLimiter('rl:auth-attempts-ip', FAILED_ATTEMPTS_PER_ADDRESS, ADDRESS_WINDOW_SECONDS);
const signInsByAccount = createLimiter('rl:auth-attempts-account', FAILED_SIGN_INS_PER_ACCOUNT, ACCOUNT_WINDOW_SECONDS);
const passwordChecksByUser = createLimiter('rl:password-checks-user', FAILED_PASSWORD_CHECKS_PER_USER, USER_WINDOW_SECONDS);
const refreshesByAddress = createLimiter('rl:auth-refresh-ip', REFRESHES_PER_ADDRESS, REFRESH_WINDOW_SECONDS);

/** The account a sign-in names: the SHA-256 of the email as typed, trimmed and lower-cased; null without one. */
function accountKey(req: Request): string | null {
  const email: unknown = req.body?.email;
  if (typeof email !== 'string') return null;
  const normal = email.trim().toLowerCase();
  if (!normal) return null;
  return createHash('sha256').update(normal).digest('hex');
}

function tooManyAttempts(res: Response, limiterRes: RateLimiterRes): void {
  res.set('Retry-After', String(Math.max(1, Math.ceil(limiterRes.msBeforeNext / 1000))));
  res.status(429).json({ detail: 'Too many authentication attempts, please try again later' });
}

/**
 * Counts an attempt by address and, for a sign-in, by the account it names, or, on a route behind the session,
 * by the signed-in user; gives it back when the attempt succeeds.
 */
function countFailedAttempts(options: { perAccount: boolean; perUser?: boolean }): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const counted: Array<[RateLimiterAbstract, string]> = [];
    try {
      const address = getClientIp(req);
      await attemptsByAddress.consume(address);
      counted.push([attemptsByAddress, address]);
      const account = options.perAccount ? accountKey(req) : null;
      if (account) {
        await signInsByAccount.consume(account);
        counted.push([signInsByAccount, account]);
      }
      const user = options.perUser && req.user ? String(req.user.id) : null;
      if (user) {
        await passwordChecksByUser.consume(user);
        counted.push([passwordChecksByUser, user]);
      }
    } catch (err) {
      if (err instanceof RateLimiterRes) {
        // Refused by the account's or the user's limit after the address counted it: the attempt never reached a password
        // check, so the address gets its point back. Otherwise a blocked account would block, in turn, everyone
        // behind its owner's address (an office behind one NAT).
        for (const [limiter, key] of counted) {
          limiter.reward(key, 1).catch((rewardErr: unknown) => {
            console.error('[auth] attempts limiter reward failed:', rewardErr instanceof Error ? rewardErr.message : rewardErr);
          });
        }
        tooManyAttempts(res, err);
        return;
      }
      // Neither Redis nor the memory behind it answered: let the attempt through, as a last resort.
      console.error('[auth] attempts limiter error (fail-open):', err instanceof Error ? err.message : err);
    }
    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      for (const [limiter, key] of counted) {
        limiter.reward(key, 1).catch((err: unknown) => {
          console.error('[auth] attempts limiter reward failed:', err instanceof Error ? err.message : err);
        });
      }
    });
    next();
  };
}

const limitRefreshes: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await refreshesByAddress.consume(getClientIp(req));
  } catch (err) {
    if (err instanceof RateLimiterRes) {
      tooManyAttempts(res, err);
      return;
    }
    console.error('[auth] refresh limiter error (fail-open):', err instanceof Error ? err.message : err);
  }
  next();
};

// Public routes (with stricter rate limiting)
router.post('/auth/register', countFailedAttempts({ perAccount: false }), authController.register);
router.post('/auth/login', countFailedAttempts({ perAccount: true }), authController.login);
router.post('/auth/refresh', limitRefreshes, authController.refresh);
// Sign-out needs no live session: it ends whatever this browser's cookie names, and clears it (A.1).
router.post('/auth/logout', authController.logout);

// Protected routes. GET /auth/me, the session check, is mounted in app.ts before the general limiter, with its
// own (G-484).
router.put('/auth/dev-mode', authenticate, authController.setDevMode);
// The web's sessions (A.1, D5): the list, one ended, all ended.
router.get('/auth/sessions', authenticate, authController.listSessions);
router.delete('/auth/sessions/:id', authenticate, authController.deleteSession);
router.post('/auth/logout-all', authenticate, authController.logoutAll);
router.get('/auth/export', authenticate, authController.exportAccountData);
// These three check the password: a wrong one counts as a failed attempt from the address, as a sign-in does, and
// for the user from any address, so a stolen session cannot be used to guess it.
const countPasswordChecks = countFailedAttempts({ perAccount: false, perUser: true });
router.put('/auth/change-password', authenticate, countPasswordChecks, authController.changePassword);
router.post('/auth/contributions/remove', authenticate, countPasswordChecks, authController.removeOwnContributions);
router.delete('/auth/account', authenticate, countPasswordChecks, authController.deleteAccount);

export default router;
