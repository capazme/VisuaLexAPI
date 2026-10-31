import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { parseItalian } from '../forum/parseItalian';
import { decisionLabel, isOwn } from '../forum/views';
import { parsePaging } from './articleDiscussionController';

// The Community's notifications (spec 2026-10-20-forum-community-glosse-design §6.5): in the app only,
// never naming who acted. The Forum's badge counts the unread ones (`GET /notifications/forum-unread-count`).

const listSchema = z.object({
  unread: z.enum(['true', 'false'], { message: '«unread» deve essere «true» o «false»' }).optional(),
});

/**
 * The user's notifications, newest first, each with the glossa it is about: its label and title, but
 * not the title of a glossa hidden by moderation unless it is the user's own. A «hidden» one says the
 * category a moderator chose, never the moderator.
 */
export const listNotifications = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const query = parseItalian(listSchema, req.query);
  const { page, limit } = parsePaging(req.query);
  const where = { userId, ...(query.unread === 'true' ? { readAt: null } : {}) };
  const [total, unread, rows] = await Promise.all([
    prisma.forumNotification.count({ where }),
    prisma.forumNotification.count({ where: { userId, readAt: null } }),
    prisma.forumNotification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        thread: {
          select: {
            id: true, title: true, userId: true, isHidden: true, hiddenReason: true, deletedAt: true,
            normaKey: true, articleId: true, articleLabel: true, targetKind: true, decisionKey: true,
          },
        },
        comment: { select: { id: true, hiddenReason: true } },
      },
    }),
  ]);
  res.json({
    data: rows.map(row => {
      const own = isOwn(row.thread.userId, userId);
      return {
        id: row.id,
        kind: row.kind,
        createdAt: row.createdAt,
        readAt: row.readAt,
        threadId: row.threadId,
        commentId: row.commentId,
        thread: {
          title: (row.thread.isHidden && !own) || row.thread.deletedAt !== null ? '' : row.thread.title,
          normaKey: row.thread.normaKey,
          articleId: row.thread.articleId,
          articleLabel: row.thread.articleLabel,
          decisionLabel: decisionLabel(row.thread),
        },
        category: row.kind === 'hidden' ? (row.comment ? row.comment.hiddenReason : row.thread.hiddenReason) : null,
      };
    }),
    unread,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
};

const readSchema = z.union([
  z.object({ all: z.literal(true) }, { message: 'La richiesta non è valida' }).strict(),
  z.object({
    ids: z.array(z.string().guid('La notifica non è valida'), { message: 'Le notifiche non sono valide' })
      .min(1, 'Indica almeno una notifica').max(200, 'Al massimo 200 notifiche alla volta'),
  }, { message: 'La richiesta non è valida' }).strict(),
], { message: 'Indica le notifiche lette («ids») o tutte («all»)' });

/** Marks the user's notifications read: some (`ids`, only the user's own) or all. */
export const markNotificationsRead = async (req: Request, res: Response) => {
  const body = parseItalian(readSchema, req.body);
  const { count } = await prisma.forumNotification.updateMany({
    where: { userId: req.user!.id, readAt: null, ...('ids' in body ? { id: { in: body.ids } } : {}) },
    data: { readAt: new Date() },
  });
  res.json({ read: count });
};
