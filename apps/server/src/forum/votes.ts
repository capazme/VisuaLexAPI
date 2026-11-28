import type { Prisma } from '../lib/db';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { withDailyLimit } from './limits';
import { lockComment, lockThread } from './locks';
import { isOwn, isVisible } from './views';

/**
 * The Forum's votes up and down (spec 2026-11-14-forum-community-server-design §A, D-248): one vote per
 * person per glossa or reply, +1 or -1, changed or withdrawn (0); never on one's own contribution; on a
 * comment only the withdrawal of an old vote. Each item's `score` is kept by the database's trigger on
 * the votes (migration 20261116100000_forum_votes_up_down), never written here.
 */
export type VoteValue = -1 | 0 | 1;

/** The refusal of a vote on one's own contribution: a stable code beside the Italian message. */
export const OWN_VOTE = { message: 'Non puoi votare un tuo contributo', code: 'own_contribution' } as const;

const COMMENT_VOTE = 'Si vota una risposta, non un commento';

/**
 * What an answer says of an item's votes: the score, the up and down counts, the reader's own vote. Two
 * fields stay for the reader's panel: `voteCount` (the up votes) and `userVoted` (an up vote of the
 * reader's).
 */
export function voteSummary(score: number, total: number, userVote: number) {
  const upvotes = (total + score) / 2;
  return { score, upvotes, downvotes: total - upvotes, userVote, voteCount: upvotes, userVoted: userVote === 1 };
}

/** The same, from an item whose votes were read with it. */
export function voteSummaryOf(item: { votes: { userId: string; value: number }[] }, viewerId: string) {
  const score = item.votes.reduce((sum, vote) => sum + vote.value, 0);
  return voteSummary(score, item.votes.length, item.votes.find(vote => vote.userId === viewerId)?.value ?? 0);
}

type Tx = Prisma.TransactionClient;

async function counts(tx: Tx, kind: 'thread' | 'comment', itemId: string) {
  const rows = kind === 'thread'
    ? await tx.articleThreadVote.groupBy({ by: ['value'], where: { threadId: itemId }, _count: { _all: true } })
    : await tx.articleCommentVote.groupBy({ by: ['value'], where: { commentId: itemId }, _count: { _all: true } });
  const of = (value: number) => rows.find(row => row.value === value)?._count._all ?? 0;
  return { upvotes: of(1), downvotes: of(-1) };
}

/**
 * Casts, changes or withdraws one person's vote on a glossa (`thread`) or a reply (`comment`), under the
 * daily counter: the glossa locked first, then the reply, as every write that decides about what hangs
 * on a glossa. `decide` turns the current vote (0 for none) into the new one. Answers the new vote and
 * the item's counts.
 */
export async function castVote(
  kind: 'thread' | 'comment',
  itemId: string,
  userId: string,
  decide: (current: VoteValue) => VoteValue,
) {
  return withDailyLimit('vote', userId, () => prisma.$transaction(async (tx) => {
    let current: VoteValue;
    let next: VoteValue;
    if (kind === 'thread') {
      if (!(await lockThread(tx, itemId))) throw new AppError(404, 'Glossa non trovata');
      const thread = await tx.articleThread.findUniqueOrThrow({ where: { id: itemId } });
      if (!isVisible(thread)) throw new AppError(404, 'Glossa non trovata');
      if (isOwn(thread.userId, userId)) throw new AppError(403, OWN_VOTE.message, OWN_VOTE.code);
      const existing = await tx.articleThreadVote.findUnique({ where: { threadId_userId: { threadId: itemId, userId } } });
      current = (existing?.value ?? 0) as VoteValue;
      next = decide(current);
      if (next !== current) {
        if (next === 0) await tx.articleThreadVote.delete({ where: { threadId_userId: { threadId: itemId, userId } } });
        else await tx.articleThreadVote.upsert({
          where: { threadId_userId: { threadId: itemId, userId } },
          create: { threadId: itemId, userId, value: next },
          update: { value: next },
        });
      }
    } else {
      const found = await tx.articleComment.findUnique({ where: { id: itemId }, select: { threadId: true } });
      if (!found || !(await lockThread(tx, found.threadId)) || !(await lockComment(tx, itemId))) {
        throw new AppError(404, 'Risposta non trovata');
      }
      const comment = await tx.articleComment.findUniqueOrThrow({ where: { id: itemId }, include: { thread: { select: { isHidden: true } } } });
      if (!isVisible(comment) || comment.thread.isHidden) throw new AppError(404, 'Risposta non trovata');
      if (isOwn(comment.userId, userId)) throw new AppError(403, OWN_VOTE.message, OWN_VOTE.code);
      const existing = await tx.articleCommentVote.findUnique({ where: { commentId_userId: { commentId: itemId, userId } } });
      current = (existing?.value ?? 0) as VoteValue;
      next = decide(current);
      // A comment is a remark, not an answer: its old votes may only be withdrawn.
      if (comment.parentId !== null && next !== 0) throw new AppError(400, COMMENT_VOTE);
      if (next !== current) {
        if (next === 0) await tx.articleCommentVote.delete({ where: { commentId_userId: { commentId: itemId, userId } } });
        else await tx.articleCommentVote.upsert({
          where: { commentId_userId: { commentId: itemId, userId } },
          create: { commentId: itemId, userId, value: next },
          update: { value: next },
        });
      }
    }
    const { upvotes, downvotes } = await counts(tx, kind, itemId);
    return { value: next, score: upvotes - downvotes, upvotes, downvotes };
  }));
}

/**
 * The personal score of each author named (D-248): the sum of the scores of their visible glosses,
 * replies and comments, the replies and comments under a hidden glossa left out. A contribution whose
 * author's account is gone counts for nobody. Every id asked for is in the map, 0 when nothing counts.
 */
export async function personalScores(
  db: Pick<Prisma.TransactionClient, 'articleThread' | 'articleComment'>,
  authorIds: (string | null)[],
): Promise<Map<string, number>> {
  const ids = [...new Set(authorIds.filter((id): id is string => id !== null))];
  const scores = new Map<string, number>(ids.map(id => [id, 0]));
  if (ids.length === 0) return scores;
  const [threads, comments] = await Promise.all([
    db.articleThread.groupBy({ by: ['userId'], where: { userId: { in: ids }, isHidden: false, deletedAt: null }, _sum: { score: true } }),
    db.articleComment.groupBy({
      by: ['userId'],
      where: { userId: { in: ids }, isHidden: false, deletedAt: null, thread: { isHidden: false } },
      _sum: { score: true },
    }),
  ]);
  for (const row of [...threads, ...comments]) {
    if (row.userId) scores.set(row.userId, (scores.get(row.userId) ?? 0) + (row._sum.score ?? 0));
  }
  return scores;
}
