import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
