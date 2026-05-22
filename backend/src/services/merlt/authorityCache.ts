import { PrismaClient } from '@prisma/client';
import { MerltClient, MerltClientError } from './merltClient';

/**
 * Authority cache: avoids round-tripping to MERL-T on every event.
 *
 * Policy (Slice 1, simple):
 *  - Read on event capture: returns cached row if present (no freshness gate)
 *  - Sync on demand: getOrSync(userId) refreshes from MERL-T if missing or
 *    if `maxAgeMs` has elapsed
 *  - Failed sync: returns null (caller decides whether to send event without
 *    user_authority or skip — for Slice 1 we send without)
 *
 * No background worker yet. Future stories may add periodic refresh.
 */

const prisma = new PrismaClient();
const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

export interface CachedAuthority {
  userId: string;
  authorityScore: number;
  baselineQual: string;
  trackRecord: number;
  performance: number;
  totalContributions: number;
  syncedAt: Date;
}

/** Pure read — never touches MERL-T. Returns null if cache miss. */
export async function readCachedAuthority(userId: string): Promise<CachedAuthority | null> {
  const row = await prisma.merltUserAuthorityCache.findUnique({ where: { userId } });
  if (!row) return null;
  return {
    userId: row.userId,
    authorityScore: row.authorityScore,
    baselineQual: row.baselineQual,
    trackRecord: row.trackRecord,
    performance: row.performance,
    totalContributions: row.totalContributions,
    syncedAt: row.syncedAt,
  };
}

/** Cache-aware getter. Triggers MERL-T sync when stale or missing. */
export async function getOrSyncAuthority(
  userId: string,
  client: MerltClient,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS
): Promise<CachedAuthority | null> {
  const cached = await readCachedAuthority(userId);
  const now = Date.now();
  if (cached && now - cached.syncedAt.getTime() < maxAgeMs) {
    return cached;
  }

  try {
    const profile = await client.getProfile(userId);
    const updated: CachedAuthority = {
      userId,
      authorityScore: profile.authority_score,
      baselineQual: profile.baseline_qualification,
      trackRecord: profile.track_record ?? 0,
      performance: profile.performance ?? 0,
      totalContributions: profile.total_contributions ?? 0,
      syncedAt: new Date(),
    };

    await prisma.merltUserAuthorityCache.upsert({
      where: { userId },
      create: updated,
      update: {
        authorityScore: updated.authorityScore,
        baselineQual: updated.baselineQual,
        trackRecord: updated.trackRecord,
        performance: updated.performance,
        totalContributions: updated.totalContributions,
        syncedAt: updated.syncedAt,
      },
    });

    return updated;
  } catch (err) {
    // MERL-T down or 4xx: serve stale cache if any, else null.
    if (cached) return cached;
    if (err instanceof MerltClientError) return null;
    throw err;
  }
}
