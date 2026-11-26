import type { LingoMateria, Prisma } from '../lib/db';
import { moderatesSubject, type Roles } from './roles';

export type ReportRow = {
  itemId: string; threadId: string; reason: string; details: string | null; status: string;
  createdAt: Date; reportedText: string | null; resolvedAt: Date | null; resolutionNote: string | null;
};

export type ReportGroup = {
  kind: 'thread' | 'comment'; itemId: string; threadId: string; materia: LingoMateria | null; reports: ReportRow[];
};

/**
 * The reports of a status, one group per reported item, oldest first, each with the subject of its glossa
 * (spec 2026-11-14-forum-community-server-design §C). Only the groups the person moderates: a subject's
 * moderator has their subject's, and an item whose glossa is gone for good belongs to the whole
 * Community's moderators.
 */
export async function readReportGroups(
  db: Pick<Prisma.TransactionClient, 'articleThreadReport' | 'articleCommentReport' | 'articleThread'>,
  status: string,
  roles: Roles,
): Promise<ReportGroup[]> {
  const [threadReports, commentReports] = await Promise.all([
    db.articleThreadReport.findMany({ where: { status }, orderBy: { createdAt: 'asc' } }),
    db.articleCommentReport.findMany({ where: { status }, orderBy: { createdAt: 'asc' } }),
  ]);
  const groups = new Map<string, Omit<ReportGroup, 'materia'>>();
  const add = (kind: 'thread' | 'comment', report: ReportRow) => {
    const key = `${kind}:${report.itemId}`;
    if (!groups.has(key)) groups.set(key, { kind, itemId: report.itemId, threadId: report.threadId, reports: [] });
    groups.get(key)!.reports.push(report);
  };
  for (const report of threadReports) add('thread', { ...report, itemId: report.threadId });
  for (const report of commentReports) add('comment', { ...report, itemId: report.commentId });
  const threadIds = [...new Set([...groups.values()].map(group => group.threadId))];
  const threads = await db.articleThread.findMany({ where: { id: { in: threadIds } }, select: { id: true, materia: true } });
  const materiaOf = new Map(threads.map(thread => [thread.id, thread.materia]));
  return [...groups.values()]
    .filter(group => (materiaOf.has(group.threadId) ? moderatesSubject(roles, materiaOf.get(group.threadId)!) : roles.isModerator))
    .map(group => ({ ...group, materia: materiaOf.get(group.threadId) ?? null }))
    .sort((a, b) => a.reports[0].createdAt.getTime() - b.reports[0].createdAt.getTime());
}
