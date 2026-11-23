import type { Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';

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
const it = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

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

export async function assertDossierRoom(tx: Prisma.TransactionClient, userId: string, adding: DossierAddition): Promise<void> {
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE id = ${userId} FOR NO KEY UPDATE`;
  if (locked.length === 0) throw new AppError(404, 'Account non trovato.');

  if (adding.dossiers && (await tx.dossier.count({ where: { userId } })) + adding.dossiers > MAX_DOSSIERS_PER_ACCOUNT) {
    throw new AppError(
      409,
      `Hai raggiunto il limite di ${it(MAX_DOSSIERS_PER_ACCOUNT)} pratiche: eliminane qualcuna per crearne di nuove.`,
      'dossier_limit',
    );
  }
  const perDossier = `Una pratica può contenere al massimo ${it(MAX_ITEMS_PER_DOSSIER)} voci.`;
  if ((adding.largestNewDossier ?? 0) > MAX_ITEMS_PER_DOSSIER) {
    throw new AppError(409, perDossier, 'dossier_items_limit');
  }
  if (adding.into && adding.into.items > 0) {
    // Only the account's own dossier counts: a target named by the request (a trash restore) may be someone
    // else's, and its size must not show through the refusal; the caller's own check then answers 404.
    const held = await tx.dossierItem.count({ where: { dossierId: adding.into.dossierId, dossier: { userId } } });
    if (held + adding.into.items > MAX_ITEMS_PER_DOSSIER) {
      throw new AppError(409, `${perDossier} Questa ne ha già ${it(held)}.`, 'dossier_items_limit');
    }
  }
  if (adding.items && (await tx.dossierItem.count({ where: { dossier: { userId } } })) + adding.items > MAX_ITEMS_PER_ACCOUNT) {
    throw new AppError(
      409,
      `Le tue pratiche possono contenere al massimo ${it(MAX_ITEMS_PER_ACCOUNT)} voci in tutto: eliminane qualcuna per aggiungerne di nuove.`,
      'account_items_limit',
    );
  }
}
