import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { parseItalian } from '../forum/parseItalian';
import { maybeSweepCommunity } from '../forum/sweep';
import { lockComment, lockThread } from '../forum/locks';
import { notify } from '../forum/notify';
import { logModeration } from '../forum/moderationLog';
import { readRoles, requireModerator, requireModeratorOf } from '../forum/roles';
import { readReportGroups } from '../forum/reportQueue';
import { closeAppealsShown } from '../forum/appeals';
import { withdrawValidations } from '../forum/validation';
import { REPORT_REASONS } from '../forum/reportReasons';
import { decisionLabel, profileFace } from '../forum/views';
import { parsePaging } from './articleDiscussionController';

// The Community's moderation (spec 2026-10-20-forum-community-glosse-design §5.7, G-266): the reports'
// queue, one decision per reported item, hiding and locking, every act in the log with its reason. For
// moderators and administrators, read from the database on every call. The glossa's author has no
// moderation power over the replies to it.

const reasonSchema = z.string({ message: 'Il motivo è obbligatorio' }).trim().min(3, 'Il motivo deve avere almeno 3 caratteri')
  .max(1000, 'Il motivo può avere al massimo 1000 caratteri');
const categorySchema = z.enum(REPORT_REASONS, { message: 'La categoria non è valida' });
const kindSchema = z.enum(['thread', 'comment'], { message: 'Il tipo deve essere «thread» o «comment»' });

const queueSchema = z.object({
  status: z.enum(['pending', 'resolved', 'dismissed'], { message: 'Lo stato deve essere «pending», «resolved» o «dismissed»' }).default('pending'),
});

const AUTHOR_PROFILE = {
  id: true, identity: true, realName: true, pseudonym: true, qualification: true, nameWithdrawnAt: true,
} as const;


/**
 * The reports' queue: one row per reported item with its reports grouped, oldest first. The item's
 * full text even if hidden, its anchor whole (a moderator must read what was reported, the decision's
 * quotation included), each report's copy of the text, and «deleted» when the item is gone for good.
 * The reporters are not named.
 */
export const listReports = async (req: Request, res: Response) => {
  const roles = await requireModerator(prisma, req.user!.id);
  const { status } = parseItalian(queueSchema, req.query);
  const { page, limit } = parsePaging(req.query);
  await maybeSweepCommunity();

  // A subject's moderator has their subject's items alone (spec 2026-11-14 §C).
  const ordered = await readReportGroups(prisma, status, roles);
  const pageRows = ordered.slice((page - 1) * limit, page * limit);

  const threadIds = [...new Set(pageRows.map(row => row.threadId))];
  const commentIds = pageRows.filter(row => row.kind === 'comment').map(row => row.itemId);
  // The author's account username and, with a profile (spec 2026-11-14 §B), the public name.
  const author = { select: { username: true, forumProfile: { select: AUTHOR_PROFILE } } } as const;
  const [threads, comments] = await Promise.all([
    prisma.articleThread.findMany({ where: { id: { in: threadIds } }, include: { user: author } }),
    prisma.articleComment.findMany({ where: { id: { in: commentIds } }, include: { user: author } }),
  ]);
  const threadById = new Map(threads.map(thread => [thread.id, thread]));
  const commentById = new Map(comments.map(comment => [comment.id, comment]));

  res.json({
    data: pageRows.map(({ kind, itemId, threadId, materia, reports }) => {
      const thread = threadById.get(threadId) ?? null;
      const item = kind === 'thread' ? thread : commentById.get(itemId) ?? null;
      return {
        kind,
        itemId,
        threadId,
        materia,
        count: reports.length,
        reasons: [...new Set(reports.map(report => report.reason))],
        firstReportedAt: reports[0].createdAt,
        reports: reports.map(report => ({
          reason: report.reason, details: report.details, status: report.status, createdAt: report.createdAt,
          reportedText: report.reportedText, resolvedAt: report.resolvedAt, resolutionNote: report.resolutionNote,
        })),
        // Gone for good: its author deleted it when nothing hung on it (§5.5); the reports' copies remain.
        deleted: item === null,
        item: item && {
          title: kind === 'thread' && thread ? thread.title : null,
          body: item.body,
          // The account's username is for the owners and the whole Community's moderators; a subject's
          // moderator reads the public name and the profile's id alone (§C).
          author: roles.isModerator ? item.user?.username ?? null : null,
          authorName: item.user?.forumProfile ? profileFace(item.user.forumProfile).name : null,
          authorId: item.user?.forumProfile?.id ?? null,
          isHidden: item.isHidden,
          hiddenReason: item.hiddenReason,
          emptied: item.deletedAt !== null,
          editedAt: item.editedAt,
        },
        anchor: thread && {
          normaKey: thread.normaKey,
          articleId: thread.articleId,
          articleLabel: thread.articleLabel,
          decisionLabel: decisionLabel(thread),
          passage: thread.passageQuote,
        },
      };
    }),
    pagination: { page, limit, total: ordered.length, pages: Math.ceil(ordered.length / limit) },
  });
};

const resolveSchema = z.object({
  action: z.enum(['hide', 'dismiss'], { message: 'L’azione deve essere «hide» o «dismiss»' }),
  category: categorySchema.optional(),
  reason: reasonSchema,
}, { message: 'La richiesta non è valida' }).superRefine((b, ctx) => {
  if (b.action === 'hide' && !b.category) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Per nascondere serve una categoria' });
});

/**
 * One decision per reported item: closes all its pending reports at once, hides the item or not, and
 * logs it. Works on an item deleted for good (found by the reports' own kind and id), where only
 * dismissing is possible.
 */
export const resolveReports = async (req: Request, res: Response) => {
  const kind = parseItalian(kindSchema, req.params.kind);
  const body = parseItalian(resolveSchema, req.body);
  const actorId = req.user!.id;
  await maybeSweepCommunity();
  const outcome = await prisma.$transaction(async (tx) => {
    const roles = await requireModerator(tx, actorId);
    const itemId = req.params.itemId;
    const pendingWhere = kind === 'thread' ? { threadId: itemId, status: 'pending' } : { commentId: itemId, status: 'pending' };
    const first = kind === 'thread'
      ? await tx.articleThreadReport.findFirst({ where: pendingWhere, select: { threadId: true } })
      : await tx.articleCommentReport.findFirst({ where: pendingWhere, select: { threadId: true } });
    if (!first) throw new AppError(404, 'Nessuna segnalazione aperta su questo contributo');
    // The subject, read after the glossa's lock (its author may move it); an item whose glossa is gone
    // for good is the whole Community's moderators' (§C).
    if (await lockThread(tx, first.threadId)) {
      const { materia } = await tx.articleThread.findUniqueOrThrow({ where: { id: first.threadId }, select: { materia: true } });
      requireModeratorOf(roles, materia);
    } else {
      requireModeratorOf(roles, null);
    }

    if (body.action === 'hide') {
      const hidden = await hideItem(tx, kind, itemId, body.category!, actorId);
      if (!hidden) throw new AppError(409, 'Il contributo non c’è più: si può solo archiviare la segnalazione');
    }
    const closing = {
      status: body.action === 'hide' ? 'resolved' : 'dismissed',
      resolvedAt: new Date(), resolvedById: actorId, resolutionNote: body.reason,
    };
    const { count } = kind === 'thread'
      ? await tx.articleThreadReport.updateMany({ where: pendingWhere, data: closing })
      : await tx.articleCommentReport.updateMany({ where: pendingWhere, data: closing });
    // Another moderator closed them meanwhile: nothing of this decision stays.
    if (count === 0) throw new AppError(404, 'Nessuna segnalazione aperta su questo contributo');
    await logModeration(tx, body.action === 'hide'
      ? { actorId, action: 'hide', targetKind: kind, targetId: itemId, reason: body.reason }
      : { actorId, action: 'dismiss', targetKind: 'report', targetId: `${kind}:${itemId}`, reason: body.reason });
    return { closed: count, status: closing.status };
  });
  res.json(outcome);
};

/**
 * Hides a glossa or a reply under a category and tells its author; false when the item is gone. One
 * already hidden stays as it is: its category and its author's notice are those of the first hiding.
 */
async function hideItem(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  kind: 'thread' | 'comment',
  itemId: string,
  category: string,
  actorId: string,
): Promise<boolean> {
  if (kind === 'thread') {
    if (!(await lockThread(tx, itemId))) return false;
    if ((await tx.articleThread.findUniqueOrThrow({ where: { id: itemId } })).isHidden) return true;
    const thread = await tx.articleThread.update({ where: { id: itemId }, data: { isHidden: true, hiddenReason: category, hiddenAt: new Date() } });
    await notify(tx, { to: thread.userId, by: actorId, kind: 'hidden', threadId: thread.id });
    return true;
  }
  const found = await tx.articleComment.findUnique({ where: { id: itemId }, select: { threadId: true } });
  if (!found || !(await lockThread(tx, found.threadId)) || !(await lockComment(tx, itemId))) return false;
  if ((await tx.articleComment.findUniqueOrThrow({ where: { id: itemId } })).isHidden) return true;
  const comment = await tx.articleComment.update({ where: { id: itemId }, data: { isHidden: true, hiddenReason: category, hiddenAt: new Date() } });
  await notify(tx, { to: comment.userId, by: actorId, kind: 'hidden', threadId: comment.threadId, commentId: comment.id });
  return true;
}

const moderateThreadSchema = z.object({
  hidden: z.boolean({ message: '«hidden» deve essere vero o falso' }).optional(),
  locked: z.boolean({ message: '«locked» deve essere vero o falso' }).optional(),
  category: categorySchema.optional(),
  reason: reasonSchema,
}, { message: 'La richiesta non è valida' }).superRefine((b, ctx) => {
  if (b.hidden === undefined && b.locked === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Nessuna modifica richiesta' });
  if (b.hidden === true && !b.category) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Per nascondere serve una categoria' });
});

const moderateCommentSchema = z.object({
  hidden: z.boolean({ message: '«hidden» deve essere vero o falso' }),
  category: categorySchema.optional(),
  reason: reasonSchema,
}, { message: 'La richiesta non è valida' }).superRefine((b, ctx) => {
  if (b.hidden && !b.category) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Per nascondere serve una categoria' });
});

/**
 * Hides or shows a glossa again, locks or unlocks it. The category is shown to the author; the free
 * reason goes only to the log, which only moderators and administrators read (it may name who
 * reported).
 */
export const moderateThread = async (req: Request, res: Response) => {
  const body = parseItalian(moderateThreadSchema, req.body);
  const actorId = req.user!.id;
  const answer = await prisma.$transaction(async (tx) => {
    const roles = await requireModerator(tx, actorId);
    if (!(await lockThread(tx, req.params.threadId))) throw new AppError(404, 'Glossa non trovata');
    const thread = await tx.articleThread.findUniqueOrThrow({ where: { id: req.params.threadId } });
    requireModeratorOf(roles, thread.materia);
    const data: { isHidden?: boolean; hiddenReason?: string | null; hiddenAt?: Date | null; lockedAt?: Date | null; lockedById?: string | null } = {};
    if (body.hidden !== undefined && body.hidden !== thread.isHidden) {
      data.isHidden = body.hidden;
      data.hiddenReason = body.hidden ? body.category! : null;
      data.hiddenAt = body.hidden ? new Date() : null;
      if (!body.hidden) await closeAppealsShown(tx, 'thread', thread.id, actorId);
      await logModeration(tx, { actorId, action: body.hidden ? 'hide' : 'unhide', targetKind: 'thread', targetId: thread.id, reason: body.reason });
      if (body.hidden) await notify(tx, { to: thread.userId, by: actorId, kind: 'hidden', threadId: thread.id });
    }
    if (body.locked !== undefined && body.locked !== (thread.lockedAt !== null)) {
      data.lockedAt = body.locked ? new Date() : null;
      data.lockedById = body.locked ? actorId : null;
      await logModeration(tx, { actorId, action: body.locked ? 'lock' : 'unlock', targetKind: 'thread', targetId: thread.id, reason: body.reason });
    }
    const updated = await tx.articleThread.update({ where: { id: thread.id }, data });
    return { id: updated.id, hidden: updated.isHidden, hiddenReason: updated.hiddenReason, locked: updated.lockedAt !== null };
  });
  res.json(answer);
};

export const moderateComment = async (req: Request, res: Response) => {
  const body = parseItalian(moderateCommentSchema, req.body);
  const actorId = req.user!.id;
  const answer = await prisma.$transaction(async (tx) => {
    const roles = await requireModerator(tx, actorId);
    const found = await tx.articleComment.findUnique({ where: { id: req.params.commentId }, select: { threadId: true } });
    if (!found || !(await lockThread(tx, found.threadId)) || !(await lockComment(tx, req.params.commentId))) {
      throw new AppError(404, 'Risposta non trovata');
    }
    const { materia } = await tx.articleThread.findUniqueOrThrow({ where: { id: found.threadId }, select: { materia: true } });
    requireModeratorOf(roles, materia);
    const comment = await tx.articleComment.findUniqueOrThrow({ where: { id: req.params.commentId } });
    if (body.hidden !== comment.isHidden) {
      await tx.articleComment.update({
        where: { id: comment.id },
        data: { isHidden: body.hidden, hiddenReason: body.hidden ? body.category! : null, hiddenAt: body.hidden ? new Date() : null },
      });
      if (!body.hidden) await closeAppealsShown(tx, 'comment', comment.id, actorId);
      await logModeration(tx, { actorId, action: body.hidden ? 'hide' : 'unhide', targetKind: 'comment', targetId: comment.id, reason: body.reason });
      if (body.hidden) await notify(tx, { to: comment.userId, by: actorId, kind: 'hidden', threadId: comment.threadId, commentId: comment.id });
    }
    const current = await tx.articleComment.findUniqueOrThrow({ where: { id: comment.id } });
    return { id: current.id, hidden: current.isHidden, hiddenReason: current.hiddenReason };
  });
  res.json(answer);
};

const emptySchema = z.object({ reason: reasonSchema }, { message: 'La richiesta non è valida' });

/**
 * An administrator empties a contribution whose author's account is gone, on that person's request
 * (spec 2026-10-20 §7.3: erasure stays possible after the account), as the author's own deletion
 * empties it, logged with the request as the reason. A contribution with an author is theirs to delete.
 */
export const emptyContribution = async (req: Request, res: Response) => {
  const kind = parseItalian(kindSchema, req.params.kind);
  const { reason } = parseItalian(emptySchema, req.body);
  const actorId = req.user!.id;
  await prisma.$transaction(async (tx) => {
    if (!(await readRoles(tx, actorId)).isAdmin) throw new AppError(403, 'Riservato agli amministratori');
    if (kind === 'thread') {
      if (!(await lockThread(tx, req.params.itemId))) throw new AppError(404, 'Glossa non trovata');
      const thread = await tx.articleThread.findUniqueOrThrow({ where: { id: req.params.itemId } });
      if (thread.userId !== null) throw new AppError(409, 'La glossa ha un autore: la cancella lui');
      if (thread.deletedAt === null) {
        await tx.articleThread.update({ where: { id: thread.id }, data: { title: '', body: '', deletedAt: new Date() } });
        await withdrawValidations(tx, { threadId: thread.id });
      }
    } else {
      const found = await tx.articleComment.findUnique({ where: { id: req.params.itemId }, select: { threadId: true } });
      if (!found || !(await lockThread(tx, found.threadId)) || !(await lockComment(tx, req.params.itemId))) {
        throw new AppError(404, 'Risposta non trovata');
      }
      const comment = await tx.articleComment.findUniqueOrThrow({ where: { id: req.params.itemId } });
      if (comment.userId !== null) throw new AppError(409, 'La risposta ha un autore: la cancella lui');
      if (comment.deletedAt === null) {
        await tx.articleComment.update({ where: { id: comment.id }, data: { body: '', deletedAt: new Date() } });
        await withdrawValidations(tx, { commentId: comment.id });
      }
    }
    await logModeration(tx, { actorId, action: 'empty', targetKind: kind, targetId: req.params.itemId, reason });
  });
  res.json({ outcome: 'emptied' });
};
