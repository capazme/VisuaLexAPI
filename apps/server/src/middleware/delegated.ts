import express, { type NextFunction, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { RateLimiterRes, type RateLimiterAbstract } from 'rate-limiter-flexible';
import { prisma } from '../lib/prisma';
import { oauthConfig } from '../oauth/config';
import { ACTOR, delegationSecret } from '../oauth/delegationSecret';
import { findDelegatedRoute } from '../oauth/delegatedRoutes';
import type { DelegatedClaims } from '../oauth/exchange';
import { createLimiter } from './rateLimiter';

const DAY_SECONDS = 24 * 60 * 60;

/** The daily allowance of delegated calls (spec section 6: placeholders to calibrate). */
export const DELEGATED_DAILY_POINTS = parseInt(process.env.OAUTH_DAILY_POINTS || '500', 10);
export const DELEGATED_DAILY_DOSSIER_CREATIONS = 10;

// Created on first use: the Redis client, when enabled, is read then.
let points: RateLimiterAbstract | undefined;
let dossierCreations: RateLimiterAbstract | undefined;
const pointsLimiter = () => (points ??= createLimiter('rl:mcp-points', DELEGATED_DAILY_POINTS, DAY_SECONDS));
const creationsLimiter = () =>
  (dossierCreations ??= createLimiter('rl:mcp-dossier-create', DELEGATED_DAILY_DOSSIER_CREATIONS, DAY_SECONDS));

/** Spends a user's delegated points, as calls would (tests use it to reach the limit). */
export async function spendDelegatedQuota(userId: string, amount: number): Promise<void> {
  await pointsLimiter().penalty(userId, amount);
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
  return {
    points: await line(pointsLimiter(), DELEGATED_DAILY_POINTS, userId),
    dossierCreations: await line(creationsLimiter(), DELEGATED_DAILY_DOSSIER_CREATIONS, userId),
  };
}

function refuse(res: Response, status: 401 | 403, detail: string, error: string): void {
  if (status === 401) res.setHeader('WWW-Authenticate', `Bearer error="${error}"`);
  res.status(status).json({ detail, error });
}

function overQuota(res: Response, quota: 'points' | 'dossier_create', limit: RateLimiterRes): void {
  const seconds = Math.max(1, Math.ceil(limit.msBeforeNext / 1000));
  res.setHeader('Retry-After', String(seconds));
  res.status(429).json({
    detail:
      quota === 'points'
        ? 'Limite giornaliero delle operazioni tramite applicazioni collegate raggiunto.'
        : 'Limite giornaliero di dossier creati tramite applicazioni collegate raggiunto.',
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
  const decoded = jwt.decode(token);
  return typeof decoded === 'object' && decoded !== null && 'act' in decoded;
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
  try {
    const grant = await prisma.oAuthGrant.findUnique({ where: { id: claims.grant }, include: { user: true } });
    if (!grant || grant.revokedAt || grant.userId !== claims.sub || !grant.user.isActive) {
      return refuse(res, 401, 'Il collegamento è stato revocato.', 'invalid_token');
    }
    user = grant.user;
  } catch (error) {
    console.error('delegatedAuth: could not read the grant:', error instanceof Error ? error.message : error);
    res.status(503).json({ detail: 'Servizio temporaneamente non disponibile, riprova tra poco.' });
    return;
  }

  // The weight of some routes depends on the body: parse it here (the app's
  // parser, later, sees it parsed and skips).
  await new Promise<void>((resolve) => parseJson(req, res, () => resolve()));
  if (res.headersSent) return;
  const weight = typeof route.weight === 'function' ? route.weight(req) : route.weight;

  try {
    if (weight > 0) await pointsLimiter().consume(user.id, weight);
  } catch (error) {
    if (error instanceof RateLimiterRes) return overQuota(res, 'points', error);
    console.error('delegatedAuth: quota limiter error (fail-open):', error instanceof Error ? error.message : error);
  }
  if (route.counter === 'dossier_create') {
    try {
      await creationsLimiter().consume(user.id, 1);
    } catch (error) {
      if (error instanceof RateLimiterRes) {
        if (weight > 0) await pointsLimiter().reward(user.id, weight).catch(() => undefined);
        return overQuota(res, 'dossier_create', error);
      }
      console.error('delegatedAuth: counter limiter error (fail-open):', error instanceof Error ? error.message : error);
    }
  }

  req.user = user;
  req.delegation = { grantId: claims.grant, clientId: claims.client_id, scopes: claims.scope.split(' ') };
  next();
}
