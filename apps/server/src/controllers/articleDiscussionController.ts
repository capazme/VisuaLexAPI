import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { inDecisionKeySpace, readDecisionKey } from '../norms/decisionKey';
import { readReportReason } from '../forum/reportReasons';
import { maybeSweepCommunity } from '../forum/sweep';
import { parseItalian } from '../forum/parseItalian';
import { withDailyLimit } from '../forum/limits';
import { lockComment, lockThread } from '../forum/locks';
import { notify } from '../forum/notify';
import { logModeration } from '../forum/moderationLog';
import {
  ACCEPTED_SELECT, LISTED_THREAD, VISIBLE, acceptedId, authorView, isOwn, isVisible,
} from '../forum/views';

export { parseItalian };

const anchorSchema = z.object({
  normaKey: z.string({ message: 'La norma o la decisione è obbligatoria' }).min(1, 'La norma o la decisione è obbligatoria')
    .max(500, 'La chiave della norma non è valida'),
  // '' only for a decision (checked in `checkAnchor`)
  articleId: z.string({ message: 'L’articolo non è valido' }).max(120, 'L’articolo non è valido'),
  articleLabel: z.string({ message: 'L’etichetta non è valida' }).max(300, 'L’etichetta non è valida').optional(),
  version: z.string({ message: 'La versione non è valida' }).max(120, 'La versione non è valida').optional(),
});

const INVALID_DECISION_KEY = 'La chiave della decisione non è valida';

/**
 * The target is derived from the key, never trusted: a key in the decision key space is a decision
 * and must read back; anything else is an article's, which needs an article id.
 */
function checkAnchor(anchor: { normaKey: string; articleId: string; version?: string; articleUrn?: string }) {
  if (inDecisionKeySpace(anchor.normaKey)) {
    if (!readDecisionKey(anchor.normaKey)) throw new AppError(400, INVALID_DECISION_KEY);
    if (anchor.articleId !== '') throw new AppError(400, 'Una glossa su una decisione non ha un articolo');
    if (anchor.version !== undefined) throw new AppError(400, 'Una glossa su una decisione non ha una versione');
    if (anchor.articleUrn !== undefined) throw new AppError(400, 'Una glossa su una decisione non ha un URN');
    return 'decision' as const;
  }
  if (anchor.articleId.length < 1) throw new AppError(400, 'L’articolo è obbligatorio');
  return 'article' as const;
}

// Optional and redundant with normaKey: accepted only when it agrees with it.
const targetSchema = z.object({
  kind: z.enum(['article', 'decision'], { message: 'La destinazione deve essere «article» o «decision»' }),
  key: z.string({ message: 'La chiave della destinazione non è valida' }).max(500, 'La chiave della destinazione non è valida').optional(),
}, { message: 'La destinazione non è valida' }).optional();

// Hiding goes through `/moderation/…` alone, with its category and reason (spec 2026-10-20 §5.7). The
// reason of a release is optional until the reader's panel sends one (pending PR2c).
const moderationSchema = z.object({
  passageReleased: z.boolean({ message: '«passageReleased» deve essere vero o falso' }),
  reason: z.string({ message: 'Il motivo non è valido' }).trim().min(3, 'Il motivo deve avere almeno 3 caratteri')
    .max(1000, 'Il motivo può avere al massimo 1000 caratteri').optional(),
}, { message: 'La richiesta non è valida' });

/** The subjects of Gymnasium, chosen by the author (§6.2). */
export const materiaSchema = z.enum(['DIRITTO_CIVILE', 'DIRITTO_PENALE', 'DIRITTO_AMMINISTRATIVO', 'DIRITTO_PROCESSUALE_CIVILE', 'DIRITTO_PROCESSUALE_PENALE'], {
  message: 'La materia non è valida',
});

export const REPLY_MAX = 10_000;
export const COMMENT_MAX = 2_000;

const passageSchema = z.object({
  quote: z.string({ message: 'La citazione non è valida' }).min(1, 'La citazione non può essere vuota')
    .max(2000, 'La citazione può avere al massimo 2000 caratteri')
    .refine((s) => s.trim().length > 0, 'La citazione non può essere vuota'),
  start: z.number({ message: 'La posizione del passo non è valida' }).int('La posizione del passo non è valida')
    .min(0, 'La posizione del passo non è valida').max(2_000_000, 'La posizione del passo non è valida'),
  prefix: z.string({ message: 'Il contesto del passo non è valido' }).max(32, 'Il contesto del passo non è valido'),
  suffix: z.string({ message: 'Il contesto del passo non è valido' }).max(32, 'Il contesto del passo non è valido'),
}, { message: 'Il passo citato non è valido' });

const createThreadSchema = anchorSchema.extend({
  materia: materiaSchema.optional(),
  title: z.string({ message: 'Il titolo non è valido' }).trim().max(200, 'Il titolo può avere al massimo 200 caratteri').optional(),
  body: z.string({ message: 'Il testo è obbligatorio' }).trim().min(3, 'Il testo deve avere almeno 3 caratteri')
    .max(10000, 'Il testo può avere al massimo 10000 caratteri'),
  passage: passageSchema.optional(),
  articleUrn: z.string({ message: 'L’URN non è valido' }).trim().min(1, 'L’URN non è valido').max(1000, 'L’URN non è valido').optional(),
  textHash: z.string().regex(/^[0-9a-f]{64}$/, 'Impronta del testo non valida').optional(),
}).superRefine((data, ctx) => {
  const title = data.title ?? '';
  if (!data.passage && title.length < 3) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['title'],
      message: 'Il titolo è obbligatorio (almeno 3 caratteri) per una glossa senza un passo citato' });
  }
  if (data.passage && title.length > 0 && title.length < 3) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['title'],
      message: 'Il titolo, se indicato, deve avere almeno 3 caratteri' });
  }
});

const createCommentSchema = z.object({
  body: z.string({ message: 'Il testo è obbligatorio' }).trim().min(1, 'Il testo è obbligatorio')
    .max(REPLY_MAX, `Il testo può avere al massimo ${REPLY_MAX} caratteri`),
  parentId: z.string().guid('La risposta non è valida').optional().nullable(),
});

const reportSchema = z.object({
  reason: z.string({ message: 'Il motivo è obbligatorio' }).trim().min(2, 'Il motivo è obbligatorio')
    .max(80, 'Il motivo può avere al massimo 80 caratteri'),
  details: z.string({ message: 'I dettagli non sono validi' }).trim().max(1000, 'I dettagli possono avere al massimo 1000 caratteri').optional(),
});

function commentView(comment: {
  id: string; threadId: string; parentId: string | null; body: string; userId: string | null;
  isHidden: boolean; createdAt: Date; updatedAt: Date; user: { id: string; username: string } | null;
  votes: { userId: string }[]; editedAt: Date | null; deletedAt: Date | null;
}, userId: string) {
  return {
    id: comment.id,
    threadId: comment.threadId,
    parentId: comment.parentId,
    body: comment.isHidden ? '[Contenuto rimosso]' : comment.body,
    isHidden: comment.isHidden,
    user: authorView(comment),
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    editedAt: comment.editedAt,
    deleted: comment.deletedAt !== null,
    voteCount: comment.votes.length,
    userVoted: comment.votes.some(vote => vote.userId === userId),
    isOwner: isOwn(comment.userId, userId),
  };
}

function threadView(thread: {
  id: string;
  normaKey: string;
  articleId: string;
  articleLabel: string | null;
  version: string | null;
  passageQuote: string | null;
  passageStart: number | null;
  passagePrefix: string | null;
  passageSuffix: string | null;
  articleUrn: string | null;
  textHash: string | null;
  targetKind: string;
  decisionKey: string | null;
  passageReleasedAt: Date | null;
  title: string;
  body: string;
  user: { id: string; username: string } | null;
  createdAt: Date;
  updatedAt: Date;
  lastActivityAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  lockedAt: Date | null;
  materia: string | null;
  acceptedCommentId: string | null;
  acceptedComment: { isHidden: boolean; deletedAt: Date | null } | null;
  votes: { userId: string }[];
  comments: Parameters<typeof commentView>[0][];
  userId: string | null;
}, userId: string) {
  return {
    id: thread.id,
    normaKey: thread.normaKey,
    articleId: thread.articleId,
    articleLabel: thread.articleLabel,
    version: thread.version,
    target: thread.targetKind === 'decision' && thread.decisionKey
      ? { kind: 'decision' as const, key: thread.decisionKey }
      : { kind: 'article' as const },
    passageReleased: thread.passageReleasedAt !== null,
    title: thread.title,
    body: thread.body,
    passage: thread.passageQuote === null || thread.passageStart === null
      ? null
      : {
          quote: thread.passageQuote,
          start: thread.passageStart,
          prefix: thread.passagePrefix ?? '',
          suffix: thread.passageSuffix ?? '',
        },
    articleUrn: thread.articleUrn,
    textHash: thread.textHash,
    user: authorView(thread),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    lastActivityAt: thread.lastActivityAt,
    editedAt: thread.editedAt,
    deleted: thread.deletedAt !== null,
    locked: thread.lockedAt !== null,
    materia: thread.materia,
    acceptedCommentId: acceptedId(thread),
    voteCount: thread.votes.length,
    userVoted: thread.votes.some(vote => vote.userId === userId),
    isOwner: isOwn(thread.userId, userId),
    comments: thread.comments.map(comment => commentView(comment, userId)),
  };
}

const pagingSchema = z.object({
  page: z.coerce.number({ message: 'La pagina non è valida' }).int('La pagina non è valida').min(1, 'La pagina non è valida')
    .max(10_000, 'La pagina non è valida').default(1),
  limit: z.coerce.number({ message: 'Il numero di risultati non è valido' }).int('Il numero di risultati non è valido')
    .min(1, 'Il numero di risultati non è valido').max(50, 'Al massimo 50 risultati per pagina').default(20),
});

/** `page` and `limit` of a list query; a value that is not a number is a 400, not a database error (#205). */
export function parsePaging(query: Request['query']) {
  return parseItalian(pagingSchema, { page: query.page, limit: query.limit });
}

const THREAD_INCLUDE = {
  user: { select: { id: true, username: true } },
  acceptedComment: ACCEPTED_SELECT,
  comments: {
    where: { isHidden: false },
    orderBy: { createdAt: 'asc' as const },
    include: { user: { select: { id: true, username: true } }, votes: true },
  },
  votes: true,
};

/** The list queries: a decision's articleId is '' and may be left out. */
function parseListAnchor(query: unknown) {
  const { normaKey, articleId } = parseItalian(
    anchorSchema.pick({ normaKey: true }).extend({ articleId: z.string({ message: 'L’articolo non è valido' }).max(120, 'L’articolo non è valido').optional() }),
    query,
  );
  const anchor = { normaKey, articleId: articleId ?? '' };
  if (articleId === undefined && !inDecisionKeySpace(normaKey)) throw new AppError(400, 'L’articolo è obbligatorio');
  checkAnchor(anchor);
  return anchor;
}

export const listThreads = async (req: Request, res: Response) => {
  const { normaKey, articleId } = parseListAnchor(req.query);
  const sort = req.query.sort === 'popular' ? 'popular' : req.query.sort === 'active' ? 'active' : 'recent';
  const { page, limit } = parsePaging(req.query);

  const where = { normaKey, articleId, ...LISTED_THREAD };
  const [total, threads] = await Promise.all([
    prisma.articleThread.count({ where }),
    prisma.articleThread.findMany({
      where,
      include: THREAD_INCLUDE,
      orderBy: sort === 'popular'
        ? { votes: { _count: 'desc' } }
        : sort === 'active'
          ? { lastActivityAt: 'desc' }
          : { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    data: threads.map(thread => threadView(thread, req.user!.id)),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
};

export const listPassages = async (req: Request, res: Response) => {
  const { normaKey, articleId } = parseListAnchor(req.query);

  const threads = await prisma.articleThread.findMany({
    where: {
      normaKey,
      articleId,
      ...LISTED_THREAD,
      passageQuote: { not: null },
    },
    select: {
      id: true,
      title: true,
      passageQuote: true,
      passageStart: true,
      passagePrefix: true,
      passageSuffix: true,
      articleUrn: true,
      textHash: true,
      createdAt: true,
      deletedAt: true,
      user: { select: { id: true, username: true } },
      _count: { select: { comments: { where: VISIBLE } } },
    },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });

  res.json({
    data: threads.map(thread => ({
      id: thread.id,
      title: thread.title,
      passage: {
        quote: thread.passageQuote!,
        start: thread.passageStart!,
        prefix: thread.passagePrefix ?? '',
        suffix: thread.passageSuffix ?? '',
      },
      articleUrn: thread.articleUrn,
      textHash: thread.textHash,
      commentCount: thread._count.comments,
      createdAt: thread.createdAt,
      user: authorView(thread),
    })),
  });
};

export const createThread = async (req: Request, res: Response) => {
  const data = parseItalian(createThreadSchema, req.body);
  const target = parseItalian(targetSchema, req.body?.target);
  const kind = checkAnchor(data);
  if (target) {
    if (kind === 'article' && target.key !== undefined) throw new AppError(400, 'Una destinazione articolo non ha una chiave');
    if (target.kind !== kind || (kind === 'decision' && target.key !== data.normaKey)) {
      throw new AppError(400, 'La destinazione non corrisponde alla chiave');
    }
  }
  await maybeSweepCommunity();
  // No licence check yet (pending PR2c): `licence_text_id` stays null, like the rows written before the text.
  const thread = await withDailyLimit('glossa', req.user!.id, () => prisma.articleThread.create({
    data: {
      targetKind: kind,
      decisionKey: kind === 'decision' ? data.normaKey : null,
      normaKey: data.normaKey,
      articleId: data.articleId,
      articleLabel: data.articleLabel,
      version: data.version,
      title: data.title ?? '',
      body: data.body,
      passageQuote: data.passage?.quote ?? null,
      passageStart: data.passage?.start ?? null,
      passagePrefix: data.passage?.prefix ?? null,
      passageSuffix: data.passage?.suffix ?? null,
      articleUrn: data.articleUrn ?? null,
      textHash: data.textHash ?? null,
      materia: data.materia ?? null,
      userId: req.user!.id,
    },
    include: THREAD_INCLUDE,
  }));
  res.status(201).json(threadView(thread, req.user!.id));
};

/**
 * A reply to the glossa, or a comment under a reply: two levels (spec 2026-10-20 §5.2). The glossa, and
 * the reply under which it goes, are locked first, as a deletion locks them (§5.5): a reply never lands
 * under something that is being deleted for good. Tells the glossa's author of a reply, the reply's
 * author of a comment.
 */
export const createComment = async (req: Request, res: Response) => {
  const data = parseItalian(createCommentSchema, req.body);
  const userId = req.user!.id;
  await maybeSweepCommunity();
  const comment = await withDailyLimit('reply', userId, () => prisma.$transaction(async (tx) => {
    if (!(await lockThread(tx, req.params.threadId))) throw new AppError(404, 'Glossa non trovata');
    const thread = await tx.articleThread.findUniqueOrThrow({ where: { id: req.params.threadId } });
    if (thread.isHidden || (thread.deletedAt !== null && !(await tx.articleComment.count({ where: { threadId: thread.id, ...VISIBLE } })))) {
      throw new AppError(404, 'Glossa non trovata');
    }
    if (thread.lockedAt !== null) throw new AppError(409, 'La discussione è chiusa');

    let parent: { userId: string | null } | null = null;
    if (data.parentId) {
      if (!(await lockComment(tx, data.parentId))) throw new AppError(404, 'Risposta padre non trovata');
      const found = await tx.articleComment.findFirst({ where: { id: data.parentId, threadId: thread.id } });
      if (!found || found.isHidden) throw new AppError(404, 'Risposta padre non trovata');
      if (found.parentId !== null) throw new AppError(400, 'Si può commentare una risposta, non un commento');
      if (data.body.length > COMMENT_MAX) throw new AppError(400, `Un commento può avere al massimo ${COMMENT_MAX} caratteri`);
      parent = found;
    }

    const created = await tx.articleComment.create({
      data: { threadId: thread.id, parentId: data.parentId ?? null, body: data.body, userId },
      include: { user: { select: { id: true, username: true } }, votes: true },
    });
    // The feed's «Attive» reads the last activity; `updatedAt` moves with it as before.
    await tx.articleThread.update({ where: { id: thread.id }, data: { lastActivityAt: created.createdAt } });
    await notify(tx, parent
      ? { to: parent.userId, by: userId, kind: 'comment', threadId: thread.id, commentId: created.id }
      : { to: thread.userId, by: userId, kind: 'reply', threadId: thread.id, commentId: created.id });
    return created;
  }));
  res.status(201).json(commentView(comment, userId));
};

// Voting on one's own glossa or reply is still allowed while the reader's panel shows the button
// (pending PR2c: a 403 «Non puoi votare un tuo contributo»).
export const toggleThreadVote = async (req: Request, res: Response) => {
  const thread = await prisma.articleThread.findUnique({ where: { id: req.params.threadId } });
  if (!thread || !isVisible(thread)) throw new AppError(404, 'Glossa non trovata');
  const existing = await prisma.articleThreadVote.findUnique({ where: { threadId_userId: { threadId: thread.id, userId: req.user!.id } } });
  if (existing) await prisma.articleThreadVote.delete({ where: { id: existing.id } });
  else await prisma.articleThreadVote.create({ data: { threadId: thread.id, userId: req.user!.id } });
  const voteCount = await prisma.articleThreadVote.count({ where: { threadId: thread.id } });
  res.json({ voted: !existing, voteCount });
};

export const toggleCommentVote = async (req: Request, res: Response) => {
  const comment = await prisma.articleComment.findUnique({ where: { id: req.params.commentId }, include: { thread: { select: { isHidden: true } } } });
  if (!comment || !isVisible(comment) || comment.thread.isHidden) throw new AppError(404, 'Risposta non trovata');
  const existing = await prisma.articleCommentVote.findUnique({ where: { commentId_userId: { commentId: comment.id, userId: req.user!.id } } });
  // A comment is a remark, not an answer: no new votes on it; its old ones stay counted (§5.3).
  if (!existing && comment.parentId !== null) throw new AppError(400, 'Si vota una risposta, non un commento');
  if (existing) await prisma.articleCommentVote.delete({ where: { id: existing.id } });
  else await prisma.articleCommentVote.create({ data: { commentId: comment.id, userId: req.user!.id } });
  const voteCount = await prisma.articleCommentVote.count({ where: { commentId: comment.id } });
  res.json({ voted: !existing, voteCount });
};

/** What a report keeps of a glossa for the moderators (G-308): its title, if any, and its body. */
function reportedThreadText(thread: { title: string; body: string }) {
  return thread.title ? `${thread.title}\n\n${thread.body}` : thread.body;
}

export const reportThread = async (req: Request, res: Response) => {
  const data = parseItalian(reportSchema, req.body);
  const userId = req.user!.id;
  await maybeSweepCommunity();
  const thread = await prisma.articleThread.findUnique({ where: { id: req.params.threadId } });
  if (!thread || thread.deletedAt !== null) throw new AppError(404, 'Glossa non trovata');
  if (isOwn(thread.userId, userId)) throw new AppError(400, 'Non puoi segnalare un tuo contributo');
  const { reason, details } = readReportReason(data.reason, data.details);
  // A second report replaces the first, with a new copy of the text, and is pending again.
  const report = { reason, details, status: 'pending', reportedText: reportedThreadText(thread), resolvedAt: null, resolvedById: null, resolutionNote: null };
  await withDailyLimit('report', userId, () => prisma.articleThreadReport.upsert({
    where: { threadId_userId: { threadId: thread.id, userId } },
    create: { threadId: thread.id, userId, ...report },
    update: report,
  }));
  res.status(204).send();
};

/**
 * An administrator releases a decision's quotation, or withholds it again (G-291), on the record. The
 * reason is optional until the reader's panel asks for one (pending PR2c). Hiding is no longer here: it
 * goes through `/moderation/…`, with its category and reason.
 */
export const moderateThread = async (req: Request, res: Response) => {
  if (req.body && typeof req.body === 'object' && 'hidden' in req.body) {
    throw new AppError(400, 'Per nascondere una glossa usa la moderazione della Community');
  }
  const body = parseItalian(moderationSchema, req.body);
  const thread = await prisma.$transaction(async (tx) => {
    if (!(await lockThread(tx, req.params.threadId))) throw new AppError(404, 'Glossa non trovata');
    const existing = await tx.articleThread.findUniqueOrThrow({ where: { id: req.params.threadId } });
    if (existing.targetKind !== 'decision' || existing.passageQuote === null) {
      throw new AppError(400, 'Solo il passo citato di una decisione può essere rimesso in chiaro');
    }
    const updated = await tx.articleThread.update({
      where: { id: existing.id },
      data: {
        passageReleasedAt: body.passageReleased ? new Date() : null,
        passageReleasedById: body.passageReleased ? req.user!.id : null,
      },
    });
    await logModeration(tx, {
      actorId: req.user!.id, action: body.passageReleased ? 'release_passage' : 'withhold_passage',
      targetKind: 'thread', targetId: existing.id, reason: body.reason ?? null,
    });
    return updated;
  });
  res.json({ id: thread.id, isHidden: thread.isHidden, passageReleased: thread.passageReleasedAt !== null });
};
