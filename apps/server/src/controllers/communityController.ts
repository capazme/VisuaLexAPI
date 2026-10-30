import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { parseItalian } from '../forum/parseItalian';
import { maybeSweepCommunity } from '../forum/sweep';
import { withDailyLimit } from '../forum/limits';
import { lockComment, lockThread } from '../forum/locks';
import { notify } from '../forum/notify';
import { readRoles } from '../forum/roles';
import { readReportReason } from '../forum/reportReasons';
import {
  ACCEPTED_SELECT, LISTED_THREAD, VISIBLE, VISIBLE_REPLY, acceptedId, authorView, decisionLabel, excerpt,
  isOwn, isPassageWithheld, isVisible, type Viewer,
} from '../forum/views';
import { COMMENT_MAX, REPLY_MAX, materiaSchema, parsePaging } from './articleDiscussionController';

// The Forum's Community (spec docs/superpowers/specs/2026-10-20-forum-community-glosse-design.md): the
// feed of every glossa, one glossa with its discussion, and what an author does to their own
// contributions. The feed and the glossa's route come from #205 (spec 2026-10-19-glosse-forum).

const FEED_SORTS = ['recent', 'popular', 'active', 'unanswered'] as const;

// The decision key space (`norms/decisionKey.ts`), then up to two more segments: the archive, or a
// TAR's seat and kind. No number or year: the filter names a court, `normaKey` names one decision.
const COURT_PREFIX = /^(?:cassazione|corte_costituzionale|corte_giustizia_ue|tribunale_ue|consiglio_di_stato|cgars|tar)(?::[a-z-]{1,20}){0,2}$/;

/** A LIKE prefix as Prisma sends it: `_` is a wildcard there, so it is escaped. */
const likePrefix = (prefix: string) => prefix.replace(/_/g, '\\_');

const trueOrFalse = (name: string) => z.enum(['true', 'false'], { message: `«${name}» deve essere «true» o «false»` }).optional();

const feedSchema = z.object({
  sort: z.enum(FEED_SORTS, { message: 'L’ordinamento deve essere «recent», «popular», «active» o «unanswered»' }).default('active'),
  kind: z.enum(['article', 'decision'], { message: 'Il tipo deve essere «article» o «decision»' }).optional(),
  // An act's key (the web's `buildNormaKey`): the glosse on any of its articles.
  act: z.string({ message: 'L’atto non è valido' }).regex(/^[a-z0-9_-]{1,300}$/, 'L’atto non è valido').optional(),
  // One article's key (the web's `buildItemKey`) or one decision's key.
  normaKey: z.string({ message: 'La chiave non è valida' }).min(1, 'La chiave non è valida').max(500, 'La chiave non è valida').optional(),
  // A court, or a court's segment, as a decision key begins: «cassazione», «cassazione:penale», «tar:roma».
  court: z.string({ message: 'La corte non è valida' }).regex(COURT_PREFIX, 'La corte non è valida').optional(),
  materia: materiaSchema.optional(),
  // «Le mie glosse»: the reader's own, never another user's.
  mine: trueOrFalse('mine'),
  // «Dove ho risposto»: a visible reply or comment of the reader's.
  participated: trueOrFalse('participated'),
  // false: answered, not settled; true: settled.
  accepted: trueOrFalse('accepted'),
}).superRefine((q, ctx) => {
  if (q.act !== undefined && q.normaKey !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Indica l’atto o la chiave, non entrambi' });
  }
  if (q.act !== undefined && q.kind === 'decision') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Un atto ha glosse sugli articoli, non sulle decisioni' });
  }
  if (q.court !== undefined && (q.act !== undefined || q.normaKey !== undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Indica la corte, l’atto o la chiave: uno solo' });
  }
  if (q.court !== undefined && q.kind === 'article') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Una corte ha glosse sulle decisioni, non sugli articoli' });
  }
});

const feedSelect = (viewerId: string) => ({
  id: true,
  normaKey: true,
  articleId: true,
  articleLabel: true,
  version: true,
  articleUrn: true,
  targetKind: true,
  decisionKey: true,
  passageQuote: true,
  passageReleasedAt: true,
  title: true,
  body: true,
  userId: true,
  materia: true,
  createdAt: true,
  lastActivityAt: true,
  editedAt: true,
  deletedAt: true,
  lockedAt: true,
  acceptedCommentId: true,
  acceptedComment: ACCEPTED_SELECT,
  user: { select: { id: true, username: true } },
  votes: { where: { userId: viewerId }, select: { id: true } },
  _count: { select: { votes: true, comments: { where: VISIBLE_REPLY } } },
}) satisfies Prisma.ArticleThreadSelect;

type FeedRow = Prisma.ArticleThreadGetPayload<{ select: ReturnType<typeof feedSelect> }>;

function target(thread: { targetKind: string; decisionKey: string | null }) {
  return thread.targetKind === 'decision' && thread.decisionKey
    ? { kind: 'decision' as const, key: thread.decisionKey }
    : { kind: 'article' as const };
}

function feedItemView(thread: FeedRow, viewer: Viewer) {
  const withheld = isPassageWithheld(thread, viewer);
  return {
    id: thread.id,
    title: thread.title,
    excerpt: excerpt(thread.body),
    normaKey: thread.normaKey,
    articleId: thread.articleId,
    articleLabel: thread.articleLabel,
    version: thread.version,
    articleUrn: thread.articleUrn,
    target: target(thread),
    decisionLabel: decisionLabel(thread),
    passage: thread.passageQuote === null ? null : { quote: withheld ? null : thread.passageQuote, withheld },
    user: authorView(thread),
    materia: thread.materia,
    voteCount: thread._count.votes,
    userVoted: thread.votes.length > 0,
    replyCount: thread._count.comments,
    acceptedCommentId: acceptedId(thread),
    createdAt: thread.createdAt,
    lastActivityAt: thread.lastActivityAt,
    editedAt: thread.editedAt,
    deleted: thread.deletedAt !== null,
    locked: thread.lockedAt !== null,
    isOwner: isOwn(thread.userId, viewer.id),
  };
}

/** The accepted reply, visible: a hidden or emptied one stops counting (§5.3). */
const SETTLED: Prisma.ArticleThreadWhereInput = { acceptedComment: VISIBLE };

export const listFeed = async (req: Request, res: Response) => {
  const query = parseItalian(feedSchema, req.query);
  const { page, limit } = parsePaging(req.query);
  const viewer = { id: req.user!.id, isAdmin: Boolean(req.user!.isAdmin) };

  const and: Prisma.ArticleThreadWhereInput[] = [LISTED_THREAD];
  if (query.kind) and.push({ targetKind: query.kind });
  // the act's key and then «--»: «legge--241--…» is not an article of «legge--24». The key's segments
  // are not typed, so an act named without its date also reads the dated acts of that number (the web
  // always sends the date it has).
  if (query.act) and.push({ targetKind: 'article', normaKey: { startsWith: `${likePrefix(query.act)}--` } });
  // the court's prefix and then «:», as for an act: «tar:rom» is not «tar:roma».
  if (query.court) and.push({ targetKind: 'decision', decisionKey: { startsWith: `${likePrefix(query.court)}:` } });
  if (query.normaKey) and.push({ normaKey: query.normaKey });
  if (query.materia) and.push({ materia: query.materia });
  if (query.mine === 'true') and.push({ userId: viewer.id });
  if (query.participated === 'true') and.push({ comments: { some: { ...VISIBLE, userId: viewer.id } } });
  if (query.accepted === 'true') and.push(SETTLED);
  if (query.accepted === 'false') and.push({ comments: { some: VISIBLE_REPLY } }, { NOT: SETTLED });
  if (query.sort === 'unanswered') and.push({ comments: { none: VISIBLE_REPLY } });
  const where: Prisma.ArticleThreadWhereInput = { AND: and };

  const orderBy: Prisma.ArticleThreadOrderByWithRelationInput[] = query.sort === 'popular'
    ? [{ votes: { _count: 'desc' } }, { createdAt: 'desc' }, { id: 'desc' }]
    : query.sort === 'active'
      ? [{ lastActivityAt: 'desc' }, { id: 'desc' }]
      : [{ createdAt: 'desc' }, { id: 'desc' }];

  const [total, threads] = await Promise.all([
    prisma.articleThread.count({ where }),
    prisma.articleThread.findMany({ where, select: feedSelect(viewer.id), orderBy, skip: (page - 1) * limit, take: limit }),
  ]);

  res.json({
    data: threads.map(thread => feedItemView(thread, viewer)),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
};

type CommentRow = Prisma.ArticleCommentGetPayload<{ include: { user: { select: { id: true; username: true } }; votes: true } }>;

/**
 * One reply or comment as its page shows it. Visible: its text and author. Hidden: its text with the
 * moderation's notice to its author and to moderators, else a bare place («removed»). Emptied by its
 * author: a bare place, without the author's name.
 */
function itemView(item: CommentRow, viewer: { id: string; isModerator: boolean }) {
  const own = isOwn(item.userId, viewer.id);
  const shown = item.deletedAt === null && (!item.isHidden || own || viewer.isModerator);
  return {
    id: item.id,
    parentId: item.parentId,
    body: shown ? item.body : '',
    user: item.isHidden && !shown ? { id: null, username: '' } : authorView(item),
    createdAt: item.createdAt,
    editedAt: item.editedAt,
    deleted: item.deletedAt !== null,
    removed: item.isHidden && !shown,
    hidden: item.isHidden && shown ? { category: item.hiddenReason } : null,
    voteCount: item.votes.length,
    userVoted: item.votes.some(vote => vote.userId === viewer.id),
    isOwner: own,
  };
}

/**
 * One glossa with its discussion, for its page in the Community. Replies come with their comments
 * nested, a third level stored before the rule of two flattened under its reply; the accepted reply
 * first, then by votes, then the oldest (§5.2). A hidden or emptied item stays as a place only where
 * something visible hangs on it. A hidden glossa is a 404 but to its author and to moderators; an emptied
 * one with nothing visible under it is a 404 to everyone.
 */
export const getThread = async (req: Request, res: Response) => {
  const viewerId = req.user!.id;
  const roles = await readRoles(prisma, viewerId);
  const viewer = { id: viewerId, isAdmin: roles.isAdmin, isModerator: roles.isModerator };
  const thread = await prisma.articleThread.findUnique({
    where: { id: req.params.threadId },
    include: {
      user: { select: { id: true, username: true } },
      acceptedComment: ACCEPTED_SELECT,
      comments: { orderBy: { createdAt: 'asc' }, include: { user: { select: { id: true, username: true } }, votes: true } },
      votes: true,
    },
  });
  const own = thread ? isOwn(thread.userId, viewerId) : false;
  if (!thread || (thread.isHidden && !own && !viewer.isModerator)) throw new AppError(404, 'Glossa non trovata');

  const byId = new Map(thread.comments.map(comment => [comment.id, comment]));
  const replyOf = (comment: CommentRow): CommentRow => {
    let current = comment;
    for (let depth = 0; current.parentId && depth < 4; depth += 1) {
      const parent = byId.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    return current;
  };
  // What a reader may see of an item: visible, or their own or a moderator's hidden one.
  const readable = (item: CommentRow) => isVisible(item) || (item.isHidden && item.deletedAt === null && (isOwn(item.userId, viewerId) || viewer.isModerator));
  const commentsOf = new Map<string, CommentRow[]>();
  for (const comment of thread.comments) {
    if (comment.parentId === null) continue;
    const reply = replyOf(comment);
    if (!commentsOf.has(reply.id)) commentsOf.set(reply.id, []);
    commentsOf.get(reply.id)!.push(comment);
  }
  const accepted = acceptedId(thread);
  const replies = thread.comments
    .filter(comment => comment.parentId === null)
    .map(reply => ({ reply, comments: (commentsOf.get(reply.id) ?? []).filter(readable) }))
    .filter(({ reply, comments }) => readable(reply) || comments.length > 0)
    .sort((a, b) => (Number(b.reply.id === accepted) - Number(a.reply.id === accepted))
      || (b.reply.votes.length - a.reply.votes.length)
      || (a.reply.createdAt.getTime() - b.reply.createdAt.getTime()));
  if (thread.deletedAt !== null && !thread.comments.some(isVisible)) throw new AppError(404, 'Glossa non trovata');

  const withheld = isPassageWithheld(thread, viewer);
  res.json({
    id: thread.id,
    normaKey: thread.normaKey,
    articleId: thread.articleId,
    articleLabel: thread.articleLabel,
    version: thread.version,
    target: target(thread),
    decisionLabel: decisionLabel(thread),
    title: thread.title,
    body: thread.body,
    // the context around the words could hold what was withdrawn: the passage goes whole
    passage: thread.passageQuote === null || thread.passageStart === null || withheld
      ? null
      : { quote: thread.passageQuote, start: thread.passageStart, prefix: thread.passagePrefix ?? '', suffix: thread.passageSuffix ?? '' },
    passageWithheld: withheld,
    passageReleased: thread.passageReleasedAt !== null,
    articleUrn: thread.articleUrn,
    textHash: thread.textHash,
    user: authorView(thread),
    materia: thread.materia,
    createdAt: thread.createdAt,
    lastActivityAt: thread.lastActivityAt,
    editedAt: thread.editedAt,
    deleted: thread.deletedAt !== null,
    locked: thread.lockedAt !== null,
    hidden: thread.isHidden ? { category: thread.hiddenReason } : null,
    acceptedCommentId: accepted,
    voteCount: thread.votes.length,
    userVoted: thread.votes.some(vote => vote.userId === viewerId),
    replyCount: thread.comments.filter(comment => comment.parentId === null && isVisible(comment)).length,
    isOwner: own,
    replies: replies.map(({ reply, comments }) => ({
      ...itemView(reply, viewer),
      accepted: reply.id === accepted,
      comments: comments.map(comment => ({ ...itemView(comment, viewer), parentId: reply.id })),
    })),
  });
};

const editThreadSchema = z.object({
  title: z.string({ message: 'Il titolo non è valido' }).trim().max(200, 'Il titolo può avere al massimo 200 caratteri').optional(),
  body: z.string({ message: 'Il testo non è valido' }).trim().min(3, 'Il testo deve avere almeno 3 caratteri')
    .max(10000, 'Il testo può avere al massimo 10000 caratteri').optional(),
  materia: materiaSchema.nullable().optional(),
}, { message: 'La richiesta non è valida' })
  .refine((b) => b.title !== undefined || b.body !== undefined || b.materia !== undefined, 'Nessuna modifica richiesta');

const editCommentSchema = z.object({
  body: z.string({ message: 'Il testo è obbligatorio' }).trim().min(1, 'Il testo è obbligatorio')
    .max(REPLY_MAX, `Il testo può avere al massimo ${REPLY_MAX} caratteri`),
}, { message: 'La richiesta non è valida' });

/**
 * The author edits a glossa's title, body and subject, never its anchor (§5.5). «Modificata» marks a
 * change of the text, not of the subject; the last activity does not move. Not on a hidden or emptied
 * glossa. No licence check yet (pending PR2c).
 */
export const editThread = async (req: Request, res: Response) => {
  const data = parseItalian(editThreadSchema, req.body);
  const userId = req.user!.id;
  await maybeSweepCommunity();
  const answer = await withDailyLimit('edit', userId, () => prisma.$transaction(async (tx) => {
    if (!(await lockThread(tx, req.params.threadId))) throw new AppError(404, 'Glossa non trovata');
    const thread = await tx.articleThread.findUniqueOrThrow({ where: { id: req.params.threadId } });
    if (!isVisible(thread)) throw new AppError(404, 'Glossa non trovata');
    if (!isOwn(thread.userId, userId)) throw new AppError(403, 'Puoi modificare solo le tue glosse');
    const title = data.title ?? thread.title;
    if (thread.passageQuote === null && title.length < 3) {
      throw new AppError(400, 'Il titolo è obbligatorio (almeno 3 caratteri) per una glossa senza un passo citato');
    }
    if (title.length > 0 && title.length < 3) throw new AppError(400, 'Il titolo, se indicato, deve avere almeno 3 caratteri');
    const textChanged = title !== thread.title || (data.body !== undefined && data.body !== thread.body);
    const updated = await tx.articleThread.update({
      where: { id: thread.id },
      data: {
        title,
        ...(data.body !== undefined ? { body: data.body } : {}),
        ...(data.materia !== undefined ? { materia: data.materia } : {}),
        ...(textChanged ? { editedAt: new Date() } : {}),
      },
    });
    return { id: updated.id, title: updated.title, body: updated.body, materia: updated.materia, editedAt: updated.editedAt };
  }));
  res.json(answer);
};

export const editComment = async (req: Request, res: Response) => {
  const data = parseItalian(editCommentSchema, req.body);
  const userId = req.user!.id;
  await maybeSweepCommunity();
  const answer = await withDailyLimit('edit', userId, () => prisma.$transaction(async (tx) => {
    const found = await tx.articleComment.findUnique({ where: { id: req.params.commentId }, select: { threadId: true } });
    if (!found || !(await lockThread(tx, found.threadId)) || !(await lockComment(tx, req.params.commentId))) {
      throw new AppError(404, 'Risposta non trovata');
    }
    const comment = await tx.articleComment.findUniqueOrThrow({ where: { id: req.params.commentId } });
    if (!isVisible(comment)) throw new AppError(404, 'Risposta non trovata');
    if (!isOwn(comment.userId, userId)) throw new AppError(403, 'Puoi modificare solo le tue risposte');
    if (comment.parentId !== null && data.body.length > COMMENT_MAX) {
      throw new AppError(400, `Un commento può avere al massimo ${COMMENT_MAX} caratteri`);
    }
    const updated = await tx.articleComment.update({
      where: { id: comment.id },
      data: { body: data.body, ...(data.body !== comment.body ? { editedAt: new Date() } : {}) },
    });
    return { id: updated.id, body: updated.body, editedAt: updated.editedAt };
  }));
  res.json(answer);
};

/**
 * The author deletes a glossa (§5.5). Under the glossa's lock, so no reply lands in between: with no
 * row of anyone else under it, hidden ones included, it is deleted with its own replies; otherwise its
 * title and body are emptied, and the others' replies stay theirs. Emptied text is not kept, save the
 * copy a report keeps for the moderators (G-308).
 */
export const deleteThread = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  await maybeSweepCommunity();
  const outcome = await prisma.$transaction(async (tx) => {
    if (!(await lockThread(tx, req.params.threadId))) throw new AppError(404, 'Glossa non trovata');
    const thread = await tx.articleThread.findUniqueOrThrow({ where: { id: req.params.threadId } });
    if (thread.deletedAt !== null || (thread.isHidden && !isOwn(thread.userId, userId))) throw new AppError(404, 'Glossa non trovata');
    if (!isOwn(thread.userId, userId)) throw new AppError(403, 'Puoi cancellare solo le tue glosse');
    const others = await tx.articleComment.count({ where: { threadId: thread.id, OR: [{ userId: { not: userId } }, { userId: null }] } });
    if (others === 0) {
      await tx.articleThread.delete({ where: { id: thread.id } });
      return 'deleted' as const;
    }
    await tx.articleThread.update({ where: { id: thread.id }, data: { title: '', body: '', deletedAt: new Date() } });
    return 'emptied' as const;
  });
  res.json({ outcome });
};

/**
 * The author deletes a reply or a comment (§5.5): deleted when nothing hangs on it (no row under it,
 * hidden ones included, and not the accepted reply), else emptied in place, its comments kept.
 */
export const deleteComment = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  await maybeSweepCommunity();
  const outcome = await prisma.$transaction(async (tx) => {
    const found = await tx.articleComment.findUnique({ where: { id: req.params.commentId }, select: { threadId: true } });
    if (!found || !(await lockThread(tx, found.threadId)) || !(await lockComment(tx, req.params.commentId))) {
      throw new AppError(404, 'Risposta non trovata');
    }
    const comment = await tx.articleComment.findUniqueOrThrow({ where: { id: req.params.commentId }, include: { thread: { select: { acceptedCommentId: true } } } });
    if (comment.deletedAt !== null || (comment.isHidden && !isOwn(comment.userId, userId))) throw new AppError(404, 'Risposta non trovata');
    if (!isOwn(comment.userId, userId)) throw new AppError(403, 'Puoi cancellare solo le tue risposte');
    const under = await tx.articleComment.count({ where: { parentId: comment.id } });
    if (under === 0 && comment.thread.acceptedCommentId !== comment.id) {
      await tx.articleComment.delete({ where: { id: comment.id } });
      return 'deleted' as const;
    }
    await tx.articleComment.update({ where: { id: comment.id }, data: { body: '', deletedAt: new Date() } });
    return 'emptied' as const;
  });
  res.json({ outcome });
};

const acceptSchema = z.object({
  commentId: z.string({ message: 'La risposta non è valida' }).guid('La risposta non è valida').nullable(),
}, { message: 'La richiesta non è valida' });

/**
 * The glossa's author marks the reply that settled it, or withdraws the mark (`commentId: null`); one at
 * a time (§5.3, G-292). A visible reply of someone else, anonymous ones included; a locked glossa may
 * still change it; a glossa whose author is gone keeps it as it is.
 */
export const acceptReply = async (req: Request, res: Response) => {
  const data = parseItalian(acceptSchema, req.body);
  const userId = req.user!.id;
  await maybeSweepCommunity();
  const acceptedCommentId = await prisma.$transaction(async (tx) => {
    if (!(await lockThread(tx, req.params.threadId))) throw new AppError(404, 'Glossa non trovata');
    const thread = await tx.articleThread.findUniqueOrThrow({ where: { id: req.params.threadId } });
    if (!isVisible(thread)) throw new AppError(404, 'Glossa non trovata');
    if (!isOwn(thread.userId, userId)) throw new AppError(403, 'Solo l’autore della glossa sceglie la risposta accettata');
    let reply: { id: string; userId: string | null } | null = null;
    if (data.commentId !== null) {
      reply = await tx.articleComment.findFirst({ where: { id: data.commentId, threadId: thread.id, ...VISIBLE_REPLY } });
      if (!reply) throw new AppError(404, 'Risposta non trovata');
      if (isOwn(reply.userId, userId)) throw new AppError(400, 'Non puoi accettare una tua risposta');
    }
    await tx.articleThread.update({ where: { id: thread.id }, data: { acceptedCommentId: data.commentId } });
    if (reply && reply.id !== thread.acceptedCommentId) {
      await notify(tx, { to: reply.userId, by: userId, kind: 'accepted', threadId: thread.id, commentId: reply.id });
    }
    return data.commentId;
  });
  res.json({ acceptedCommentId });
};

const reportSchema = z.object({
  reason: z.string({ message: 'Il motivo è obbligatorio' }).trim().min(2, 'Il motivo è obbligatorio')
    .max(80, 'Il motivo può avere al massimo 80 caratteri'),
  details: z.string({ message: 'I dettagli non sono validi' }).trim().max(1000, 'I dettagli possono avere al massimo 1000 caratteri').optional(),
});

/** A reply or a comment reported (§5.7), one report per user, keeping a copy of its text (G-308). */
export const reportComment = async (req: Request, res: Response) => {
  const data = parseItalian(reportSchema, req.body);
  const userId = req.user!.id;
  await maybeSweepCommunity();
  const comment = await prisma.articleComment.findUnique({ where: { id: req.params.commentId } });
  if (!comment || comment.deletedAt !== null) throw new AppError(404, 'Risposta non trovata');
  if (isOwn(comment.userId, userId)) throw new AppError(400, 'Non puoi segnalare un tuo contributo');
  const { reason, details } = readReportReason(data.reason, data.details);
  const report = { reason, details, status: 'pending', reportedText: comment.body, resolvedAt: null, resolvedById: null, resolutionNote: null };
  await withDailyLimit('report', userId, () => prisma.articleCommentReport.upsert({
    where: { commentId_userId: { commentId: comment.id, userId } },
    create: { commentId: comment.id, threadId: comment.threadId, userId, ...report },
    update: report,
  }));
  res.status(204).send();
};
