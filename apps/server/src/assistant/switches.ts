import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

/**
 * Switches an administrator turns on and off at runtime (`app_switches`, one row per key), with no
 * environment variable and no restart. A missing row is off: every switch starts off, and the test
 * reset empties the table. Read at each request that needs it: one row by its key.
 */
export const APP_SWITCHES = {
  // D7b: passages and notes an assistant proposes, validated by hand. Off: the web's proposal routes
  // answer 404, dossier answers carry no state, the MCP lists neither tool, the delegated routes 404.
  assistant_passages: 'Passaggi e note proposti dall’IA, da validare a mano (D7b).',
} as const;

export type AppSwitchKey = keyof typeof APP_SWITCHES;

export const isAppSwitchKey = (key: string): key is AppSwitchKey => Object.prototype.hasOwnProperty.call(APP_SWITCHES, key);

type Db = Pick<Prisma.TransactionClient, 'appSwitch'>;

export async function isSwitchOn(key: AppSwitchKey, db: Db = prisma): Promise<boolean> {
  const row = await db.appSwitch.findUnique({ where: { key }, select: { enabled: true } });
  return row?.enabled ?? false;
}

/** How long the public `GET /features` answers from memory: it is called with no token, before every limiter. */
export const PUBLIC_CACHE_MS = 5_000;
const publicCache = new Map<AppSwitchKey, { enabled: boolean; at: number }>();

/**
 * The switch as the public route reads it: from memory for a few seconds. A change made here clears it at
 * once; one made by another process shows within PUBLIC_CACHE_MS. The routes behind the switch read it live.
 */
export async function isSwitchOnCached(key: AppSwitchKey, now: number = Date.now()): Promise<boolean> {
  const hit = publicCache.get(key);
  if (hit && now - hit.at < PUBLIC_CACHE_MS) return hit.enabled;
  const enabled = await isSwitchOn(key);
  publicCache.set(key, { enabled, at: now });
  return enabled;
}

export async function listSwitches(db: Db = prisma) {
  const rows = await db.appSwitch.findMany();
  return (Object.keys(APP_SWITCHES) as AppSwitchKey[]).map((key) => {
    const row = rows.find((r) => r.key === key);
    return { key, description: APP_SWITCHES[key], enabled: row?.enabled ?? false, updatedAt: row?.updatedAt ?? null };
  });
}

export async function setSwitch(key: AppSwitchKey, enabled: boolean, adminId: string, db: Db = prisma) {
  const row = await db.appSwitch.upsert({
    where: { key },
    create: { key, enabled, updatedBy: adminId },
    update: { enabled, updatedBy: adminId, updatedAt: new Date() },
  });
  publicCache.delete(key);
  return { key, description: APP_SWITCHES[key], enabled: row.enabled, updatedAt: row.updatedAt };
}
