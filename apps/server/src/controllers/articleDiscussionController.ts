import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { inDecisionKeySpace, readDecisionKey } from '../norms/decisionKey';

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
    if (anchor.articleId !== '') throw new AppError(400, 'Una discussione su una decisione non ha un articolo');
    if (anchor.version !== undefined) throw new AppError(400, 'Una discussione su una decisione non ha una versione');
    if (anchor.articleUrn !== undefined) throw new AppError(400, 'Una discussione su una decisione non ha un URN');
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

const moderationSchema = z.object({
  hidden: z.boolean({ message: '«hidden» deve essere vero o falso' }).optional(),
  passageReleased: z.boolean({ message: '«passageReleased» deve essere vero o falso' }).optional(),
}, { message: 'La richiesta non è valida' })
  .refine((b) => b.hidden !== undefined || b.passageReleased !== undefined, 'Nessuna modifica richiesta');

/** Parses with Zod but answers with the first message alone, in Italian: the global handler's English prefix is not for these routes. */
function parseItalian<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, result.error.issues[0].message);
  return result.data;
}

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
      message: 'Il titolo è obbligatorio (almeno 3 caratteri) per una discussione senza un passo citato' });
  }
  if (data.passage && title.length > 0 && title.length < 3) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['title'],
      message: 'Il titolo, se indicato, deve avere almeno 3 caratteri' });
  }
});

const createCommentSchema = z.object({
  body: z.string({ message: 'Il testo è obbligatorio' }).trim().min(1, 'Il testo è obbligatorio')
    .max(10000, 'Il testo può avere al massimo 10000 caratteri'),
  parentId: z.string().uuid('La risposta non è valida').optional().nullable(),
});

const reportSchema = z.object({
  reason: z.string({ message: 'Il motivo è obbligatorio' }).trim().min(2, 'Il motivo è obbligatorio')
    .max(80, 'Il motivo può avere al massimo 80 caratteri'),
  details: z.string({ message: 'I dettagli non sono validi' }).trim().max(1000, 'I dettagli possono avere al massimo 1000 caratteri').optional(),
});

function userView(user: { id: string; username: string }) {
  return { id: user.id, username: user.username };
}

function commentView(comment: {
  id: string; threadId: string; parentId: string | null; body: string; userId: string;
  isHidden: boolean; createdAt: Date; updatedAt: Date; user: { id: string; username: string };
  votes: { userId: string }[];
}, userId: string) {
  return {
    id: comment.id,
    threadId: comment.threadId,
    parentId: comment.parentId,
    body: comment.isHidden ? '[Contenuto rimosso]' : comment.body,
    isHidden: comment.isHidden,
    user: userView(comment.user),
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    voteCount: comment.votes.length,
    userVoted: comment.votes.some(vote => vote.userId === userId),
    isOwner: comment.userId === userId,
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
  user: { id: string; username: string };
  createdAt: Date;
  updatedAt: Date;
  votes: { userId: string }[];
  comments: Parameters<typeof commentView>[0][];
  userId?: string;
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
    user: userView(thread.user),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    voteCount: thread.votes.length,
    userVoted: thread.votes.some(vote => vote.userId === userId),
    isOwner: (thread.userId ?? thread.user.id) === userId,
    comments: thread.comments.map(comment => commentView(comment, userId)),
  };
}

/** The list queries: a decision's articleId is '' and may be left out. */
function parseListAnchor(query: unknown) {
  const { normaKey, articleId } = anchorSchema.pick({ normaKey: true }).extend({ articleId: z.string().max(120).optional() }).parse(query);
  const anchor = { normaKey, articleId: articleId ?? '' };
  if (articleId === undefined && !inDecisionKeySpace(normaKey)) throw new AppError(400, 'L’articolo è obbligatorio');
  checkAnchor(anchor);
  return anchor;
}

export const listThreads = async (req: Request, res: Response) => {
  const { normaKey, articleId } = parseListAnchor(req.query);
  const sort = req.query.sort === 'popular' ? 'popular' : req.query.sort === 'active' ? 'active' : 'recent';
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));

  const where = { normaKey, articleId, isHidden: false };
  const [total, threads] = await Promise.all([
    prisma.articleThread.count({ where }),
    prisma.articleThread.findMany({
      where,
      include: {
        user: { select: { id: true, username: true } },
        comments: {
          where: { isHidden: false },
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { id: true, username: true } }, votes: true },
        },
        votes: true,
      },
      orderBy: sort === 'popular'
        ? { votes: { _count: 'desc' } }
        : sort === 'active'
          ? { updatedAt: 'desc' }
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
      isHidden: false,
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
      user: { select: { id: true, username: true } },
      _count: { select: { comments: { where: { isHidden: false } } } },
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
      user: userView(thread.user),
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
  const thread = await prisma.articleThread.create({
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
      userId: req.user!.id,
    },
    include: {
      user: { select: { id: true, username: true } },
      comments: {
        where: { isHidden: false },
        orderBy: { createdAt: 'asc' },
        include: { user: { select: { id: true, username: true } }, votes: true },
      },
      votes: true,
    },
  });
  res.status(201).json(threadView(thread, req.user!.id));
};

export const createComment = async (req: Request, res: Response) => {
  const data = parseItalian(createCommentSchema, req.body);
  const thread = await prisma.articleThread.findUnique({ where: { id: req.params.threadId } });
  if (!thread || thread.isHidden) throw new AppError(404, 'Discussione non trovata');

  if (data.parentId) {
    const parent = await prisma.articleComment.findFirst({ where: { id: data.parentId, threadId: thread.id } });
    if (!parent) throw new AppError(404, 'Risposta padre non trovata');
    let depth = 1;
    let currentParentId = parent.parentId;
    while (currentParentId && depth < 4) {
      const ancestor = await prisma.articleComment.findUnique({ where: { id: currentParentId }, select: { parentId: true } });
      currentParentId = ancestor?.parentId ?? null;
      depth += 1;
    }
    if (depth >= 3) throw new AppError(400, 'La profondità delle risposte è limitata a tre livelli');
  }

  const comment = await prisma.articleComment.create({
    data: { threadId: thread.id, parentId: data.parentId ?? null, body: data.body, userId: req.user!.id },
    include: { user: { select: { id: true, username: true } }, votes: true },
  });
  await prisma.articleThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
  res.status(201).json(commentView(comment, req.user!.id));
};

export const toggleThreadVote = async (req: Request, res: Response) => {
  const thread = await prisma.articleThread.findUnique({ where: { id: req.params.threadId } });
  if (!thread || thread.isHidden) throw new AppError(404, 'Discussione non trovata');
  const existing = await prisma.articleThreadVote.findUnique({ where: { threadId_userId: { threadId: thread.id, userId: req.user!.id } } });
  if (existing) await prisma.articleThreadVote.delete({ where: { id: existing.id } });
  else await prisma.articleThreadVote.create({ data: { threadId: thread.id, userId: req.user!.id } });
  const voteCount = await prisma.articleThreadVote.count({ where: { threadId: thread.id } });
  res.json({ voted: !existing, voteCount });
};

export const toggleCommentVote = async (req: Request, res: Response) => {
  const comment = await prisma.articleComment.findUnique({ where: { id: req.params.commentId } });
  if (!comment || comment.isHidden) throw new AppError(404, 'Risposta non trovata');
  const existing = await prisma.articleCommentVote.findUnique({ where: { commentId_userId: { commentId: comment.id, userId: req.user!.id } } });
  if (existing) await prisma.articleCommentVote.delete({ where: { id: existing.id } });
  else await prisma.articleCommentVote.create({ data: { commentId: comment.id, userId: req.user!.id } });
  const voteCount = await prisma.articleCommentVote.count({ where: { commentId: comment.id } });
  res.json({ voted: !existing, voteCount });
};

export const reportThread = async (req: Request, res: Response) => {
  const data = parseItalian(reportSchema, req.body);
  const thread = await prisma.articleThread.findUnique({ where: { id: req.params.threadId } });
  if (!thread) throw new AppError(404, 'Discussione non trovata');
  await prisma.articleThreadReport.upsert({
    where: { threadId_userId: { threadId: thread.id, userId: req.user!.id } },
    create: { threadId: thread.id, userId: req.user!.id, reason: data.reason, details: data.details },
    update: { reason: data.reason, details: data.details, status: 'pending' },
  });
  res.status(204).send();
};

export const moderateThread = async (req: Request, res: Response) => {
  const body = parseItalian(moderationSchema, req.body);
  const data: { isHidden?: boolean; passageReleasedAt?: Date | null; passageReleasedById?: string | null } = {};
  if (body.hidden !== undefined) data.isHidden = body.hidden;
  if (body.passageReleased !== undefined) {
    const existing = await prisma.articleThread.findUnique({ where: { id: req.params.threadId } });
    if (!existing) throw new AppError(404, 'Discussione non trovata');
    if (existing.targetKind !== 'decision' || existing.passageQuote === null) {
      throw new AppError(400, 'Solo il passo citato di una decisione può essere rimesso in chiaro');
    }
    data.passageReleasedAt = body.passageReleased ? new Date() : null;
    data.passageReleasedById = body.passageReleased ? req.user!.id : null;
  }
  const thread = await prisma.articleThread.update({ where: { id: req.params.threadId }, data });
  res.json({ id: thread.id, isHidden: thread.isHidden, passageReleased: thread.passageReleasedAt !== null });
};
