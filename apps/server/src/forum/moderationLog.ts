import type { LingoMateria, Prisma } from '../lib/db';

export type ModerationAction =
  | 'hide' | 'unhide' | 'lock' | 'unlock' | 'dismiss' | 'release_passage' | 'withhold_passage'
  | 'appoint_moderator' | 'revoke_moderator' | 'empty' | 'withdraw_name' | 'restore_name'
  | 'appoint_validator' | 'revoke_validator' | 'appeal_rejected';

/**
 * Writes one act of a moderator or an administrator to the log (spec 2026-10-20 §5.7), in the
 * transaction of the act. Only moderators and administrators read it. Append-only, but for two things:
 * the sweep replaces the reason with «(tolto dopo 12 mesi)» twelve months on (G-550, `forum/sweep.ts`),
 * and a deleted person named as the target becomes «utente cancellato» (G-504, `lingo/deleteUserAccount.ts`).
 */
export async function logModeration(
  tx: Prisma.TransactionClient,
  act: {
    actorId: string; action: ModerationAction; targetKind: 'thread' | 'comment' | 'report' | 'user' | 'profile';
    targetId: string; reason: string | null; materia?: LingoMateria | null;
  },
) {
  await tx.forumModerationLog.create({ data: act });
}
