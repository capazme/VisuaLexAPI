import express, { type NextFunction, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { RateLimiterRes, type RateLimiterAbstract } from 'rate-limiter-flexible';
import { prisma } from '../lib/prisma';
import { DELETE_SCOPE, oauthConfig } from '../oauth/config';
import { ACTOR, delegationSecret } from '../oauth/delegationSecret';
import { findDelegatedRoute, type DelegatedCounter } from '../oauth/delegatedRoutes';
import type { DelegatedClaims } from '../oauth/exchange';
import { createLimiter } from './rateLimiter';

const DAY_SECONDS = 24 * 60 * 60;

/** The daily allowance of delegated calls (spec section 6: placeholders to calibrate). */
export const DELEGATED_DAILY_POINTS = parseInt(process.env.OAUTH_DAILY_POINTS || '500', 10);
/** Named daily counters beside the points: how many of each a connected application may do a day. */
export const DELEGATED_COUNTERS: Record<DelegatedCounter, number> = {
  dossier_create: 10,
  note: 100,
  trash: 20,
  card: 100,
};

const COUNTER_WORDS: Record<DelegatedCounter, string> = {
  dossier_create: 'dossier creati',
  note: 'note scritte',
  trash: 'eliminazioni',
  card: 'schede create',
};

// Created on first use: the Redis client, when enabled, is read then.
let points: RateLimiterAbstract | undefined;
const counters: Partial<Record<DelegatedCounter, RateLimiterAbstract>> = {};
const pointsLimiter = () => (points ??= createLimiter('rl:mcp-points', DELEGATED_DAILY_POINTS, DAY_SECONDS));
const counterLimiter = (name: DelegatedCounter) =>
  (counters[name] ??= createLimiter(`rl:mcp-${name.replace('_', '-')}`, DELEGATED_COUNTERS[name], DAY_SECONDS));

/** Spends a user's delegated points, as calls would (tests use it to reach the limit). */
export async function spendDelegatedQuota(userId: string, amount: number): Promise<void> {
  await pointsLimiter().penalty(userId, amount);
}

/** Spends one of a user's named daily counters, as calls would (tests use it to reach the limit). */
export async function spendDelegatedCounter(userId: string, counter: DelegatedCounter, amount: number): Promise<void> {
  await counterLimiter(counter).penalty(userId, amount);
}

export interface QuotaLine {
  limit: number;
  remaining: number;
  /** When the window renews; null when nothing has been spent in it. */
  resetsAt: string | null;
}

async function line(limiter: RateLimiterAbstract, limit: number, userId: string): Promise<QuotaLine> {
  const state = await limiter.get(userId);
  if (!state) return { limit, remaining: limit, resetsAt: null };
  return {
    limit,
    remaining: Math.max(0, limit - state.consumedPoints),
    resetsAt: new Date(Date.now() + state.msBeforeNext).toISOString(),
  };
}

/** What is left of the user's delegated allowance today (`GET /api/oauth/quota`). */
export async function delegatedQuotaStatus(userId: string) {
  const names = Object.keys(DELEGATED_COUNTERS) as DelegatedCounter[];
  const lines = await Promise.all(names.map((name) => line(counterLimiter(name), DELEGATED_COUNTERS[name], userId)));
  return {
    points: await line(pointsLimiter(), DELEGATED_DAILY_POINTS, userId),
    counters: Object.fromEntries(names.map((name, i) => [name, lines[i]])) as Record<DelegatedCounter, QuotaLine>,
  };
}

async function refund(userId: string, points: number, counter: DelegatedCounter | null): Promise<void> {
  try {
    if (points > 0) await pointsLimiter().reward(userId, points);
    if (counter) await counterLimiter(counter).reward(userId, 1);
  } catch (error) {
    console.error('delegatedAuth: refund failed:', error instanceof Error ? error.message : error);
  }
}

function refuse(res: Response, status: 401 | 403, detail: string, error: string): void {
  if (status === 401) res.setHeader('WWW-Authenticate', `Bearer error="${error}"`);
  res.status(status).json({ detail, error });
}

function overQuota(res: Response, quota: 'points' | DelegatedCounter, limit: RateLimiterRes): void {
  const seconds = Math.max(1, Math.ceil(limit.msBeforeNext / 1000));
  res.setHeader('Retry-After', String(seconds));
  res.status(429).json({
    detail:
      quota === 'points'
        ? 'Limite giornaliero delle operazioni tramite applicazioni collegate raggiunto.'
        : `Limite giornaliero di ${COUNTER_WORDS[quota]} tramite applicazioni collegate raggiunto.`,
    quota,
    resetsAt: new Date(Date.now() + limit.msBeforeNext).toISOString(),
  });
}

/**
 * A JWT that claims to be an exchanged token: it names an actor. Decoded
 * without verification, only to decide which path the request takes; the
 * delegated path then verifies it strictly, and nothing else ever trusts it.
 */
function looksDelegated(token: string): boolean {
  try {
    const decoded = jwt.decode(token);
    return typeof decoded === 'object' && decoded !== null && 'act' in decoded;
  } catch {
    // A header that says JWT over a payload that is not JSON: not ours, and
    // the session path answers it with a 401.
    return false;
  }
}

const parseJson = express.json({ limit: '2mb' });

/**
 * Authentication for an exchanged token (spec section 5), mounted on `/api`
 * before the general limiter. A request without one passes through untouched
 * to the user-session path. With one, in order:
 * - the token verifies with the delegation secret, for the API audience and
 *   this issuer, with the MCP server as actor (else 401);
 * - the route is in `DELEGATED_ROUTES` (else 403, whatever the scope: default
 *   deny), and the token's scope covers it (else 403 `insufficient_scope`);
 * - its grant is still live and its user active (else 401), so a revoked
 *   connection stops before the token expires;
 * - the daily quota: points by route, and the named counters (else 429).
 * Then `req.user` and `req.delegation` are set, and `authenticate` lets the
 * request through as it is.
 */
export async function delegatedAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  const token = header.slice(7);
  if (!looksDelegated(token)) return next();

  const secret = delegationSecret();
  let claims: DelegatedClaims;
  try {
    if (!secret) throw new Error('no delegation secret');
    claims = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      audience: oauthConfig.apiAudience,
      issuer: oauthConfig.issuer,
    }) as DelegatedClaims;
    if (claims.act?.sub !== ACTOR || typeof claims.grant !== 'string' || typeof claims.scope !== 'string') {
      throw new Error('not an exchanged token');
    }
  } catch {
    return refuse(res, 401, 'Token non valido o scaduto.', 'invalid_token');
  }

  const route = findDelegatedRoute(req.method, req.path);
  if (!route) return refuse(res, 403, 'Operazione non consentita alle applicazioni collegate.', 'forbidden');
  if (!claims.scope.split(' ').includes(route.scope)) {
    return refuse(res, 403, 'Il collegamento non autorizza questa operazione.', 'insufficient_scope');
  }

  let user;
  // The name the application registered with (unverified): the mark on what it creates.
  let clientName: string | null = null;
  try {
    const grant = await prisma.oAuthGrant.findUnique({
      where: { id: claims.grant },
      include: { user: true, client: { select: { clientName: true } } },
    });
    if (!grant || grant.revokedAt || grant.userId !== claims.sub || !grant.user.isActive) {
      return refuse(res, 401, 'Il collegamento è stato revocato.', 'invalid_token');
    }
    // Deletion is read live from the grant (spec §4.2): a token exchanged before the
    // user switched it off must not delete after.
    // And deleting needs reading what is deleted: a connection granted write and delete only cannot.
    if (route.scope === DELETE_SCOPE && (!grant.scopes.includes(DELETE_SCOPE) || (route.readScope && !grant.scopes.includes(route.readScope)))) {
      return refuse(res, 403, 'Il collegamento non autorizza più le eliminazioni.', 'insufficient_scope');
    }
    user = grant.user;
    clientName = grant.client.clientName ?? null;
  } catch (error) {
    console.error('delegatedAuth: could not read the grant:', error instanceof Error ? error.message : error);
    res.status(503).json({ detail: 'Servizio temporaneamente non disponibile, riprova tra poco.' });
    return;
  }

  // The weight of some routes depends on the body: parse it here (the app's
  // parser, later, sees it parsed and skips). Only JSON: a form body would be
  // parsed after the weight was set and could carry 50 references for the
  // price of none.
  if (req.method === 'POST') {
    if (!req.is('application/json')) {
      res.status(415).json({ detail: 'Le applicazioni collegate inviano JSON.', error: 'unsupported_media_type' });
      return;
    }
    await new Promise<void>((resolve) => parseJson(req, res, () => resolve()));
    if (res.headersSent) return;
  }
  const weight = typeof route.weight === 'function' ? route.weight(req) : route.weight;

  let charged = 0;
  try {
    if (weight > 0) {
      await pointsLimiter().consume(user.id, weight);
      charged = weight;
    }
  } catch (error) {
    if (error instanceof RateLimiterRes) return overQuota(res, 'points', error);
    console.error('delegatedAuth: quota limiter error (fail-open):', error instanceof Error ? error.message : error);
  }
  let counted: DelegatedCounter | null = null;
  if (route.counter) {
    try {
      await counterLimiter(route.counter).consume(user.id, 1);
      counted = route.counter;
    } catch (error) {
      if (error instanceof RateLimiterRes) {
        await refund(user.id, charged, null);
        return overQuota(res, route.counter, error);
      }
      console.error('delegatedAuth: counter limiter error (fail-open):', error instanceof Error ? error.message : error);
    }
  }
  // A call that ends refused (4xx, 5xx) costs nothing; a route may also hand
  // back part of the charge (the norms route, for references it could not check).
  res.on('finish', () => {
    const back = res.statusCode >= 400 ? charged : Math.min(charged, Number(res.locals.delegatedRefund) || 0);
    const counterBack = res.statusCode >= 400 ? counted : null;
    if (back > 0 || counterBack) void refund(user.id, back, counterBack);
  });

  req.user = user;
  req.delegation = { grantId: claims.grant, clientId: claims.client_id, scopes: claims.scope.split(' '), clientName };
  next();
}
