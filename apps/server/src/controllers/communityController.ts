import { Request, Response } from 'express';
import { Prisma } from '../lib/db';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { parseItalian } from '../forum/parseItalian';
import { maybeSweepCommunity } from '../forum/sweep';
import { withDailyLimit } from '../forum/limits';
import { lockComment, lockThread } from '../forum/locks';
import { notify } from '../forum/notify';
import { moderatesSubject, readRoles } from '../forum/roles';
import { appealStateOf } from '../forum/appeals';
import {
  VALIDATIONS_SELECT, readThreshold, validatedAt, validatedRepliesOf, validatedThreadIds, validationSummary, withdrawValidations,
} from '../forum/validation';
import { readReportReason } from '../forum/reportReasons';
import {
  ACCEPTED_SELECT, LISTED_THREAD, NO_AUTHOR, VISIBLE, VISIBLE_REPLY, acceptedId, authorView, decisionLabel, excerpt,
  isOwn, isPassageWithheld, isVisible, type Authors, type Viewer,
} from '../forum/views';
import { castVote, voteSummary, voteSummaryOf, type VoteValue } from '../forum/votes';
import { readAuthors, requireWriter } from '../forum/profiles';
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
  // true: the glossa or one of its visible replies is «validata» (spec 2026-11-14 §C); false: neither.
  validated: trueOrFalse('validated'),
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
  score: true,
  createdAt: true,
  lastActivityAt: true,
  editedAt: true,
  deletedAt: true,
  lockedAt: true,
  acceptedCommentId: true,
  acceptedComment: ACCEPTED_SELECT,
  user: { select: { id: true, username: true } },
  votes: { where: { userId: viewerId }, select: { value: true } },
  _count: { select: { votes: true, comments: { where: VISIBLE_REPLY }, validations: true } },
}) satisfies Prisma.ArticleThreadSelect;

type FeedRow = Prisma.ArticleThreadGetPayload<{ select: ReturnType<typeof feedSelect> }>;

function target(thread: { targetKind: string; decisionKey: string | null }) {
  return thread.targetKind === 'decision' && thread.decisionKey
    ? { kind: 'decision' as const, key: thread.decisionKey }
    : { kind: 'article' as const };
}

function feedItemView(thread: FeedRow, viewer: Viewer, authors: Authors, validation: { threshold: number; replies: number }) {
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
    user: authorView(thread, authors),
    materia: thread.materia,
    ...voteSummary(thread.score, thread._count.votes, thread.votes[0]?.value ?? 0),
    replyCount: thread._count.comments,
    validated: thread.deletedAt === null && thread._count.validations >= validation.threshold,
    validatedReplies: validation.replies,
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
  const threshold = await readThreshold(prisma);
  if (query.validated !== undefined) {
    const ids = await validatedThreadIds(prisma, threshold);
    and.push(query.validated === 'true' ? { id: { in: ids } } : { id: { notIn: ids } });
  }
  const where: Prisma.ArticleThreadWhereInput = { AND: and };

  const orderBy: Prisma.ArticleThreadOrderByWithRelationInput[] = query.sort === 'popular'
    ? [{ score: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
    : query.sort === 'active'
      ? [{ lastActivityAt: 'desc' }, { id: 'desc' }]
      : [{ createdAt: 'desc' }, { id: 'desc' }];

  const [total, threads] = await Promise.all([
    prisma.articleThread.count({ where }),
    prisma.articleThread.findMany({ where, select: feedSelect(viewer.id), orderBy, skip: (page - 1) * limit, take: limit }),
  ]);

  const [authors, validatedReplies] = await Promise.all([
    readAuthors(prisma, threads.map(thread => thread.userId)),
    validatedRepliesOf(prisma, threads.map(thread => thread.id), threshold),
  ]);
  res.json({
    data: threads.map(thread => feedItemView(thread, viewer, authors, { threshold, replies: validatedReplies.get(thread.id) ?? 0 })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
};

const COMMENT_INCLUDE = {
  user: { select: { id: true, username: true } },
  votes: true,
  validations: VALIDATIONS_SELECT,
} satisfies Prisma.ArticleCommentInclude;

type CommentRow = Prisma.ArticleCommentGetPayload<{ include: typeof COMMENT_INCLUDE }>;

type PageContext = {
  viewer: { id: string; isModerator: boolean };
  authors: Authors;
  threshold: number;
  appeals: { targetKind: string; targetId: string; status: string; createdAt: Date }[];
};

/**
 * One reply or comment as its page shows it. Visible: its text and author. Hidden: its text with the
 * moderation's notice to its author and to moderators (and the author's appeal, §C), else a bare place
 * («removed»). Emptied by its author: a bare place, without the author's name.
 */
function itemView(item: CommentRow, page: PageContext) {
  const own = isOwn(item.userId, page.viewer.id);
  const shown = item.deletedAt === null && (!item.isHidden || own || page.viewer.isModerator);
  return {
    id: item.id,
    parentId: item.parentId,
    body: shown ? item.body : '',
    user: item.isHidden && !shown ? NO_AUTHOR : authorView(item, page.authors),
    createdAt: item.createdAt,
    editedAt: item.editedAt,
    deleted: item.deletedAt !== null,
    removed: item.isHidden && !shown,
    hidden: item.isHidden && shown ? { category: item.hiddenReason, appeal: appealStateOf(page.appeals, 'comment', item) } : null,
    ...voteSummaryOf(item, page.viewer.id),
    validation: shown ? validationSummary(item.validations, page.threshold, page.authors) : null,
    isOwner: own,
  };
}

/**
 * One glossa with its discussion, for its page in the Community. Replies come with their comments
 * nested, a third level stored before the rule of two flattened under its reply. Their order (§C): the
 * validated ones first (more validations first, then the earliest to reach the threshold), then the
 * accepted reply, then by score, then the oldest; validation only orders, it never hides (G-478). A
 * hidden or emptied item stays as a place only where something visible hangs on it. A hidden glossa is a
 * 404 but to its author and to the moderators of its subject; an emptied one with nothing visible under
 * it is a 404 to everyone.
 */
export const getThread = async (req: Request, res: Response) => {
  const viewerId = req.user!.id;
  const roles = await readRoles(prisma, viewerId);
  const thread = await prisma.articleThread.findUnique({
    where: { id: req.params.threadId },
    include: {
      user: { select: { id: true, username: true } },
      acceptedComment: ACCEPTED_SELECT,
      comments: { orderBy: { createdAt: 'asc' }, include: COMMENT_INCLUDE },
      votes: true,
      validations: VALIDATIONS_SELECT,
    },
  });
  // A subject's moderators read hidden items in their subject alone (§C).
  const viewer = { id: viewerId, isAdmin: roles.isAdmin, isModerator: thread ? moderatesSubject(roles, thread.materia) : false };
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
  const [threshold, appeals] = await Promise.all([
    readThreshold(prisma),
    prisma.forumAppeal.findMany({ where: { threadId: thread.id }, select: { targetKind: true, targetId: true, status: true, createdAt: true } }),
  ]);
  const accepted = acceptedId(thread);
  // Only what is visible leads: a hidden reply, in its author's or a moderator's view, keeps its place by score.
  const reachedAt = (reply: CommentRow) => (isVisible(reply) ? validatedAt(reply.validations, threshold) : null);
  const replies = thread.comments
    .filter(comment => comment.parentId === null)
    .map(reply => ({ reply, comments: (commentsOf.get(reply.id) ?? []).filter(readable), reached: reachedAt(reply) }))
    .filter(({ reply, comments }) => readable(reply) || comments.length > 0)
    .sort((a, b) => (Number(b.reached !== null) - Number(a.reached !== null))
      || (a.reached !== null && b.reached !== null
        ? (b.reply.validations.length - a.reply.validations.length) || (a.reached - b.reached!)
        : 0)
      || (Number(b.reply.id === accepted) - Number(a.reply.id === accepted))
      || (b.reply.score - a.reply.score)
      || (a.reply.createdAt.getTime() - b.reply.createdAt.getTime()));
  if (thread.deletedAt !== null && !thread.comments.some(isVisible)) throw new AppError(404, 'Glossa non trovata');

  const withheld = isPassageWithheld(thread, viewer);
  const authors = await readAuthors(prisma, [
    thread.userId,
    ...thread.validations.map(row => row.validatorId),
    ...thread.comments.flatMap(comment => [comment.userId, ...comment.validations.map(row => row.validatorId)]),
  ]);
  const page: PageContext = { viewer, authors, threshold, appeals };
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
    user: authorView(thread, authors),
    materia: thread.materia,
    createdAt: thread.createdAt,
    lastActivityAt: thread.lastActivityAt,
    editedAt: thread.editedAt,
    deleted: thread.deletedAt !== null,
    locked: thread.lockedAt !== null,
    hidden: thread.isHidden ? { category: thread.hiddenReason, appeal: appealStateOf(appeals, 'thread', thread) } : null,
    acceptedCommentId: accepted,
    ...voteSummaryOf(thread, viewerId),
    validation: thread.deletedAt === null ? validationSummary(thread.validations, threshold, authors) : null,
    replyCount: thread.comments.filter(comment => comment.parentId === null && isVisible(comment)).length,
    isOwner: own,
    replies: replies.map(({ reply, comments }) => ({
      ...itemView(reply, page),
      accepted: reply.id === accepted,
      comments: comments.map(comment => ({ ...itemView(comment, page), parentId: reply.id })),
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
    await requireWriter(tx, userId, 'edit');
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
    // What was validated is no longer there (§C): a new text withdraws the glossa's validations, a new
    // subject the glossa's and its replies' (they were given with another subject's authority).
    const materiaChanged = data.materia !== undefined && data.materia !== thread.materia;
    const validationsWithdrawn = materiaChanged
      ? await withdrawValidations(tx, { threadId: thread.id, withReplies: true })
      : textChanged ? await withdrawValidations(tx, { threadId: thread.id }) : 0;
    return { id: updated.id, title: updated.title, body: updated.body, materia: updated.materia, editedAt: updated.editedAt, validationsWithdrawn };
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
    await requireWriter(tx, userId, 'edit');
    if (comment.parentId !== null && data.body.length > COMMENT_MAX) {
      throw new AppError(400, `Un commento può avere al massimo ${COMMENT_MAX} caratteri`);
    }
    const updated = await tx.articleComment.update({
      where: { id: comment.id },
      data: { body: data.body, ...(data.body !== comment.body ? { editedAt: new Date() } : {}) },
    });
    const validationsWithdrawn = data.body !== comment.body ? await withdrawValidations(tx, { commentId: comment.id }) : 0;
    return { id: updated.id, body: updated.body, editedAt: updated.editedAt, validationsWithdrawn };
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
  await maybeSweepCommunity();
  const outcome = await prisma.$transaction((tx) => deleteOwnThreadIn(tx, req.user!.id, req.params.threadId));
  res.json({ outcome });
};

/** The rule of `deleteThread`, inside a transaction: also used by the account's «remove my contributions» (G-558). */
export async function deleteOwnThreadIn(tx: Prisma.TransactionClient, userId: string, threadId: string): Promise<'deleted' | 'emptied'> {
  if (!(await lockThread(tx, threadId))) throw new AppError(404, 'Glossa non trovata');
  const thread = await tx.articleThread.findUniqueOrThrow({ where: { id: threadId } });
  if (thread.deletedAt !== null || (thread.isHidden && !isOwn(thread.userId, userId))) throw new AppError(404, 'Glossa non trovata');
  if (!isOwn(thread.userId, userId)) throw new AppError(403, 'Puoi cancellare solo le tue glosse');
  const others = await tx.articleComment.count({ where: { threadId: thread.id, OR: [{ userId: { not: userId } }, { userId: null }] } });
  // The author's deletion makes an appeal pointless (§C): a glossa gone takes its own and its replies'
  // appeals, an emptied one its own.
  if (others === 0) {
    await tx.forumAppeal.deleteMany({ where: { threadId: thread.id } });
    await tx.articleThread.delete({ where: { id: thread.id } });
    return 'deleted';
  }
  await tx.forumAppeal.deleteMany({ where: { targetKind: 'thread', targetId: thread.id } });
  await tx.articleThread.update({ where: { id: thread.id }, data: { title: '', body: '', deletedAt: new Date() } });
  // What was validated is gone (§C); the replies keep theirs.
  await withdrawValidations(tx, { threadId: thread.id });
  return 'emptied';
}

/**
 * The author deletes a reply or a comment (§5.5): deleted when nothing hangs on it (no row under it,
 * hidden ones included, and not the accepted reply), else emptied in place, its comments kept.
 */
export const deleteComment = async (req: Request, res: Response) => {
  await maybeSweepCommunity();
  const outcome = await prisma.$transaction((tx) => deleteOwnCommentIn(tx, req.user!.id, req.params.commentId));
  res.json({ outcome });
};

/** The rule of `deleteComment`, inside a transaction: also used by the account's «remove my contributions» (G-558). */
export async function deleteOwnCommentIn(tx: Prisma.TransactionClient, userId: string, commentId: string): Promise<'deleted' | 'emptied'> {
  const found = await tx.articleComment.findUnique({ where: { id: commentId }, select: { threadId: true } });
  if (!found || !(await lockThread(tx, found.threadId)) || !(await lockComment(tx, commentId))) {
    throw new AppError(404, 'Risposta non trovata');
  }
  const comment = await tx.articleComment.findUniqueOrThrow({ where: { id: commentId }, include: { thread: { select: { acceptedCommentId: true } } } });
  if (comment.deletedAt !== null || (comment.isHidden && !isOwn(comment.userId, userId))) throw new AppError(404, 'Risposta non trovata');
  if (!isOwn(comment.userId, userId)) throw new AppError(403, 'Puoi cancellare solo le tue risposte');
  // Deleted or emptied by its author, an appeal against its hiding is pointless (§C).
  await tx.forumAppeal.deleteMany({ where: { targetKind: 'comment', targetId: comment.id } });
  const under = await tx.articleComment.count({ where: { parentId: comment.id } });
  if (under === 0 && comment.thread.acceptedCommentId !== comment.id) {
    await tx.articleComment.delete({ where: { id: comment.id } });
    return 'deleted';
  }
  await tx.articleComment.update({ where: { id: comment.id }, data: { body: '', deletedAt: new Date() } });
  await withdrawValidations(tx, { commentId: comment.id });
  return 'emptied';
}

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
  // Under the edits' daily counter: accepting and withdrawing is the author's change to their glossa.
  const acceptedCommentId = await withDailyLimit('edit', userId, () => prisma.$transaction(async (tx) => {
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
    // A reply's author is told once that it was accepted, however often the mark comes and goes.
    if (reply && reply.id !== thread.acceptedCommentId
      && !(await tx.forumNotification.count({ where: { kind: 'accepted', commentId: reply.id } }))) {
      await notify(tx, { to: reply.userId, by: userId, kind: 'accepted', threadId: thread.id, commentId: reply.id });
    }
    return data.commentId;
  }));
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

const VOTE_VALUE = 'Il voto deve essere 1, -1 o 0';
const voteSchema = z.object({
  value: z.custom<VoteValue>((value) => value === 1 || value === -1 || value === 0, { message: VOTE_VALUE }),
}, { message: VOTE_VALUE });

/**
 * One person's vote on a glossa or a reply (spec 2026-11-14-forum-community-server-design §A, D-248): 1 up,
 * -1 down, 0 withdrawn. Never on one's own (403, `own_contribution`); on a comment only 0.
 */
export const voteThread = async (req: Request, res: Response) => {
  const { value } = parseItalian(voteSchema, req.body);
  res.json(await castVote('thread', req.params.threadId, req.user!.id, () => value));
};

export const voteComment = async (req: Request, res: Response) => {
  const { value } = parseItalian(voteSchema, req.body);
  res.json(await castVote('comment', req.params.commentId, req.user!.id, () => value));
};
