import type { LingoCardStato } from '@prisma/client';
import { prisma } from '../lib/prisma';

/**
 * The states in which a card belongs to its author alone. A draft was never
 * offered to anyone, and an archived card was turned down by the validators:
 * both are the person's own writing and go with the person. A card the community
 * has taken up (proposed, validated, to review) is community property: it stays,
 * with its state and its anchors, and loses only its author (the foreign key
 * sets `autoreId` to NULL).
 */
export const PERSONAL_STATES: LingoCardStato[] = ['BOZZA_PERSONALE', 'ARCHIVIATA'];

/**
 * Deletes a user and, in the same transaction, the study cards that were only
 * theirs. Every route that deletes an account goes through here (the user's own
 * and the administrator's); deleting the user row by hand would leave their
 * drafts behind, anonymous and of no use to anyone.
 *
 * Rejects like `prisma.user.delete` when the user does not exist (P2025, a 404
 * for the error handler), rolling the card deletion back with it.
 */
export async function deleteUserAccount(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.lingoCard.deleteMany({ where: { autoreId: userId, stato: { in: PERSONAL_STATES } } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);
}
