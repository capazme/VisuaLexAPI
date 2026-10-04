import { prisma } from '../lib/prisma';

const DAY = 24 * 60 * 60 * 1000;
export const UNUSED_CLIENT_LIFETIME_MS = 7 * DAY;

/**
 * Deletes what has expired and can never be used again: authorization requests
 * and codes past their life (a used code is kept until it expires, to recognise
 * a replay), and clients registered more than seven days ago that never
 * obtained a grant (spec 4.2). Tokens are kept with their grant: a revoked or
 * expired one answers `active: false` either way.
 */
export async function sweepOAuth(now = new Date()): Promise<void> {
  await prisma.$transaction([
    prisma.oAuthAuthorizationRequest.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.oAuthAuthorizationCode.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - DAY) } } }),
    prisma.oAuthClient.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - UNUSED_CLIENT_LIFETIME_MS) }, grants: { none: {} } },
    }),
  ]);
}

let lastSweep = 0;

/** Sweeps unless this process swept less than `intervalMs` ago; a failure is logged, never thrown. */
export async function sweepAtMostEvery(intervalMs: number): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < intervalMs) return;
  lastSweep = now;
  try {
    await sweepOAuth(new Date(now));
  } catch (error) {
    console.error('oauth sweep failed:', error instanceof Error ? error.message : error);
  }
}
