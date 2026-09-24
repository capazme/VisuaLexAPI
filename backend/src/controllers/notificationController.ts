import { Request, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { compareNormaSnapshots } from '../utils/normaWatcher';

const prisma = new PrismaClient();

// 2 MB cap on article_text: generous for any real article, but bounds the
// payload a malicious or buggy client could push into the snapshot JSON column.
const checkNormaSchema = z.object({
  normaKey: z.string().min(1).max(500),
  normaData: z.object({
    norma_data: z.record(z.unknown()),
    article_text: z.string().max(2 * 1024 * 1024),
  }),
});

/**
 * Forum-unread aggregate. Two counts:
 * - pendingSuggestions: SuggestionItem rows with status='pending' on envs the
 *   current user owns. Doesn't use a cursor — pending IS the unread state.
 * - newLikes: SharedEnvironmentLike rows since the user's
 *   notificationLastSeenAt cursor (or all-time if null), excluding
 *   self-likes (impossible by table unique key but defensive).
 */
export const getForumUnreadCount = async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { notificationLastSeenAt: true },
  });

  const since = user?.notificationLastSeenAt ?? undefined;

  const [pendingSuggestions, newLikes] = await Promise.all([
    prisma.suggestionItem.count({
      where: {
        status: 'pending',
        suggestion: { sharedEnvironment: { userId } },
      },
    }),
    prisma.sharedEnvironmentLike.count({
      where: {
        environment: { userId },
        ...(since ? { createdAt: { gt: since } } : {}),
        userId: { not: userId },
      },
    }),
  ]);

  res.json({
    pendingSuggestions,
    newLikes,
    total: pendingSuggestions + newLikes,
  });
};

/**
 * Reset the likes cursor. Pending suggestions are NOT cleared by this — they
 * naturally clear when the owner takes/declines them.
 */
export const markForumRead = async (req: Request, res: Response) => {
  await prisma.user.update({
    where: { id: req.user!.id },
    data: { notificationLastSeenAt: new Date() },
  });
  res.status(204).send();
};

/**
 * Register the latest snapshot seen by the user. The frontend calls this when
 * an article is opened, so a changed article produces a durable notification
 * without polling Normattiva from the Node process.
 */
export const checkNorma = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { normaKey, normaData } = checkNormaSchema.parse(req.body);

  const snapshotData = {
    norma_data: normaData.norma_data,
    article_text: normaData.article_text,
  };
  // Cast: the value above is already JSON-safe (it came off the wire as
  // parsed JSON), but Prisma's Json column input wants `InputJsonValue`
  // rather than `unknown` for norma_data's field type.
  const snapshotJson = snapshotData as Prisma.InputJsonObject;
  const existing = await prisma.normaWatch.findUnique({
    where: { userId_normaKey: { userId, normaKey } },
  });

  // Nothing to compare: an empty body would read as a change against a
  // populated watch and replace its text with nothing. Touch the watch if
  // there is one, register nothing otherwise — the watcher refuses empty
  // text the same way.
  if (!snapshotData.article_text) {
    if (existing) {
      await prisma.normaWatch.update({ where: { id: existing.id }, data: { lastSeenAt: new Date() } });
    }
    return res.json({ watched: Boolean(existing), changed: false });
  }

  if (!existing) {
    await prisma.normaWatch.create({ data: { userId, normaKey, normaData: snapshotJson } });
    return res.json({ watched: true, changed: false });
  }

  // Shared with normaWatcher.ts so both writers of normaWatch rows agree on
  // what "changed" means (see the function's own docstring).
  const outcome = compareNormaSnapshots(existing.normaData, snapshotData);

  if (outcome === 'unchanged') {
    await prisma.normaWatch.update({ where: { id: existing.id }, data: { lastSeenAt: new Date() } });
    return res.json({ watched: true, changed: false });
  }
  if (outcome === 'baseline') {
    await prisma.normaWatch.update({
      where: { id: existing.id },
      data: { normaData: snapshotJson, lastSeenAt: new Date() },
    });
    return res.json({ watched: true, changed: false });
  }

  await prisma.$transaction([
    prisma.normaWatch.update({
      where: { id: existing.id },
      data: { normaData: snapshotJson, lastSeenAt: new Date() },
    }),
    prisma.normaChangeNotification.create({
      data: {
        userId,
        watchId: existing.id,
        normaKey,
        message: `La norma salvata «${normaKey}» è cambiata`,
        snapshot: snapshotJson,
      },
    }),
  ]);

  return res.json({ watched: true, changed: true });
};

export const getNormaNotifications = async (req: Request, res: Response) => {
  const notifications = await prisma.normaChangeNotification.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json(notifications);
};

/** Return the exact unread count; the 50-item notification list is for display only. */
export const getNormaUnreadCount = async (req: Request, res: Response) => {
  const count = await prisma.normaChangeNotification.count({
    where: { userId: req.user!.id, readAt: null },
  });
  res.json({ count });
};

export const markNormaNotificationsRead = async (req: Request, res: Response) => {
  await prisma.normaChangeNotification.updateMany({
    where: { userId: req.user!.id, readAt: null },
    data: { readAt: new Date() },
  });
  res.status(204).send();
};
