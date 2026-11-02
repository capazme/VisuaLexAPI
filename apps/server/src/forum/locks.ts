import type { Prisma } from '@prisma/client';

/**
 * The Community's row locks (spec 2026-10-20 §5.5): deciding and writing are one step. Every write that
 * adds under a glossa or decides about what hangs on it locks the glossa first, then the reply: one
 * order, so two writes never wait on each other crosswise. Returns whether the row exists.
 */
export async function lockThread(tx: Prisma.TransactionClient, threadId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM article_threads WHERE id = ${threadId} FOR UPDATE`;
  return rows.length > 0;
}

export async function lockComment(tx: Prisma.TransactionClient, commentId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM article_comments WHERE id = ${commentId} FOR UPDATE`;
  return rows.length > 0;
}
