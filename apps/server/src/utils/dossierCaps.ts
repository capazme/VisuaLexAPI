import type { Prisma } from '../lib/db';
import { AppError } from '../middleware/errorHandler';
import { forNoKeyUpdate } from '../lib/sqlDialect';

/**
 * How much an account may hold in its dossiers (G-576, the owner's words: «Sì: 500 dossier, 2.000 voci per
 * dossier e al massimo 10.000 voci in tutto per account»). Server-side ceilings: `GET /dossiers` sends every
 * dossier with every entry, and the web loads it at sign-in and again every minute, so the total per account
 * is what bounds that answer (measured on 18 November 2026: 500 dossiers × 10 entries carrying the article's
 * text weigh 14.7 MB).
 *
 * Every path that creates dossiers or entries checks here, inside its own transaction: the account's row is
 * locked, as for the Atti (`routes/atti.ts`), so two writes at once cannot both pass a cap. It is the first lock
 * of the transaction, except where a path must claim its own row first (a taken suggestion's item, a trash
 * entry and its published copy); no path locks the account and then those rows, so the order makes no cycle.
 * A refusal is a 409 whose Italian
 * `detail` names the cap and whose `error` is `dossier_limit`, `dossier_items_limit` or
 * `account_items_limit`.
 */
export const MAX_DOSSIERS_PER_ACCOUNT = 500;
export const MAX_ITEMS_PER_DOSSIER = 2000;
export const MAX_ITEMS_PER_ACCOUNT = 10_000;

// Thousands with a dot, always (Italian Intl leaves four digits ungrouped: «2000», not «2.000»).
export const formatThousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const it = formatThousands;

/** What a write is about to add. */
export interface DossierAddition {
  /** New dossiers. */
  dossiers?: number;
  /** New entries in the account, wherever they go (a move adds none). */
  items?: number;
  /** The entries of the largest new dossier. */
  largestNewDossier?: number;
  /** Entries going into an existing dossier. */
  into?: { dossierId: string; items: number };
}

/** A cap's refusal: its code and its Italian sentence, as a 409 answers them or a bulk write lists them. */
export interface CapRefusal {
  error: 'dossier_limit' | 'dossier_items_limit' | 'account_items_limit';
  detail: string;
}

const PER_DOSSIER = `Una pratica può contenere al massimo ${it(MAX_ITEMS_PER_DOSSIER)} voci.`;

/** The per-dossier cap's refusal, naming what the dossier holds when that is known. */
function dossierItemsRefusal(held?: number): CapRefusal {
  return { error: 'dossier_items_limit', detail: held === undefined ? PER_DOSSIER : `${PER_DOSSIER} Questa ne ha già ${it(held)}.` };
}

const ACCOUNT_ITEMS: CapRefusal = {
  error: 'account_items_limit',
  detail: `Le tue pratiche possono contenere al massimo ${it(MAX_ITEMS_PER_ACCOUNT)} voci in tutto: eliminane qualcuna per aggiungerne di nuove.`,
};

/** The account's row, locked for the rest of the transaction: two writes at once cannot both pass a cap. */
async function lockAccount(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE id = ${userId}${forNoKeyUpdate()}`;
  if (locked.length === 0) throw new AppError(404, 'Account non trovato.');
}

/**
 * How many entries still fit in the account's own dossier `dossierId`, and the refusal of the cap that binds first
 * (G-595: a bulk write lets in what fits, in order, and lists the rest with this sentence). Locks the account's row,
 * as `assertDossierRoom` does: the first lock of the caller's transaction.
 */
export async function itemRoom(
  tx: Prisma.TransactionClient,
  userId: string,
  dossierId: string,
): Promise<{ room: number; refusalAfter: (entered: number) => CapRefusal }> {
  await lockAccount(tx, userId);
  const held = await tx.dossierItem.count({ where: { dossierId, dossier: { userId } } });
  const total = await tx.dossierItem.count({ where: { dossier: { userId } } });
  const inDossier = Math.max(0, MAX_ITEMS_PER_DOSSIER - held);
  const inAccount = Math.max(0, MAX_ITEMS_PER_ACCOUNT - total);
  // The sentence as a single add would read it once `entered` entries went in.
  return inDossier <= inAccount
    ? { room: inDossier, refusalAfter: (entered) => dossierItemsRefusal(held + entered) }
    : { room: inAccount, refusalAfter: () => ACCOUNT_ITEMS };
}

export async function assertDossierRoom(tx: Prisma.TransactionClient, userId: string, adding: DossierAddition): Promise<void> {
  await lockAccount(tx, userId);

  if (adding.dossiers && (await tx.dossier.count({ where: { userId } })) + adding.dossiers > MAX_DOSSIERS_PER_ACCOUNT) {
    throw new AppError(
      409,
      `Hai raggiunto il limite di ${it(MAX_DOSSIERS_PER_ACCOUNT)} pratiche: eliminane qualcuna per crearne di nuove.`,
      'dossier_limit',
    );
  }
  if ((adding.largestNewDossier ?? 0) > MAX_ITEMS_PER_DOSSIER) {
    const refusal = dossierItemsRefusal();
    throw new AppError(409, refusal.detail, refusal.error);
  }
  if (adding.into && adding.into.items > 0) {
    // Only the account's own dossier counts: a target named by the request (a trash restore) may be someone
    // else's, and its size must not show through the refusal; the caller's own check then answers 404.
    const held = await tx.dossierItem.count({ where: { dossierId: adding.into.dossierId, dossier: { userId } } });
    if (held + adding.into.items > MAX_ITEMS_PER_DOSSIER) {
      const refusal = dossierItemsRefusal(held);
      throw new AppError(409, refusal.detail, refusal.error);
    }
  }
  if (adding.items && (await tx.dossierItem.count({ where: { dossier: { userId } } })) + adding.items > MAX_ITEMS_PER_ACCOUNT) {
    throw new AppError(409, ACCOUNT_ITEMS.detail, ACCOUNT_ITEMS.error);
  }
}
