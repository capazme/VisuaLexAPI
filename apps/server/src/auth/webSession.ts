import type { Request, Response } from 'express';
import type { Prisma, User } from '../lib/db';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { randomSecret, sha256 } from '../oauth/hash';

/**
 * The web's sessions (A.1, spec `docs/superpowers/specs/2026-11-16-web-session-cookies-design.md`). A session is a
 * row (`WebSession`); the browser holds only its random secret, in a cookie scripts cannot read. Revoking deletes
 * the row, and the session ends at its next request.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** `lastUsedAt` is written at most this often per session, so a burst of requests causes no burst of writes. */
export const LAST_USED_RESOLUTION_MS = 10 * 60 * 1000;

const positiveDays = (value: string | undefined, fallback: number): number => {
  const days = Number(value);
  return Number.isFinite(days) && days > 0 ? days : fallback;
};

/** D2: 7 days idle, 30 days at most, unless SESSION_IDLE_DAYS / SESSION_MAX_DAYS say otherwise. */
export const sessionIdleMs = (): number => positiveDays(process.env.SESSION_IDLE_DAYS, 7) * DAY_MS;
export const sessionMaxMs = (): number => positiveDays(process.env.SESSION_MAX_DAYS, 30) * DAY_MS;

/**
 * Whether the cookie is `Secure` (and named with the `__Host-` prefix). A browser does not keep a `Secure` cookie
 * received over plain HTTP, and the private phase serves plain HTTP: so the flag follows the app's public origin,
 * the first entry of ALLOWED_ORIGINS (in production it comes from PUBLIC_ORIGIN). SESSION_COOKIE_SECURE ('true' or
 * 'false') overrides it either way.
 */
export function deriveCookieSecure(override: string | undefined, origins: string[]): boolean {
  const forced = override?.trim().toLowerCase();
  if (forced === 'true') return true;
  if (forced === 'false') return false;
  return (origins[0] ?? '').toLowerCase().startsWith('https://');
}

export const cookieSecure = (): boolean => deriveCookieSecure(process.env.SESSION_COOKIE_SECURE, config.cors.origins);

/** `__Host-vx_session` over HTTPS (Secure, Path=/, no Domain: the browser enforces all three), `vx_session` otherwise. */
export const sessionCookieName = (): string => (cookieSecure() ? '__Host-vx_session' : 'vx_session');

/** The session cookie's value in a request, or null. The server has no cookie parser: this reads the one it needs. */
export function readSessionCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  const name = sessionCookieName();
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() !== name) continue;
    const value = part.slice(at + 1).trim();
    // The secret is base64url (randomSecret): anything else is not ours, and is not looked up.
    return /^[A-Za-z0-9_-]{20,100}$/.test(value) ? value : null;
  }
  return null;
}

function cookieOptions() {
  return { httpOnly: true, sameSite: 'strict' as const, secure: cookieSecure(), path: '/' };
}

export function setSessionCookie(res: Response, secret: string): void {
  res.cookie(sessionCookieName(), secret, { ...cookieOptions(), maxAge: sessionMaxMs() });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(sessionCookieName(), cookieOptions());
}

const BROWSERS: Array<[RegExp, string]> = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];
const SYSTEMS: Array<[RegExp, string]> = [
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

/** The browser and system family from a User-Agent, in Italian («Firefox su macOS»); the raw string is never kept. */
export function sessionLabel(userAgent: string | undefined): string {
  const ua = (userAgent ?? '').slice(0, 512);
  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1];
  if (browser && system) return `${browser} su ${system}`;
  return browser ?? (system ? `Browser su ${system}` : 'Browser sconosciuto');
}

/** A new session for the user: a new row, a new secret (so a session cannot be fixed in advance). */
export async function createWebSession(userId: string, userAgent: string | undefined, now = new Date()): Promise<string> {
  const secret = randomSecret();
  await prisma.webSession.create({
    data: {
      userId,
      secretHash: sha256(secret),
      label: sessionLabel(userAgent),
      createdAt: now,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + sessionMaxMs()),
    },
  });
  return secret;
}

export interface ResolvedSession {
  sessionId: string;
  user: User;
}

/**
 * The session a cookie's secret opens, with its user, in one query; null when there is none, it has expired (absolute
 * or idle) or its user is not active. Touches `lastUsedAt` at most every LAST_USED_RESOLUTION_MS, with a write
 * conditioned on the value it read. Throws when the database cannot answer: the caller says 503, not 401.
 */
export async function resolveWebSession(secret: string, now = new Date()): Promise<ResolvedSession | null> {
  const row = await prisma.webSession.findUnique({ where: { secretHash: sha256(secret) }, include: { user: true } });
  if (!row) return null;
  if (now >= row.expiresAt) return null;
  if (now.getTime() >= row.lastUsedAt.getTime() + sessionIdleMs()) return null;
  if (!row.user.isActive) return null;
  if (now.getTime() - row.lastUsedAt.getTime() >= LAST_USED_RESOLUTION_MS) {
    prisma.webSession
      .updateMany({ where: { id: row.id, lastUsedAt: row.lastUsedAt }, data: { lastUsedAt: now } })
      .catch((error: unknown) => {
        console.error('webSession: could not record the last use:', error instanceof Error ? error.message : error);
      });
  }
  return { sessionId: row.id, user: row.user };
}

/** Ends the session a secret opens, whoever's it is (sign-out, or a sign-in replacing what the browser presented). */
export async function deleteWebSessionBySecret(secret: string): Promise<void> {
  await prisma.webSession.deleteMany({ where: { secretHash: sha256(secret) } });
}

/**
 * D3: ends every session of a user, but `keepSessionId` (the one in use, on one's own password change). Inside the
 * caller's transaction when it passes one.
 */
export async function revokeUserWebSessions(
  userId: string,
  keepSessionId?: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<number> {
  const { count } = await tx.webSession.deleteMany({
    where: { userId, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) },
  });
  return count;
}

/** Deletes the rows that can never open anything again: past their absolute limit, or idle past the idle one. */
export async function sweepWebSessions(now = new Date()): Promise<number> {
  const { count } = await prisma.webSession.deleteMany({
    where: {
      OR: [{ expiresAt: { lte: now } }, { lastUsedAt: { lte: new Date(now.getTime() - sessionIdleMs()) } }],
    },
  });
  return count;
}

let lastSweep = 0;

/** Sweeps at most once a day per process, on a sign-in; a failure is logged, never thrown. */
export async function sweepWebSessionsAtMostDaily(now = Date.now()): Promise<void> {
  if (now - lastSweep < DAY_MS) return;
  lastSweep = now;
  try {
    await sweepWebSessions(new Date(now));
  } catch (error) {
    console.error('webSession sweep failed:', error instanceof Error ? error.message : error);
  }
}
