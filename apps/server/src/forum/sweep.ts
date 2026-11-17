import { prisma } from '../lib/prisma';

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a closed report keeps its copy of the reported text, and a read notification lives. */
export const COMMUNITY_RETENTION_DAYS = 90;
/**
 * How long a closed report keeps what people wrote in it, the reporter's details and the moderator's note (G-503),
 * and the moderation log its reasons (G-550).
 */
export const REPORT_DETAILS_RETENTION_MONTHS = 12;
/** What a moderation log entry's reason becomes then: the action and who decided it stay (G-504, G-550). */
export const LOG_REASON_ERASED = '(tolto dopo 12 mesi)';

let lastSweep = 0;

/**
 * Erases the copy of the reported text from the reports closed more than 90 days ago (the report
 * stays, as a record: G-308), and the details of the reports «non è chi dice di essere» closed as long
 * ago (they may say things about the person: spec 2026-11-14 §B), and deletes the notifications read
 * more than 90 days ago (spec 2026-10-20-forum-community-glosse-design §5.7, §6.5). Twelve months after
 * a report was closed, it also loses the details its reporter wrote and the moderator's note (G-503);
 * its reason, status and dates stay. Twelve months after an entry of the moderation log was written, its
 * reason becomes «(tolto dopo 12 mesi)» (G-550): the reason may name people, and the moderator's note on a
 * report is written there too. Returns what it touched.
 */
export async function sweepCommunity(now: Date = new Date()) {
  const before = new Date(now.getTime() - COMMUNITY_RETENTION_DAYS * DAY_MS);
  const closedLongAgo = { status: { not: 'pending' }, resolvedAt: { lt: before }, reportedText: { not: null } };
  const yearBefore = new Date(now);
  yearBefore.setUTCMonth(yearBefore.getUTCMonth() - REPORT_DETAILS_RETENTION_MONTHS);
  const closedAYearAgo = { status: { not: 'pending' }, resolvedAt: { lt: yearBefore } };
  const withWords = { ...closedAYearAgo, OR: [{ details: { not: null } }, { resolutionNote: { not: null } }] };
  const noWords = { details: null, resolutionNote: null };
  const [
    threadReports, commentReports, notifications, profileReports, threadWords, commentWords, profileNotes, logReasons,
  ] = await prisma.$transaction([
      prisma.articleThreadReport.updateMany({ where: closedLongAgo, data: { reportedText: null } }),
      prisma.articleCommentReport.updateMany({ where: closedLongAgo, data: { reportedText: null } }),
      prisma.forumNotification.deleteMany({ where: { readAt: { lt: before } } }),
      prisma.forumProfileReport.updateMany({
        where: { status: { not: 'pending' }, resolvedAt: { lt: before }, details: { not: null } }, data: { details: null },
      }),
      prisma.articleThreadReport.updateMany({ where: withWords, data: noWords }),
      prisma.articleCommentReport.updateMany({ where: withWords, data: noWords }),
      prisma.forumProfileReport.updateMany({
        where: { ...closedAYearAgo, resolutionNote: { not: null } }, data: { resolutionNote: null },
      }),
      // A reason may be null only for releasing or withholding a quotation (a CHECK): those stay null.
      prisma.forumModerationLog.updateMany({
        where: { createdAt: { lt: yearBefore }, AND: [{ reason: { not: null } }, { reason: { not: LOG_REASON_ERASED } }] },
        data: { reason: LOG_REASON_ERASED },
      }),
    ]);
  return {
    reportCopies: threadReports.count + commentReports.count, notifications: notifications.count,
    profileReportDetails: profileReports.count, reportDetails: threadWords.count + commentWords.count,
    profileReportNotes: profileNotes.count, moderationReasons: logReasons.count,
  };
}

/**
 * Sweeps at most once a day, awaited by every Community route that writes (and, with pull request 2,
 * by the moderators' queue): never fire-and-forget work on the database, as the trash's `maybeSweep`.
 */
export async function maybeSweepCommunity(): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < DAY_MS) return;
  const previous = lastSweep;
  lastSweep = now;
  try {
    await sweepCommunity(new Date(now));
  } catch (err) {
    // A failed sweep is tried again at the next check, not a day later.
    lastSweep = previous;
    throw err;
  }
}

const FIRST_SWEEP_MS = 60_000;
const SWEEP_CHECK_MS = 60 * 60 * 1000;

/**
 * The timer `index.ts` starts, so the terms above hold when nobody writes in the Forum: a check a minute
 * after boot, then every hour; `maybeSweepCommunity` sweeps at most once a day. The timers do not keep
 * the process alive, and the function returned stops both. A failure is logged by its kind only: a
 * database error may quote what it was writing.
 */
export function startCommunitySweeper(sweep: () => Promise<void> = maybeSweepCommunity): () => void {
  const run = () => {
    sweep().catch((err: unknown) => {
      const code = (err as { code?: unknown } | null)?.code;
      const kind = err instanceof Error ? err.name : typeof err;
      console.error('[forum] community sweep failed:', typeof code === 'string' ? `${kind} ${code}` : kind);
    });
  };
  const first = setTimeout(run, FIRST_SWEEP_MS);
  first.unref();
  const timer = setInterval(run, SWEEP_CHECK_MS);
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
