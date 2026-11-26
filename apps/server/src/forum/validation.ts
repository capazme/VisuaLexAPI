import { Prisma } from '../lib/db';
import { userView, type Authors } from './views';

/**
 * The Forum's validation (spec 2026-11-14-forum-community-server-design §C, G-478): a glossa or a reply is
 * «validata» once it has the number of validations the owners set, by validators of its subject. It is an
 * added mark of quality: it never holds back or hides anything, and below the threshold an item shows its
 * validations so far. The threshold sits in Learn's settings table (`lingo_impostazioni`), with its log.
 */
export const THRESHOLD_KEY = 'FORUM_SOGLIA_VALIDAZIONI' as const;
export const THRESHOLD_LIMITS = { min: 1, max: 5 } as const;
export const DEFAULT_THRESHOLD = 2;

type Tx = Prisma.TransactionClient;

export async function readThreshold(db: Pick<Tx, 'lingoImpostazione'>): Promise<number> {
  const row = await db.lingoImpostazione.findUnique({ where: { chiave: THRESHOLD_KEY }, select: { valore: true } });
  return row?.valore ?? DEFAULT_THRESHOLD;
}

/**
 * Changes the threshold, on the record, in the caller's transaction: two owners' changes take turns on
 * the row. Nothing is stored per item, so the new value holds at once everywhere.
 */
export async function setThreshold(db: Tx, value: number, userId: string): Promise<number> {
  await db.$executeRaw`INSERT INTO lingo_impostazioni (chiave, valore) VALUES (${THRESHOLD_KEY}::"LingoImpostazioneChiave", ${DEFAULT_THRESHOLD})
    ON CONFLICT (chiave) DO NOTHING`;
  await db.$queryRaw`SELECT chiave FROM lingo_impostazioni WHERE chiave = ${THRESHOLD_KEY}::"LingoImpostazioneChiave" FOR UPDATE`;
  const before = await readThreshold(db);
  if (before !== value) {
    await db.lingoImpostazione.update({ where: { chiave: THRESHOLD_KEY }, data: { valore: value, aggiornataDa: userId, aggiornataIl: new Date() } });
    await db.lingoImpostazioneLog.create({ data: { chiave: THRESHOLD_KEY, valorePrecedente: before, valoreNuovo: value, utenteId: userId } });
  }
  return value;
}

type ValidationRow = { createdAt: Date; validator: { id: string; username: string } | null };

/** The validators to read with an item, for `validationSummary`. */
export const VALIDATIONS_SELECT = {
  select: { validatorId: true, createdAt: true, validator: { select: { id: true, username: true } } },
  orderBy: { createdAt: 'asc' as const },
};

/**
 * What an answer says of an item's validations: none is `null`; otherwise how many, the threshold in
 * force, whether it is reached and when (the time of the validation that reached it), and every validator,
 * by their profile («utente cancellato» once their account is gone).
 */
export function validationSummary(rows: ValidationRow[], threshold: number, authors: Authors) {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const validated = sorted.length >= threshold;
  return {
    count: sorted.length,
    threshold,
    validated,
    validatedAt: validated ? sorted[threshold - 1].createdAt : null,
    validators: sorted.map(row => userView(row.validator, authors)),
  };
}

/** The time an item reached the threshold, for the order of a glossa's replies; null below it. */
export function validatedAt(rows: { createdAt: Date }[], threshold: number): number | null {
  if (rows.length < threshold) return null;
  return [...rows].map(row => row.createdAt.getTime()).sort((a, b) => a - b)[threshold - 1];
}

/**
 * Withdraws the validations of what changed (§C): a glossa's own when its text changes; the glossa's and its
 * replies' when its subject changes (they were given with another subject's authority); a reply's when its
 * text changes. Returns how many went.
 */
export async function withdrawValidations(tx: Pick<Tx, 'forumValidation'>, target: { threadId: string; withReplies?: boolean } | { commentId: string }) {
  if ('commentId' in target) return (await tx.forumValidation.deleteMany({ where: { commentId: target.commentId } })).count;
  const where: Prisma.ForumValidationWhereInput = target.withReplies
    ? { OR: [{ threadId: target.threadId }, { comment: { threadId: target.threadId } }] }
    : { threadId: target.threadId };
  return (await tx.forumValidation.deleteMany({ where })).count;
}

/** The glosse that are, or have a visible reply that is, at the threshold: the feed's `validated` filter. */
export async function validatedThreadIds(db: Pick<Tx, '$queryRaw'>, threshold: number): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT t.id FROM article_threads t
    WHERE (NOT t.is_hidden AND t.deleted_at IS NULL
           AND (SELECT count(*) FROM forum_validations v WHERE v.thread_id = t.id) >= ${threshold})
       OR EXISTS (
         SELECT 1 FROM article_comments c
         WHERE c.thread_id = t.id AND c.parent_id IS NULL AND NOT c.is_hidden AND c.deleted_at IS NULL
           AND (SELECT count(*) FROM forum_validations v WHERE v.comment_id = c.id) >= ${threshold})`;
  return rows.map(row => row.id);
}

/** How many visible replies of each glossa named are at the threshold. */
export async function validatedRepliesOf(db: Pick<Tx, '$queryRaw'>, threadIds: string[], threshold: number) {
  if (threadIds.length === 0) return new Map<string, number>();
  const rows = await db.$queryRaw<{ threadId: string; count: number }[]>`
    SELECT c.thread_id AS "threadId", count(*)::int AS count FROM article_comments c
    WHERE c.thread_id IN (${Prisma.join(threadIds)}) AND c.parent_id IS NULL AND NOT c.is_hidden AND c.deleted_at IS NULL
      AND (SELECT count(*) FROM forum_validations v WHERE v.comment_id = c.id) >= ${threshold}
    GROUP BY c.thread_id`;
  return new Map(rows.map(row => [row.threadId, row.count]));
}

/**
 * A person's visible contributions at the threshold, newest first: the glosse and the replies (not under a
 * hidden glossa), each with the time it reached the threshold and its count.
 */
export async function validatedContributionsOf(db: Pick<Tx, '$queryRaw'>, userId: string, threshold: number) {
  return db.$queryRaw<{
    kind: 'thread' | 'comment'; threadId: string; commentId: string | null; title: string; materia: string | null;
    normaKey: string; articleLabel: string | null; targetKind: string; decisionKey: string | null; validatedAt: Date; count: number;
  }[]>`
    WITH ranked AS (
      SELECT thread_id, comment_id, created_at,
             row_number() OVER (PARTITION BY thread_id, comment_id ORDER BY created_at) AS n,
             count(*) OVER (PARTITION BY thread_id, comment_id) AS total
      FROM forum_validations
    ), reached AS (SELECT thread_id, comment_id, created_at, total FROM ranked WHERE n = ${threshold})
    SELECT 'thread' AS kind, t.id AS "threadId", NULL AS "commentId", t.title, t.materia::text AS materia, t.norma_key AS "normaKey",
           t.article_label AS "articleLabel", t.target_kind AS "targetKind", t.decision_key AS "decisionKey",
           r.created_at AS "validatedAt", r.total::int AS count
    FROM reached r JOIN article_threads t ON t.id = r.thread_id
    WHERE t.user_id = ${userId} AND NOT t.is_hidden AND t.deleted_at IS NULL
    UNION ALL
    SELECT 'comment', t.id, c.id, t.title, t.materia::text, t.norma_key, t.article_label, t.target_kind, t.decision_key,
           r.created_at, r.total::int
    FROM reached r JOIN article_comments c ON c.id = r.comment_id JOIN article_threads t ON t.id = c.thread_id
    WHERE c.user_id = ${userId} AND NOT c.is_hidden AND c.deleted_at IS NULL AND NOT t.is_hidden
    ORDER BY "validatedAt" DESC`;
}
