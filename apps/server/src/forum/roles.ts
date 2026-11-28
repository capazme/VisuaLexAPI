import type { LingoMateria, Prisma } from '../lib/db';
import { AppError } from '../middleware/errorHandler';

type Db = Pick<Prisma.TransactionClient, 'user'>;

export type Roles = {
  isAdmin: boolean;
  /** An administrator or a moderator of the whole Community (G-266). */
  isModerator: boolean;
  /** The subjects the person moderates, and validates (spec 2026-11-14-forum-community-server-design §C). */
  moderates: LingoMateria[];
  validates: LingoMateria[];
};

/**
 * A person's roles in the Community, read from the database on every call, like `lingoValidatore`: a
 * revocation holds from the next request.
 */
export async function readRoles(db: Db, userId: string): Promise<Roles> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true, forumModerator: true, forumSubjectRoles: { select: { materia: true, role: true } } },
  });
  const subjects = user?.forumSubjectRoles ?? [];
  return {
    isAdmin: Boolean(user?.isAdmin),
    isModerator: Boolean(user?.isAdmin || user?.forumModerator),
    moderates: subjects.filter(role => role.role === 'moderator').map(role => role.materia),
    validates: subjects.filter(role => role.role === 'validator').map(role => role.materia),
  };
}

/** Whether the person moderates a glossa of this subject: the whole Community's moderators, or its own. */
export function moderatesSubject(roles: Roles, materia: LingoMateria | null) {
  return roles.isModerator || (materia !== null && roles.moderates.includes(materia));
}

/** A moderator of the whole Community or of a subject: the queue and the routes, filtered by subject after. */
export async function requireModerator(db: Db, userId: string) {
  const roles = await readRoles(db, userId);
  if (!roles.isModerator && roles.moderates.length === 0) throw new AppError(403, 'Riservato ai moderatori della Community');
  return roles;
}

/** A moderator of this glossa's subject; read after the glossa is locked, as its author may move it. */
export function requireModeratorOf(roles: Roles, materia: LingoMateria | null) {
  if (!moderatesSubject(roles, materia)) throw new AppError(403, 'Riservato ai moderatori di questa materia');
}
