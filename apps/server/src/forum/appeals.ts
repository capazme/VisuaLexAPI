import type { Prisma } from '../lib/db';

// The author's appeal to the owners against a hiding (spec 2026-11-14-forum-community-server-design §C,
// D-267): what the moderation routes and a glossa's page need of it.

/** What the author reads of an appeal closed because a moderator showed the item again. */
export const SHOWN_AGAIN = 'Il contributo è stato ripristinato';

/**
 * Showing an item again, by any route, closes its pending appeal as upheld, in the act's transaction. The
 * moderator's free reason stays in the log, which only moderators and owners read (it may name who
 * reported): the author reads a fixed note.
 */
export async function closeAppealsShown(tx: Pick<Prisma.TransactionClient, 'forumAppeal'>, kind: 'thread' | 'comment', itemId: string, actorId: string) {
  await tx.forumAppeal.updateMany({
    where: { targetKind: kind, targetId: itemId, status: 'pending' },
    data: { status: 'upheld', decidedAt: new Date(), decidedById: actorId, decisionNote: SHOWN_AGAIN },
  });
}

/** The appeal's state an author reads on their hidden item: the latest since it was last hidden. */
export function appealStateOf(
  appeals: { targetKind: string; targetId: string; status: string; createdAt: Date }[],
  kind: 'thread' | 'comment',
  item: { id: string; isHidden: boolean; hiddenAt: Date | null },
): 'pending' | 'rejected' | null {
  if (!item.isHidden) return null;
  const latest = appeals
    .filter(appeal => appeal.targetKind === kind && appeal.targetId === item.id && (!item.hiddenAt || appeal.createdAt >= item.hiddenAt))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return latest && (latest.status === 'pending' || latest.status === 'rejected') ? latest.status : null;
}
