import { Request, Response } from 'express';
import { LingoMateria, Prisma } from '../lib/db';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { parseItalian } from '../forum/parseItalian';
import { withDailyLimit } from '../forum/limits';
import { lockComment, lockThread } from '../forum/locks';
import { logModeration } from '../forum/moderationLog';
import { notify } from '../forum/notify';
import { MESSAGES, readAuthors } from '../forum/profiles';
import { readRoles } from '../forum/roles';
import { maybeSweepCommunity } from '../forum/sweep';
import {
  THRESHOLD_LIMITS, DEFAULT_THRESHOLD, VALIDATIONS_SELECT, readThreshold, setThreshold, validationSummary,
} from '../forum/validation';
import { LISTED_THREAD, isOwn, isVisible, userView } from '../forum/views';
import { parsePaging } from './articleDiscussionController';

// The Forum's communities by subject (spec docs/superpowers/specs/2026-11-14-forum-community-server-design.md
// §C; D-214, D-267, G-478): the communities, the owners' appointments of moderators and validators per
// subject, validation and its threshold, and the author's appeal to the owners against a hiding.

type Tx = Prisma.TransactionClient;

const MATERIE = Object.values(LingoMateria);
const kindSchema = z.enum(['thread', 'comment'], { message: 'Il tipo deve essere «thread» o «comment»' });
const reasonSchema = z.string({ message: 'Il motivo è obbligatorio' }).trim().min(3, 'Il motivo deve avere almeno 3 caratteri')
  .max(1000, 'Il motivo può avere al massimo 1000 caratteri');

async function requireOwner(db: Pick<Tx, 'user'>, userId: string) {
  if (!(await readRoles(db, userId)).isAdmin) throw new AppError(403, 'Riservato agli amministratori');
}

/**
 * Every community: its listed glosse, its members (the profiles that follow the subject), its moderators and
 * validators by their profiles; and the glosse in no community.
 */
export const listCommunities = async (_req: Request, res: Response) => {
  const [counts, members, roles, withoutSubject] = await Promise.all([
    prisma.articleThread.groupBy({ by: ['materia'], where: { ...LISTED_THREAD, materia: { not: null } }, _count: { _all: true } }),
    Promise.all(MATERIE.map(materia => prisma.forumProfile.count({ where: { materie: { has: materia } } }))),
    prisma.forumSubjectRole.findMany({ include: { user: { select: { id: true, username: true } } }, orderBy: { createdAt: 'asc' } }),
    prisma.articleThread.count({ where: { ...LISTED_THREAD, materia: null } }),
  ]);
  const authors = await readAuthors(prisma, roles.map(role => role.userId));
  const glosseOf = new Map(counts.map(row => [row.materia, row._count._all]));
  res.json({
    data: MATERIE.map((materia, index) => ({
      materia,
      glosse: glosseOf.get(materia) ?? 0,
      members: members[index],
      moderators: roles.filter(role => role.materia === materia && role.role === 'moderator').map(role => userView(role.user, authors)),
      validators: roles.filter(role => role.materia === materia && role.role === 'validator').map(role => userView(role.user, authors)),
    })),
    withoutSubject: { glosse: withoutSubject },
  });
};

const roleSchema = z.object({
  materia: z.enum(LingoMateria, { message: 'La materia non è valida' }),
  role: z.enum(['moderator', 'validator'], { message: 'Il ruolo deve essere «moderator» o «validator»' }),
  granted: z.boolean({ message: '«granted» deve essere vero o falso' }),
  reason: reasonSchema,
}, { message: 'La richiesta non è valida' });

const ROLE_ACTIONS = {
  moderator: { grant: 'appoint_moderator', revoke: 'revoke_moderator' },
  validator: { grant: 'appoint_validator', revoke: 'revoke_validator' },
} as const;

/**
 * The owners appoint and revoke a subject's moderator or validator (D-267), with a reason, logged with the
 * subject. A validator signs with the real name (D-246); a moderator needs a profile, to be recognisable.
 * The person's account row is held for update, as a change of profile holds it: a validator never moves
 * to a pseudonym in between.
 */
export const setSubjectRole = async (req: Request, res: Response) => {
  const body = parseItalian(roleSchema, req.body);
  const actorId = req.user!.id;
  const userId = req.params.id;
  const roles = await prisma.$transaction(async (tx) => {
    await requireOwner(tx, actorId);
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    if (locked.length === 0) throw new AppError(404, 'Utente non trovato');
    const key = { userId_materia_role: { userId, materia: body.materia, role: body.role } };
    const held = await tx.forumSubjectRole.findUnique({ where: key });
    if (body.granted && !held) {
      const profile = await tx.forumProfile.findUnique({ where: { userId }, select: { identity: true, nameWithdrawnAt: true } });
      if (body.role === 'validator' && (profile?.identity !== 'real_name' || profile.nameWithdrawnAt)) {
        throw new AppError(409, 'Per nominare un validatore serve il suo profilo con il nome vero');
      }
      if (body.role === 'moderator' && (!profile || profile.nameWithdrawnAt)) {
        throw new AppError(409, 'Per nominare un moderatore serve il suo profilo nel Forum');
      }
      await tx.forumSubjectRole.create({ data: { userId, materia: body.materia, role: body.role, appointedBy: actorId } });
      await logModeration(tx, { actorId, action: ROLE_ACTIONS[body.role].grant, targetKind: 'user', targetId: userId, reason: body.reason, materia: body.materia });
    } else if (!body.granted && held) {
      await tx.forumSubjectRole.delete({ where: key });
      await logModeration(tx, { actorId, action: ROLE_ACTIONS[body.role].revoke, targetKind: 'user', targetId: userId, reason: body.reason, materia: body.materia });
    }
    return tx.forumSubjectRole.findMany({ where: { userId }, select: { materia: true, role: true }, orderBy: [{ materia: 'asc' }, { role: 'asc' }] });
  });
  res.json({ roles });
};

/** The glossa, and the reply, locked in the Community's order; 404 when gone. */
async function lockItem(tx: Tx, kind: 'thread' | 'comment', itemId: string) {
  if (kind === 'thread') {
    if (!(await lockThread(tx, itemId))) throw new AppError(404, 'Glossa non trovata');
    const thread = await tx.articleThread.findUniqueOrThrow({ where: { id: itemId } });
    return { thread, comment: null };
  }
  const found = await tx.articleComment.findUnique({ where: { id: itemId }, select: { threadId: true } });
  if (!found || !(await lockThread(tx, found.threadId)) || !(await lockComment(tx, itemId))) throw new AppError(404, 'Risposta non trovata');
  const [thread, comment] = await Promise.all([
    tx.articleThread.findUniqueOrThrow({ where: { id: found.threadId } }),
    tx.articleComment.findUniqueOrThrow({ where: { id: itemId } }),
  ]);
  return { thread, comment };
}

async function summaryOf(tx: Tx, kind: 'thread' | 'comment', itemId: string) {
  const rows = await tx.forumValidation.findMany({ where: kind === 'thread' ? { threadId: itemId } : { commentId: itemId }, ...VALIDATIONS_SELECT });
  const [threshold, authors] = await Promise.all([readThreshold(tx), readAuthors(tx, rows.map(row => row.validatorId))]);
  return validationSummary(rows, threshold, authors);
}

/**
 * A validator of the glossa's subject validates someone else's visible glossa or reply (§C): under the real
 * name (D-246), the account row held for share after the item's locks, as every write of the Community.
 * Validating again changes nothing. The author is told once, when the item reaches the threshold.
 */
export const validateItem = async (req: Request, res: Response) => {
  const kind = parseItalian(kindSchema, req.params.kind);
  const userId = req.user!.id;
  const itemId = req.params.itemId;
  const validation = await withDailyLimit('edit', userId, () => prisma.$transaction(async (tx) => {
    const { thread, comment } = await lockItem(tx, kind, itemId);
    const item = comment ?? thread;
    if (!isVisible(item) || (comment && thread.isHidden)) throw new AppError(404, kind === 'thread' ? 'Glossa non trovata' : 'Risposta non trovata');
    if (comment && comment.parentId !== null) throw new AppError(400, 'Si valida una glossa o una risposta, non un commento');
    if (thread.materia === null) throw new AppError(409, 'La glossa non ha una materia: non si può validare');
    // The account row for share first: an owner's revocation (which holds it for update) never lands between
    // reading the role and the validation.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR SHARE`;
    if (!(await readRoles(tx, userId)).validates.includes(thread.materia)) throw new AppError(403, 'Solo i validatori di questa materia possono validare');
    const profile = await tx.forumProfile.findUnique({ where: { userId }, select: { identity: true, nameWithdrawnAt: true } });
    if (profile?.nameWithdrawnAt) throw new AppError(403, MESSAGES.withdrawn.text, MESSAGES.withdrawn.code);
    if (profile?.identity !== 'real_name') throw new AppError(403, 'Per validare serve il profilo con il nome vero', MESSAGES.sign.code);
    if (isOwn(item.userId, userId)) throw new AppError(403, 'Non puoi validare un tuo contributo');
    const where = comment ? { commentId: itemId, validatorId: userId } : { threadId: itemId, validatorId: userId };
    if (!(await tx.forumValidation.findFirst({ where, select: { id: true } }))) {
      await tx.forumValidation.create({ data: { ...where, materia: thread.materia } });
    }
    const summary = await summaryOf(tx, kind, itemId);
    const told = await tx.forumNotification.count({ where: { kind: 'validated', threadId: thread.id, commentId: comment ? itemId : null } });
    if (summary?.validated && told === 0) {
      await notify(tx, { to: item.userId, by: userId, kind: 'validated', threadId: thread.id, commentId: comment ? itemId : null });
    }
    return summary;
  }));
  res.json({ validation });
};

/** The validator withdraws their own validation; 404 when there is none. */
export const withdrawValidation = async (req: Request, res: Response) => {
  const kind = parseItalian(kindSchema, req.params.kind);
  const userId = req.user!.id;
  const itemId = req.params.itemId;
  const validation = await prisma.$transaction(async (tx) => {
    await lockItem(tx, kind, itemId);
    const { count } = await tx.forumValidation.deleteMany({
      where: kind === 'thread' ? { threadId: itemId, validatorId: userId } : { commentId: itemId, validatorId: userId },
    });
    if (count === 0) throw new AppError(404, 'Non hai validato questo contributo');
    return summaryOf(tx, kind, itemId);
  });
  res.json({ validation });
};

const thresholdAnswer = (threshold: number) => ({ threshold, limits: THRESHOLD_LIMITS, default: DEFAULT_THRESHOLD });

/** The owners read the number of validations that makes an item «validata» (G-478). */
export const getValidationThreshold = async (req: Request, res: Response) => {
  await requireOwner(prisma, req.user!.id);
  res.json(thresholdAnswer(await readThreshold(prisma)));
};

const thresholdSchema = z.object({
  threshold: z.number({ message: 'La soglia va da 1 a 5' }).int('La soglia va da 1 a 5')
    .min(THRESHOLD_LIMITS.min, 'La soglia va da 1 a 5').max(THRESHOLD_LIMITS.max, 'La soglia va da 1 a 5'),
}, { message: 'La richiesta non è valida' });

/** The owners change it, in Learn's settings table and its log; it holds at once for every item. */
export const putValidationThreshold = async (req: Request, res: Response) => {
  const { threshold } = parseItalian(thresholdSchema, req.body);
  const actorId = req.user!.id;
  const value = await prisma.$transaction(async (tx) => {
    await requireOwner(tx, actorId);
    return setThreshold(tx, threshold, actorId);
  });
  res.json(thresholdAnswer(value));
};

const appealSchema = z.object({
  kind: kindSchema,
  itemId: z.string({ message: 'Il contributo non è valido' }).guid('Il contributo non è valido'),
  text: z.string({ message: 'Il testo è obbligatorio' }).trim().min(3, 'Il ricorso deve avere almeno 3 caratteri')
    .max(2000, 'Il ricorso può avere al massimo 2000 caratteri'),
}, { message: 'La richiesta non è valida' });

const HIDDEN_NOT_FOUND = 'Contributo nascosto non trovato';

/**
 * The author appeals to the owners against a hiding (D-267): their own contribution, hidden, not emptied;
 * once per hiding (no appeal of theirs since it was last hidden). Under the `report` counter.
 */
export const createAppeal = async (req: Request, res: Response) => {
  const body = parseItalian(appealSchema, req.body);
  const userId = req.user!.id;
  await maybeSweepCommunity();
  const appeal = await withDailyLimit('report', userId, () => prisma.$transaction(async (tx) => {
    let thread;
    let item;
    try {
      ({ thread, comment: item } = await lockItem(tx, body.kind, body.itemId));
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 404) throw new AppError(404, HIDDEN_NOT_FOUND);
      throw error;
    }
    const target = item ?? thread;
    if (!isOwn(target.userId, userId) || !target.isHidden || target.deletedAt !== null) throw new AppError(404, HIDDEN_NOT_FOUND);
    const since = await tx.forumAppeal.count({
      where: { userId, targetKind: body.kind, targetId: body.itemId, ...(target.hiddenAt ? { createdAt: { gte: target.hiddenAt } } : {}) },
    });
    if (since > 0) throw new AppError(409, 'Hai già fatto ricorso contro questa decisione');
    return tx.forumAppeal.create({
      data: { userId, targetKind: body.kind, targetId: body.itemId, threadId: thread.id, text: body.text },
      select: { id: true, status: true },
    });
  }));
  res.status(201).json(appeal);
};

const appealQueueSchema = z.object({
  status: z.enum(['pending', 'upheld', 'rejected'], { message: 'Lo stato deve essere «pending», «upheld» o «rejected»' }).default('pending'),
});

/**
 * The owners' queue of appeals, oldest first: each with the item's text, the hiding's category and logged
 * reason, the subject. The author's account is the owners' to read, as in the reports' queue.
 */
export const listAppeals = async (req: Request, res: Response) => {
  await requireOwner(prisma, req.user!.id);
  const { status } = parseItalian(appealQueueSchema, req.query);
  const { page, limit } = parsePaging(req.query);
  const [total, appeals] = await Promise.all([
    prisma.forumAppeal.count({ where: { status } }),
    prisma.forumAppeal.findMany({ where: { status }, orderBy: { createdAt: 'asc' }, skip: (page - 1) * limit, take: limit }),
  ]);
  const threadIds = [...new Set(appeals.map(appeal => appeal.threadId))];
  const commentIds = appeals.filter(appeal => appeal.targetKind === 'comment').map(appeal => appeal.targetId);
  const [threads, comments, hidings] = await Promise.all([
    prisma.articleThread.findMany({ where: { id: { in: threadIds } } }),
    prisma.articleComment.findMany({ where: { id: { in: commentIds } } }),
    prisma.forumModerationLog.findMany({
      where: { action: 'hide', targetId: { in: appeals.map(appeal => appeal.targetId) } }, orderBy: { createdAt: 'desc' },
    }),
  ]);
  const threadById = new Map(threads.map(thread => [thread.id, thread]));
  const commentById = new Map(comments.map(comment => [comment.id, comment]));
  res.json({
    data: appeals.map((appeal) => {
      const thread = threadById.get(appeal.threadId) ?? null;
      const item = appeal.targetKind === 'thread' ? thread : commentById.get(appeal.targetId) ?? null;
      // The hiding the appeal answers: the latest before it.
      const hiding = hidings.find(row => row.targetKind === appeal.targetKind && row.targetId === appeal.targetId
        && row.createdAt <= appeal.createdAt) ?? null;
      return {
        id: appeal.id,
        kind: appeal.targetKind,
        itemId: appeal.targetId,
        threadId: appeal.threadId,
        status: appeal.status,
        text: appeal.text,
        createdAt: appeal.createdAt,
        decidedAt: appeal.decidedAt,
        decisionNote: appeal.decisionNote,
        materia: thread?.materia ?? null,
        item: item && {
          title: appeal.targetKind === 'thread' && thread ? thread.title : null,
          body: item.body,
          category: item.hiddenReason,
          hidden: item.isHidden,
          emptied: item.deletedAt !== null,
        },
        hidingReason: hiding?.reason ?? null,
      };
    }),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
};

const decideSchema = z.object({
  action: z.enum(['uphold', 'reject'], { message: 'L’azione deve essere «uphold» o «reject»' }),
  reason: reasonSchema,
}, { message: 'La richiesta non è valida' });

/**
 * The owners decide an appeal (D-267): upholding shows the contribution again (logged as `unhide`),
 * rejecting keeps it hidden (logged as `appeal_rejected`); the author is told either way. The item's
 * glossa, then its reply, then the appeal are locked.
 */
export const decideAppeal = async (req: Request, res: Response) => {
  const body = parseItalian(decideSchema, req.body);
  const actorId = req.user!.id;
  const status = await prisma.$transaction(async (tx) => {
    await requireOwner(tx, actorId);
    const found = await tx.forumAppeal.findUnique({ where: { id: req.params.id } });
    if (!found) throw new AppError(404, 'Ricorso non trovato');
    const kind = found.targetKind as 'thread' | 'comment';
    const threadThere = await lockThread(tx, found.threadId);
    if (kind === 'comment' && threadThere) await lockComment(tx, found.targetId);
    await tx.$queryRaw`SELECT id FROM forum_appeals WHERE id = ${found.id} FOR UPDATE`;
    const appeal = await tx.forumAppeal.findUniqueOrThrow({ where: { id: found.id } });
    if (appeal.status !== 'pending') throw new AppError(409, 'Il ricorso è già stato deciso');
    const decided = body.action === 'uphold' ? 'upheld' : 'rejected';
    if (body.action === 'uphold') {
      const shown = { isHidden: false, hiddenReason: null, hiddenAt: null };
      const { count } = kind === 'thread'
        ? await tx.articleThread.updateMany({ where: { id: appeal.targetId, isHidden: true }, data: shown })
        : await tx.articleComment.updateMany({ where: { id: appeal.targetId, isHidden: true }, data: shown });
      if (count) await logModeration(tx, { actorId, action: 'unhide', targetKind: kind, targetId: appeal.targetId, reason: body.reason });
    } else {
      await logModeration(tx, { actorId, action: 'appeal_rejected', targetKind: kind, targetId: appeal.targetId, reason: body.reason });
    }
    await tx.forumAppeal.update({
      where: { id: appeal.id }, data: { status: decided, decidedAt: new Date(), decidedById: actorId, decisionNote: body.reason },
    });
    if (threadThere) {
      await notify(tx, { to: appeal.userId, by: actorId, kind: 'appeal', threadId: appeal.threadId, commentId: kind === 'comment' ? appeal.targetId : null });
    }
    return decided;
  });
  res.json({ status });
};
