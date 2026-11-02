import type { Prisma } from '@prisma/client';

export type NotificationKind = 'reply' | 'comment' | 'accepted' | 'hidden';

/**
 * Tells a contribution's author what happened to it (spec 2026-10-20 §6.5), in the transaction of the
 * event. Never for one's own act, never to an author whose account is gone, never naming who acted.
 */
export async function notify(
  tx: Prisma.TransactionClient,
  event: { to: string | null; by: string | null; kind: NotificationKind; threadId: string; commentId?: string | null },
) {
  if (event.to === null || event.to === event.by) return;
  await tx.forumNotification.create({
    data: { userId: event.to, kind: event.kind, threadId: event.threadId, commentId: event.commentId ?? null },
  });
}
