import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { LOG_REASON_ERASED, maybeSweepCommunity, startCommunitySweeper, sweepCommunity } from '../src/forum/sweep';
import { createTestUser } from './helpers';

/**
 * How long a closed report keeps what people wrote in it (G-503): the reporter's details and the moderator's note go
 * 12 months after the report is closed, and the record stays. The copy of the reported text keeps its own 90 days
 * (G-308), and an open report keeps everything.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const DETAILS = 'Scritto da chi segnala';
const NOTE = 'Scritto dal moderatore';

/** `months` calendar months before `now`, then `days` more (negative: fewer). */
function before(now: Date, months: number, days = 0): Date {
  const date = new Date(now);
  date.setUTCMonth(date.getUTCMonth() - months);
  return new Date(date.getTime() - days * DAY_MS);
}

describe('a closed report on a glossa or a reply', () => {
  it('loses the details and the note 12 months after it was closed, and keeps the rest', async () => {
    const now = new Date();
    const [anna, bruno, carla, dario, ezio] = await Promise.all(
      ['ret-anna', 'ret-bruno', 'ret-carla', 'ret-dario', 'ret-ezio'].map((name) => createTestUser(name)),
    );
    const threadId = randomUUID();
    const threadReport = (userId: string, status: string, resolvedAt: Date | null, reportedText: string | null = null) =>
      prisma.articleThreadReport.create({
        data: { threadId, userId, reason: 'altro', details: DETAILS, status, resolvedAt, resolutionNote: resolvedAt ? NOTE : null, reportedText },
      });
    const yearOld = await threadReport(anna.id, 'resolved', before(now, 12, 1));
    const almostYearOld = await threadReport(bruno.id, 'dismissed', before(now, 12, -1));
    const open = await threadReport(carla.id, 'pending', null, 'copia');
    // Open again with an old closing date still on it: open is open.
    await prisma.articleThreadReport.update({ where: { id: open.id }, data: { createdAt: before(now, 24), resolvedAt: before(now, 13) } });
    // Only the moderator wrote something.
    const noteOnly = await prisma.articleThreadReport.create({
      data: { threadId, userId: ezio.id, reason: 'spam', status: 'dismissed', resolvedAt: before(now, 13), resolutionNote: NOTE },
    });
    const commentReport = await prisma.articleCommentReport.create({
      data: {
        commentId: randomUUID(), threadId, userId: dario.id, reason: 'altro', details: DETAILS, status: 'dismissed',
        resolvedAt: before(now, 13), resolutionNote: NOTE,
      },
    });

    expect(await sweepCommunity(now)).toMatchObject({ reportDetails: 3 });

    const row = (id: string) => prisma.articleThreadReport.findUniqueOrThrow({ where: { id } });
    expect(await row(yearOld.id)).toMatchObject({
      details: null, resolutionNote: null, reason: 'altro', status: 'resolved', resolvedAt: yearOld.resolvedAt, userId: anna.id,
    });
    expect(await row(almostYearOld.id)).toMatchObject({ details: DETAILS, resolutionNote: NOTE });
    expect(await row(open.id)).toMatchObject({ details: DETAILS, reportedText: 'copia', status: 'pending' });
    expect(await row(noteOnly.id)).toMatchObject({ details: null, resolutionNote: null, reason: 'spam' });
    expect(await prisma.articleCommentReport.findUniqueOrThrow({ where: { id: commentReport.id } }))
      .toMatchObject({ details: null, resolutionNote: null, status: 'dismissed' });

    // Nothing left to erase: a second pass touches nothing.
    expect(await sweepCommunity(now)).toMatchObject({ reportDetails: 0 });
  });

  it('keeps the copy of the reported text on its own 90 days, whatever happens to the details', async () => {
    const now = new Date();
    const reporter = await createTestUser('ret-copy');
    const report = await prisma.articleThreadReport.create({
      data: {
        threadId: randomUUID(), userId: reporter.id, reason: 'altro', details: DETAILS, status: 'dismissed',
        resolvedAt: before(now, 0, 91), resolutionNote: NOTE, reportedText: 'copia',
      },
    });
    await sweepCommunity(now);
    expect(await prisma.articleThreadReport.findUniqueOrThrow({ where: { id: report.id } }))
      .toMatchObject({ reportedText: null, details: DETAILS, resolutionNote: NOTE });
  });
});

describe('a closed report on a profile', () => {
  it('loses the moderator’s note 12 months after it was closed; its details keep their 90 days', async () => {
    const now = new Date();
    const [elena, fabio] = await Promise.all(['ret-elena', 'ret-fabio'].map((name) => createTestUser(name)));
    const profileId = randomUUID();
    const yearOld = await prisma.forumProfileReport.create({
      data: { profileId, userId: elena.id, details: DETAILS, status: 'confirmed', resolvedAt: before(now, 13), resolutionNote: NOTE },
    });
    const monthsOld = await prisma.forumProfileReport.create({
      data: { profileId, userId: fabio.id, details: DETAILS, status: 'dismissed', resolvedAt: before(now, 0, 100), resolutionNote: NOTE },
    });

    expect(await sweepCommunity(now)).toMatchObject({ profileReportNotes: 1, profileReportDetails: 2 });

    const row = (id: string) => prisma.forumProfileReport.findUniqueOrThrow({ where: { id } });
    expect(await row(yearOld.id)).toMatchObject({ details: null, resolutionNote: null, status: 'confirmed' });
    expect(await row(monthsOld.id)).toMatchObject({ details: null, resolutionNote: NOTE });
  });
});

describe('the moderation log', () => {
  it('keeps the action and who decided it, and replaces the reason with «(tolto dopo 12 mesi)» after 12 months', async () => {
    const now = new Date();
    const moderator = await createTestUser('ret-moderator');
    const entry = (action: string, reason: string | null, createdAt: Date) => prisma.forumModerationLog.create({
      data: { actorId: moderator.id, action, targetKind: 'thread', targetId: randomUUID(), reason, createdAt },
    });
    const yearOld = await entry('hide', 'Nomina chi ha segnalato', before(now, 12, 1));
    const almostYearOld = await entry('lock', 'Ancora recente', before(now, 12, -1));
    const withoutReason = await entry('release_passage', null, before(now, 13));

    expect(await sweepCommunity(now)).toMatchObject({ moderationReasons: 1 });

    const row = (id: string) => prisma.forumModerationLog.findUniqueOrThrow({ where: { id } });
    expect(await row(yearOld.id)).toMatchObject({
      reason: LOG_REASON_ERASED, action: 'hide', actorId: moderator.id, targetId: yearOld.targetId, createdAt: yearOld.createdAt,
    });
    expect((await row(almostYearOld.id)).reason).toBe('Ancora recente');
    expect((await row(withoutReason.id)).reason).toBeNull();
    expect(LOG_REASON_ERASED).toBe('(tolto dopo 12 mesi)');

    expect(await sweepCommunity(now)).toMatchObject({ moderationReasons: 0 });
  });
});

describe('a sweep that fails', () => {
  it('is tried again at the next check, not a day later', async () => {
    const now = new Date();
    const reporter = await createTestUser('ret-retry');
    const report = await prisma.articleThreadReport.create({
      data: { threadId: randomUUID(), userId: reporter.id, reason: 'altro', details: DETAILS, status: 'dismissed', resolvedAt: before(now, 13) },
    });
    const down = vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('database down'));
    try {
      await expect(maybeSweepCommunity()).rejects.toThrow('database down');
    } finally {
      down.mockRestore();
    }
    await maybeSweepCommunity();
    expect((await prisma.articleThreadReport.findUniqueOrThrow({ where: { id: report.id } })).details).toBeNull();
  });
});

describe('the sweep without Forum activity', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a minute after the server starts, then every hour, logs a failure without its message, and stops', async () => {
    vi.useFakeTimers();
    const sweep = vi.fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('testo che può contenere dati'))
      .mockResolvedValue(undefined);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stop = startCommunitySweeper(sweep);
    try {
      await vi.advanceTimersByTimeAsync(59_000);
      expect(sweep).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(sweep).toHaveBeenCalledTimes(1);
      expect(errors).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(errors.mock.calls)).not.toContain('testo che può contenere dati');
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(sweep).toHaveBeenCalledTimes(2);
      stop();
      await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
      expect(sweep).toHaveBeenCalledTimes(2);
    } finally {
      stop();
      errors.mockRestore();
    }
  });
});
