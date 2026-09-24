import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';

const prisma = new PrismaClient();

const anchorSchema = z.object({
  normaKey: z.string().min(1).max(500),
  articleId: z.string().min(1).max(120),
  articleLabel: z.string().max(300).optional(),
  version: z.string().max(120).optional(),
});

const createThreadSchema = anchorSchema.extend({
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(3).max(10000),
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
    data: threads.map(thread => ({
      id: thread.id,
      normaKey: thread.normaKey,
      articleId: thread.articleId,
      articleLabel: thread.articleLabel,
      version: thread.version,
      title: thread.title,
      body: thread.body,
      user: userView(thread.user),
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      voteCount: thread.votes.length,
      userVoted: thread.votes.some(vote => vote.userId === req.user!.id),
      isOwner: thread.userId === req.user!.id,
      comments: thread.comments.map(comment => commentView(comment, req.user!.id)),
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
};

export const createThread = async (req: Request, res: Response) => {
  const data = createThreadSchema.parse(req.body);
  const thread = await prisma.articleThread.create({
    data: { ...data, userId: req.user!.id },
    include: { user: { select: { id: true, username: true } } },
  });
  res.status(201).json({
    id: thread.id,
    normaKey: thread.normaKey,
    articleId: thread.articleId,
    articleLabel: thread.articleLabel,
    version: thread.version,
    title: thread.title,
    body: thread.body,
    user: userView(thread.user),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    voteCount: 0,
    userVoted: false,
    isOwner: true,
    comments: [],
  });
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
