import type { LingoCardStato } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { attemptMerltErasureNow, everConsented, requestMerltErasure } from '../services/merlt/userData';

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
 * The Community's glosse, replies and comments stay too, without an author («utente cancellato»,
 * G-307), and so do the replies others wrote under them: the foreign keys set `user_id` to NULL.
 * The person's votes and notifications go with the row; their reports stay without a reporter.
 *
 * MERL-T keeps its own copy of what a consenting person did there: when the person ever gave
 * MERL-T a consent, the same transaction records an erasure request, which outlives the user
 * row and is sent to MERL-T until it confirms (`services/merlt/userData.ts`). One attempt is
 * made at once, briefly; the worker does the rest.
 *
 * Rejects like `prisma.user.delete` when the user does not exist (P2025, a 404
 * for the error handler), rolling the card deletion back with it.
 */
export async function deleteUserAccount(userId: string): Promise<void> {
  let merltErasure = false;
  await prisma.$transaction(async (tx) => {
    if (await everConsented(tx, userId)) {
      await requestMerltErasure(tx, userId, 'account_deleted');
      merltErasure = true;
    }
    // The person's cards are locked first: a validator's vote in flight finishes before the
    // states are read, so a card it has just archived goes with the account instead of
    // staying archived with no author, where nobody could see or delete it.
    // Their courses first (Percorsi): the course trash locks a course, then its modules, then its cards, so
    // taking the cards first here would deadlock with it.
    await tx.$queryRaw`SELECT id FROM lingo_corsi WHERE autore_id = ${userId} ORDER BY id FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM lingo_cards WHERE autore_id = ${userId} ORDER BY id FOR UPDATE`;
    await tx.lingoCard.deleteMany({ where: { autoreId: userId, stato: { in: PERSONAL_STATES } } });
    await tx.user.delete({ where: { id: userId } });
  });
  if (merltErasure) await attemptMerltErasureNow(userId);
}
