import type { Prisma } from '@prisma/client';

/**
 * The cards a validator may vote on (Studia screens spec decisions 13–15): proposed, not written by them, not
 * voted on by them yet. Shared by the queue (`GET /api/lingo/validazione/coda`) and the mission «convalida»,
 * which is «vuota» when nothing is left to vote on (Gymnasium XP spec §3.5).
 */
export function votableWhere(userId: string): Prisma.LingoCardWhereInput {
  return {
    stato: 'PROPOSTA_COMMUNITY',
    // A card whose author's account is gone has a null author: it is still to be validated.
    // (`autoreId: { not }` alone would drop it, as SQL's <> does with NULL.)
    OR: [{ autoreId: null }, { autoreId: { not: userId } }],
    validazioni: { none: { utenteId: userId } },
  };
}
