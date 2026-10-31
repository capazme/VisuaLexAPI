import { prisma } from '../lib/prisma';

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a closed report keeps its copy of the reported text, and a read notification lives. */
export const COMMUNITY_RETENTION_DAYS = 90;

let lastSweep = 0;

/**
 * Erases the copy of the reported text from the reports closed more than 90 days ago (the report
 * stays, as a record: G-308) and deletes the notifications read more than 90 days ago (spec
 * 2026-10-20-forum-community-glosse-design §5.7, §6.5). Returns what it touched.
 */
export async function sweepCommunity(now: Date = new Date()) {
  const before = new Date(now.getTime() - COMMUNITY_RETENTION_DAYS * DAY_MS);
  const closedLongAgo = { status: { not: 'pending' }, resolvedAt: { lt: before }, reportedText: { not: null } };
  const [threadReports, commentReports, notifications] = await prisma.$transaction([
    prisma.articleThreadReport.updateMany({ where: closedLongAgo, data: { reportedText: null } }),
    prisma.articleCommentReport.updateMany({ where: closedLongAgo, data: { reportedText: null } }),
    prisma.forumNotification.deleteMany({ where: { readAt: { lt: before } } }),
  ]);
  return { reportCopies: threadReports.count + commentReports.count, notifications: notifications.count };
}

/**
 * Sweeps at most once a day, awaited by every Community route that writes (and, with pull request 2,
 * by the moderators' queue): never fire-and-forget work on the database, as the trash's `maybeSweep`.
 */
export async function maybeSweepCommunity(): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < DAY_MS) return;
  lastSweep = now;
  await sweepCommunity(new Date(now));
}
