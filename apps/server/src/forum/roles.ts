import type { Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';

type Db = Pick<Prisma.TransactionClient, 'user'>;

/**
 * A moderator of the Community (G-266) or an administrator, read from the database on every call, like
 * `lingoValidatore`: a revocation holds from the next request.
 */
export async function readRoles(db: Db, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { isAdmin: true, forumModerator: true } });
  return { isAdmin: Boolean(user?.isAdmin), isModerator: Boolean(user?.isAdmin || user?.forumModerator) };
}

export async function requireModerator(db: Db, userId: string) {
  const roles = await readRoles(db, userId);
  if (!roles.isModerator) throw new AppError(403, 'Riservato ai moderatori della Community');
  return roles;
}
