import type { LingoCardStato } from '../lib/db';
import { prisma } from '../lib/prisma';
import { attemptMerltErasureNow, everConsented, requestMerltErasure } from '../services/merlt/userData';
import { removeUserFiles } from '../pratica/fileStore';
import { DELETED_AUTHOR } from '../forum/views';

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
 * The person's votes and notifications go with the row; their reports stay without a reporter. Every
 * glossa and reply the deletion will write is locked first, in the Community's lock order (spec
 * 2026-11-14-forum-community-server-design §A): the glosse, by id, then the replies and comments, by id.
 * Those are the ones the person voted (each vote's trigger updates their score) and the ones the person
 * wrote, locked or released (the foreign keys set the person to NULL on them). Left to the cascade, they
 * would be locked in any order, a reply before its glossa, against a reply being written or voted that
 * holds the glossa and waits for that reply.
 *
 * The moderation log keeps every act, and loses who the person was (G-504): an act they did loses its
 * actor through the foreign key; an act done on them, on their account or on their Forum profile, names
 * them as «utente cancellato» from this transaction on. An id their profile had before a move to a
 * pseudonym (a new id) stays as it was: nothing in the database ties it to them any more.
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
    // The Community: every glossa the deletion writes, by id, then every reply and comment, by id;
    // then the votes, whose trigger updates rows already locked; then the account, whose SET NULLs
    // find their rows locked too.
    await tx.$queryRaw`SELECT id FROM article_threads
      WHERE id IN (SELECT thread_id FROM article_thread_votes WHERE user_id = ${userId})
        OR user_id = ${userId} OR passage_released_by = ${userId} OR locked_by = ${userId}
      ORDER BY id FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM article_comments
      WHERE id IN (SELECT comment_id FROM article_comment_votes WHERE user_id = ${userId}) OR user_id = ${userId}
      ORDER BY id FOR UPDATE`;
    await tx.articleThreadVote.deleteMany({ where: { userId } });
    await tx.articleCommentVote.deleteMany({ where: { userId } });
    // The profile goes with the account: its id is read first. The log is rewritten after the delete,
    // which waits for any act on the account or the profile still being written: each statement sees
    // what was committed before it ran, so such an act's entry is rewritten too.
    const profile = await tx.forumProfile.findUnique({ where: { userId }, select: { id: true } });
    await tx.user.delete({ where: { id: userId } });
    await tx.forumModerationLog.updateMany({ where: { targetKind: 'user', targetId: userId }, data: { targetId: DELETED_AUTHOR } });
    if (profile) {
      await tx.forumModerationLog.updateMany({
        where: { targetKind: 'profile', targetId: profile.id }, data: { targetId: DELETED_AUTHOR },
      });
      await tx.forumModerationLog.updateMany({
        where: { targetKind: 'report', targetId: `profile:${profile.id}` }, data: { targetId: `profile:${DELETED_AUTHOR}` },
      });
    }
  });
  // The case files' rows went with the user's cascade; their encrypted files leave the disk now (LC50).
  await removeUserFiles(userId);
  if (merltErasure) await attemptMerltErasureNow(userId);
}
