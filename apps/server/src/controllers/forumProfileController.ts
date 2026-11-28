import { randomUUID } from 'node:crypto';
import { Request, Response } from 'express';
import { Prisma, type ForumProfile } from '../lib/db';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { isSwitchOn } from '../assistant/switches';
import { parseItalian } from '../forum/parseItalian';
import { withDailyLimit } from '../forum/limits';
import { logModeration } from '../forum/moderationLog';
import { readRoles } from '../forum/roles';
import { maybeSweepCommunity } from '../forum/sweep';
import { MESSAGES, isReservedPseudonym, profileSchema } from '../forum/profiles';
import { personalScores } from '../forum/votes';
import { decisionLabel, profileFace } from '../forum/views';
import { readThreshold, validatedContributionsOf } from '../forum/validation';
import { parsePaging } from './articleDiscussionController';

// The Forum's minimal profile (spec docs/superpowers/specs/2026-11-14-forum-community-server-design.md §B;
// D-246, D-247, D-249, G-477, G-479): one's own profile, a public profile, and the report «non è chi dice di
// essere», which only the owners (administrators) read and decide.

type Tx = Prisma.TransactionClient;

/** What a person has standing under their name: glosse and replies or comments not emptied, hidden ones included. */
async function standing(db: Pick<Tx, 'articleThread' | 'articleComment'>, userId: string) {
  const [glosse, risposte] = await Promise.all([
    db.articleThread.count({ where: { userId, deletedAt: null } }),
    db.articleComment.count({ where: { userId, deletedAt: null } }),
  ]);
  return { glosse, risposte };
}

function ownView(profile: ForumProfile | null) {
  return profile && {
    id: profile.id,
    identity: profile.identity,
    realName: profile.realName,
    pseudonym: profile.pseudonym,
    qualification: profile.qualification,
    materie: profile.materie,
    updatedAt: profile.updatedAt,
  };
}

/** A person's roles in the communities (§C): public, as validators and moderators are named (P-012). */
function rolesOf(db: Pick<Tx, 'forumSubjectRole'>, userId: string) {
  return db.forumSubjectRole.findMany({ where: { userId }, select: { materia: true, role: true }, orderBy: [{ materia: 'asc' }, { role: 'asc' }] });
}

/** One's own profile, and what one may do now (§B). */
async function ownAnswer(db: Tx | typeof prisma, userId: string) {
  const [profile, required, scores, contributions, roles] = await Promise.all([
    db.forumProfile.findUnique({ where: { userId } }),
    isSwitchOn('forum_identity', db),
    personalScores(db, [userId]),
    standing(db, userId),
    rolesOf(db, userId),
  ]);
  const withdrawn = Boolean(profile?.nameWithdrawnAt);
  return {
    profile: ownView(profile),
    required,
    canWrite: !withdrawn && (!required || profile !== null),
    canSign: !withdrawn && profile?.identity !== 'pseudonym' && (!required || profile?.identity === 'real_name'),
    score: scores.get(userId) ?? 0,
    contributions,
    roles,
    nameWithdrawn: profile?.nameWithdrawnAt ? { at: profile.nameWithdrawnAt, reason: profile.nameWithdrawnReason } : null,
  };
}

export const getOwnProfile = async (req: Request, res: Response) => {
  res.json(await ownAnswer(prisma, req.user!.id));
};

/**
 * Creates or replaces one's profile (§B). Taking a pseudonym never relabels what others have read under
 * another name: refused while anything stands under the real name or the username; leaving the real name
 * renews the public id. The account row is held for update, so no write of the person's lands between the
 * check and the change (each write holds it for share).
 */
export const putOwnProfile = async (req: Request, res: Response) => {
  const data = parseItalian(profileSchema, req.body);
  const userId = req.user!.id;
  if (data.identity === 'pseudonym' && isReservedPseudonym(data.pseudonym)) throw new AppError(400, MESSAGES.reserved);
  const answer = await withDailyLimit('edit', userId, () => prisma.$transaction(async (tx) => {
    // The account row, then the profile row: an owner's decision on the profile (which locks it) never
    // lands between this read and the change.
    const [account] = await tx.$queryRaw<{ username: string }[]>`SELECT username FROM users WHERE id = ${userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM forum_profiles WHERE user_id = ${userId} FOR UPDATE`;
    const current = await tx.forumProfile.findUnique({ where: { userId } });
    if (current?.nameWithdrawnAt) throw new AppError(403, MESSAGES.withdrawn.text, MESSAGES.withdrawn.code);
    let renewId = false;
    if (data.identity === 'pseudonym') {
      // One's own username would name the person: the Forum's published dossiers show it with the account.
      if (account.username.toLowerCase() === data.pseudonym.toLowerCase()) throw new AppError(400, MESSAGES.ownUsername);
      // Exact, without regard to case: Prisma's case-blind `equals` is an ILIKE, where `_` matches any letter.
      const [taken] = await tx.$queryRaw<{ taken: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM forum_profiles WHERE lower(pseudonym) = lower(${data.pseudonym}) AND user_id <> ${userId})
            OR EXISTS (SELECT 1 FROM users WHERE lower(username) = lower(${data.pseudonym}) AND id <> ${userId}) AS taken`;
      if (taken.taken) throw new AppError(409, MESSAGES.taken);
      if (current?.identity !== 'pseudonym') {
        // A validator signs with the real name (D-246), and so did every validation given (§C).
        const [held, given] = await Promise.all([
          tx.forumSubjectRole.count({ where: { userId, role: 'validator' } }),
          tx.forumValidation.count({ where: { validatorId: userId } }),
        ]);
        if (held + given > 0) throw new AppError(409, 'Sei validatore o hai validato con il tuo nome: non puoi passare a uno pseudonimo');
        const { glosse, risposte } = await standing(tx, userId);
        if (glosse + risposte > 0) throw new AppError(409, MESSAGES.otherName);
        renewId = current !== null;
      }
    }
    const fields = {
      identity: data.identity,
      realName: data.identity === 'real_name' ? data.realName : null,
      pseudonym: data.identity === 'pseudonym' ? data.pseudonym : null,
      qualification: data.qualification,
      materie: data.materie,
    };
    try {
      if (!current) await tx.forumProfile.create({ data: { userId, ...fields } });
      else await tx.forumProfile.update({ where: { userId }, data: { ...fields, ...(renewId ? { id: randomUUID() } : {}) } });
    } catch (error) {
      // The case-blind unique index on the pseudonym (the migration's): another person took it meanwhile.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError(409, MESSAGES.taken);
      throw error;
    }
    return ownAnswer(tx, userId);
  }));
  res.json(answer);
};

/**
 * A public profile (§B): name or pseudonym, qualification as declared, subjects, personal score. Never the
 * email, the account's username or id, the votes cast, the reports made, the moderation's acts.
 */
export const getPublicProfile = async (req: Request, res: Response) => {
  const profile = await prisma.forumProfile.findUnique({ where: { id: req.params.profileId } });
  if (!profile) throw new AppError(404, MESSAGES.notFound);
  const [scores, roles, validated] = await Promise.all([
    personalScores(prisma, [profile.userId]),
    rolesOf(prisma, profile.userId),
    readThreshold(prisma).then(threshold => validatedContributionsOf(prisma, profile.userId, threshold)),
  ]);
  res.json({
    id: profile.id, ...profileFace(profile), materie: profile.materie, score: scores.get(profile.userId) ?? 0,
    roles, validatedCount: validated.length,
  });
};

/**
 * A person's validated contributions (D-249, §C): their visible glosse and replies at the threshold,
 * newest first, each with its glossa's title and anchor, the subject, when it reached the threshold and how
 * many validations it has.
 */
export const listValidatedContributions = async (req: Request, res: Response) => {
  const { page, limit } = parsePaging(req.query);
  const profile = await prisma.forumProfile.findUnique({ where: { id: req.params.profileId }, select: { userId: true } });
  if (!profile) throw new AppError(404, MESSAGES.notFound);
  const rows = await validatedContributionsOf(prisma, profile.userId, await readThreshold(prisma));
  res.json({
    data: rows.slice((page - 1) * limit, page * limit).map(row => ({
      kind: row.kind,
      threadId: row.threadId,
      commentId: row.commentId,
      title: row.title,
      materia: row.materia,
      normaKey: row.normaKey,
      articleLabel: row.articleLabel,
      decisionLabel: decisionLabel(row),
      validatedAt: row.validatedAt,
      count: row.count,
    })),
    pagination: { page, limit, total: rows.length, pages: Math.ceil(rows.length / limit) },
  });
};

const reportSchema = z.object({
  details: z.string({ message: 'I dettagli non sono validi' }).trim().max(1000, 'I dettagli possono avere al massimo 1000 caratteri').optional(),
}, { message: 'La richiesta non è valida' });

/**
 * «Non è chi dice di essere» (G-479): any person, never on their own profile, one pending report each (a
 * second one replaces its details). Read by the owners alone.
 */
export const reportProfile = async (req: Request, res: Response) => {
  const { details } = parseItalian(reportSchema, req.body ?? {});
  const userId = req.user!.id;
  await maybeSweepCommunity();
  const profile = await prisma.forumProfile.findUnique({ where: { id: req.params.profileId }, select: { id: true, userId: true } });
  if (!profile) throw new AppError(404, MESSAGES.notFound);
  if (profile.userId === userId) throw new AppError(400, 'Non puoi segnalare il tuo profilo');
  const replacePending = () => prisma.forumProfileReport.updateMany({
    where: { profileId: profile.id, userId, status: 'pending' }, data: { details: details || null },
  });
  await withDailyLimit('report', userId, async () => {
    if ((await replacePending()).count) return;
    try {
      await prisma.forumProfileReport.create({ data: { profileId: profile.id, userId, details: details || null } });
    } catch (error) {
      // The same person's report made at the same instant (one pending each, the migration's index).
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      await replacePending();
    }
  });
  res.status(204).send();
};

async function requireOwner(db: Pick<Tx, 'user'>, userId: string) {
  if (!(await readRoles(db, userId)).isAdmin) throw new AppError(403, 'Riservato agli amministratori');
}

const queueSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'dismissed'], { message: 'Lo stato deve essere «pending», «confirmed» o «dismissed»' }).default('pending'),
});

/**
 * The owners' queue of reports «non è chi dice di essere»: one row per profile, its reports grouped, oldest
 * first; the profile as the public sees it and, to check it, the account's username and email. The
 * reporters are not named.
 */
export const listProfileReports = async (req: Request, res: Response) => {
  await requireOwner(prisma, req.user!.id);
  const { status } = parseItalian(queueSchema, req.query);
  const { page, limit } = parsePaging(req.query);
  await maybeSweepCommunity();
  const reports = await prisma.forumProfileReport.findMany({ where: { status }, orderBy: { createdAt: 'asc' } });
  const groups = new Map<string, typeof reports>();
  for (const report of reports) {
    if (!groups.has(report.profileId)) groups.set(report.profileId, []);
    groups.get(report.profileId)!.push(report);
  }
  const ordered = [...groups.entries()];
  const pageRows = ordered.slice((page - 1) * limit, page * limit);
  const profiles = await prisma.forumProfile.findMany({
    where: { id: { in: pageRows.map(([profileId]) => profileId) } },
    include: { user: { select: { username: true, email: true } } },
  });
  const byId = new Map(profiles.map(profile => [profile.id, profile]));
  res.json({
    data: pageRows.map(([profileId, rows]) => {
      const profile = byId.get(profileId) ?? null;
      return {
        profileId,
        // Gone: the account was deleted, or the profile moved to a pseudonym and took a new id.
        deleted: profile === null,
        profile: profile && {
          name: profile.identity === 'real_name' ? profile.realName : profile.pseudonym,
          identity: profile.identity,
          qualification: profile.qualification,
          withdrawn: profile.nameWithdrawnAt !== null,
        },
        account: profile && { username: profile.user.username, email: profile.user.email },
        count: rows.length,
        firstReportedAt: rows[0].createdAt,
        reports: rows.map(row => ({
          details: row.details, status: row.status, createdAt: row.createdAt, resolvedAt: row.resolvedAt, resolutionNote: row.resolutionNote,
        })),
      };
    }),
    pagination: { page, limit, total: ordered.length, pages: Math.ceil(ordered.length / limit) },
  });
};

const reasonSchema = z.string({ message: 'Il motivo è obbligatorio' }).trim().min(3, 'Il motivo deve avere almeno 3 caratteri')
  .max(1000, 'Il motivo può avere al massimo 1000 caratteri');
const resolveSchema = z.object({
  action: z.enum(['confirm', 'dismiss'], { message: 'L’azione deve essere «confirm» o «dismiss»' }),
  reason: reasonSchema,
}, { message: 'La richiesta non è valida' });

/** Locks a profile by its id; null when it is gone. */
async function lockProfile(tx: Tx, profileId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM forum_profiles WHERE id = ${profileId} FOR UPDATE`;
  return rows.length ? tx.forumProfile.findUniqueOrThrow({ where: { id: profileId } }) : null;
}

/**
 * One decision closes every pending report of a profile (G-479). Confirming withdraws the name, with the
 * reason the person reads on their own profile; dismissing leaves it. Both are logged.
 */
export const resolveProfileReports = async (req: Request, res: Response) => {
  const body = parseItalian(resolveSchema, req.body);
  const actorId = req.user!.id;
  const profileId = req.params.profileId;
  const outcome = await prisma.$transaction(async (tx) => {
    await requireOwner(tx, actorId);
    const profile = await lockProfile(tx, profileId);
    const pending = { profileId, status: 'pending' };
    if (!(await tx.forumProfileReport.count({ where: pending }))) throw new AppError(404, 'Nessuna segnalazione aperta su questo profilo');
    if (body.action === 'confirm') {
      if (!profile) throw new AppError(409, 'Il profilo non c’è più: si può solo archiviare la segnalazione');
      if (!profile.nameWithdrawnAt) {
        await tx.forumProfile.update({ where: { id: profileId }, data: { nameWithdrawnAt: new Date(), nameWithdrawnReason: body.reason } });
      }
    }
    const status = body.action === 'confirm' ? 'confirmed' : 'dismissed';
    const { count } = await tx.forumProfileReport.updateMany({
      where: pending, data: { status, resolvedAt: new Date(), resolvedById: actorId, resolutionNote: body.reason },
    });
    // A name withdrawn already keeps the first reason, the one the person reads: the reports closed here
    // say who closed them and why.
    if (body.action === 'dismiss') {
      await logModeration(tx, { actorId, action: 'dismiss', targetKind: 'report', targetId: `profile:${profileId}`, reason: body.reason });
    } else if (!profile!.nameWithdrawnAt) {
      await logModeration(tx, { actorId, action: 'withdraw_name', targetKind: 'profile', targetId: profileId, reason: body.reason });
    }
    return { closed: count, status };
  });
  res.json(outcome);
};

const restoreSchema = z.object({ reason: reasonSchema }, { message: 'La richiesta non è valida' });

/** The owners give a withdrawn name back (G-479), on the record. */
export const restoreProfileName = async (req: Request, res: Response) => {
  const { reason } = parseItalian(restoreSchema, req.body);
  const actorId = req.user!.id;
  await prisma.$transaction(async (tx) => {
    await requireOwner(tx, actorId);
    const profile = await lockProfile(tx, req.params.profileId);
    if (!profile) throw new AppError(404, MESSAGES.notFound);
    if (!profile.nameWithdrawnAt) throw new AppError(409, 'Il nome di questo profilo non è ritirato');
    await tx.forumProfile.update({ where: { id: profile.id }, data: { nameWithdrawnAt: null, nameWithdrawnReason: null } });
    await logModeration(tx, { actorId, action: 'restore_name', targetKind: 'profile', targetId: profile.id, reason });
  });
  res.json({ withdrawn: false });
};
