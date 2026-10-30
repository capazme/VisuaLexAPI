import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

/**
 * Switches an administrator turns on and off at runtime (`app_switches`, one row per key), with no
 * environment variable and no restart. A missing row is off: every switch starts off, and the test
 * reset empties the table. Read at each request that needs it: one row by its key.
 */
export const APP_SWITCHES = {
  // D7b: the web app's side of what an assistant proposed (its saved passages, its glosses, its notes), validated
  // by hand. Off: the web's proposal routes answer 404 and dossier answers carry no state. Since D8 no application
  // proposes coloured passages any more: the saved ones stay, readable here.
  assistant_passages: 'Proposte e note dell’IA nel dossier, da validare a mano (D7b).',
  // D8: the connected application's side of glosses. Off: the delegated route that proposes them answers 404 and
  // the MCP does not list `omnilex_glossa_voce` (an entry's text is behind no switch). The route also needs
  // `assistant_passages`, the web app's side where the user validates them. Switch this on only once the web shows
  // glosses: today's web draws a gloss's missing colour as yellow.
  assistant_glosses: 'Glosse dell’IA sui passaggi, proposte dalle applicazioni collegate (D8).',
  // Gymnasium's courses («Percorsi», A1, spec 2026-10-23 §10.10). Off: every /api/lingo/corsi route and the
  // declaration's accept route answer 404, the card route refuses a module, the trash hides a course and a module
  // (`trash/trash.ts`), the MCP lists none of the tools. Switching off hides, never deletes.
  lingo_courses: 'Percorsi di studio creati dall’assistente (A1).',
  // G-387 (a): a part of an article Normattiva splits («art. 1 (commi 701-800)») as an entry of its own. Off: a
  // reference's comma is not sent on and the article is stored, as before (`norms/resolveReference.ts`); an entry
  // already stored as a part is still read as that part. Switch this on only once the web opens parts (3c).
  article_parts: 'Parti di un articolo diviso da Normattiva come voci a sé (G-387).',
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
