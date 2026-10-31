import type { Prisma } from '@prisma/client';

export type ModerationAction =
  | 'hide' | 'unhide' | 'lock' | 'unlock' | 'dismiss' | 'release_passage' | 'withhold_passage'
  | 'appoint_moderator' | 'revoke_moderator' | 'empty';

/**
 * Writes one act of a moderator or an administrator to the append-only log (spec 2026-10-20 §5.7), in
 * the transaction of the act. Only moderators and administrators read it.
 */
export async function logModeration(
  tx: Prisma.TransactionClient,
  act: { actorId: string; action: ModerationAction; targetKind: 'thread' | 'comment' | 'report' | 'user'; targetId: string; reason: string | null },
) {
  await tx.forumModerationLog.create({ data: act });
}
