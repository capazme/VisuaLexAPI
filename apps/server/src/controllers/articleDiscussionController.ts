import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';

const anchorSchema = z.object({
  normaKey: z.string().min(1).max(500),
  articleId: z.string().min(1).max(120),
  articleLabel: z.string().max(300).optional(),
  version: z.string().max(120).optional(),
});

const passageSchema = z.object({
  quote: z.string().min(1).max(2000)
    .refine((s) => s.trim().length > 0, 'La citazione non può essere vuota'),
  start: z.number().int().min(0).max(2_000_000),
  prefix: z.string().max(32),
  suffix: z.string().max(32),
});

const createThreadSchema = anchorSchema.extend({
  title: z.string().trim().max(200).optional(),
  body: z.string().trim().min(3).max(10000),
  passage: passageSchema.optional(),
  articleUrn: z.string().trim().min(1).max(1000).optional(),
  textHash: z.string().regex(/^[0-9a-f]{64}$/, 'Impronta del testo non valida').optional(),
}).superRefine((data, ctx) => {
  const title = data.title ?? '';
  if (!data.passage && title.length < 3) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['title'],
      message: 'Il titolo è obbligatorio (almeno 3 caratteri) per una discussione sull’intero articolo' });
  }
  if (data.passage && title.length > 0 && title.length < 3) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['title'],
      message: 'Il titolo, se indicato, deve avere almeno 3 caratteri' });
  }
});

const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(10000),
  parentId: z.string().uuid().optional().nullable(),
});

const reportSchema = z.object({
  reason: z.string().trim().min(2).max(80),
  details: z.string().trim().max(1000).optional(),
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

export const listThreads = async (req: Request, res: Response) => {
  const { normaKey, articleId } = anchorSchema.pick({ normaKey: true, articleId: true }).parse(req.query);
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
  const { normaKey, articleId } = anchorSchema.pick({ normaKey: true, articleId: true }).parse(req.query);

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
  const data = createThreadSchema.parse(req.body);
  const thread = await prisma.articleThread.create({
    data: {
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
  const data = createCommentSchema.parse(req.body);
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
  const data = reportSchema.parse(req.body);
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
  const hidden = z.object({ hidden: z.boolean() }).parse(req.body).hidden;
  const thread = await prisma.articleThread.update({ where: { id: req.params.threadId }, data: { isHidden: hidden } });
  res.json({ id: thread.id, isHidden: thread.isHidden });
};
