import type { LingoFonteXp, LingoMateria, LingoMissione, Prisma } from '@prisma/client';
import { CONSOLIDATED_DAYS, maturity } from './cardMaturity';
import { levelOf } from './levels';
import { reviewScope } from './reviewQueue';
import { computeStreak } from './streak';
import { addDays } from './studyDay';
import { countedDays, dayToDate, romeDayStartSql } from './studyDays';
import { readPreferences } from './studyPreferences';
import { dueWhere, introducedToday, newCardsWhere } from './todayQueue';
import { votableWhere } from './validationQueue';
import { creditedNow, insertCredit, levelNow, periodOf, type XpLivello, type XpPeriodKind } from './xpLedger';

/**
 * Gymnasium's missions (Gymnasium XP spec §3, §5.1): the catalogue, how each is decided from stored facts, and
 * `settleMissions`, the one writer of the XP ledger. A mission is worth its value once per period, so no amount
 * of repetition earns more; a mission is «fatta» if and only if its credit exists.
 *
 * Nothing here reads what the client sent: the events name only rows the server has just stored, and every
 * mission is evaluated from the stored day, the review log, the review states and the scopes, in Rome days of
 * the server's clock. `settleMissions` is called only from routes of the user's session (the grade, the proposal,
 * the vote, the progress and session reads), never from a route an exchanged token can reach (spec §8).
 *
 * The vote rule (`lingo/validationRule.ts`) never reads this module or the level (G-253, G-318).
 */

export type MissionId = 'dovute' | 'nuove' | 'obiettivo' | 'materia-ferma' | 'scrivi' | 'convalida' | 'caso' | 'settimana' | 'consolida';

export type XpEvent =
  | { tipo: 'revisione'; logId: string; cardId: string; materia: LingoMateria; isNew: boolean; intervallo: number }
  | { tipo: 'proposta'; cardId: string; materia: LingoMateria }
  | { tipo: 'voto'; votoId: string }
  | { tipo: 'lettura' };

interface MissionDef {
  id: MissionId;
  /** The ledger's enum value; null for a mission announced but not yet recorded («caso»). */
  missione: LingoMissione | null;
  gruppo: XpPeriodKind;
  /** The three missions of «Le missioni di oggi». */
  principale: boolean;
  punti: number;
  /** The events that evaluate it (spec §5.1). */
  eventi: readonly XpEvent['tipo'][];
}

const REVIEW_EVENTS = ['revisione', 'lettura'] as const;

/**
 * The catalogue of the first cut, in the web's order (`apps/web/.../missions/missions.ts`). Values are the draft's
 * (L-27 choice 1, «Consolida 50 schede» at 100), to be reviewed after a month of use. Italian titles stay in the web.
 */
export const MISSIONS: readonly MissionDef[] = [
  { id: 'dovute', missione: 'DOVUTE', gruppo: 'giornaliera', principale: true, punti: 20, eventi: REVIEW_EVENTS },
  { id: 'nuove', missione: 'NUOVE', gruppo: 'giornaliera', principale: true, punti: 15, eventi: REVIEW_EVENTS },
  { id: 'obiettivo', missione: 'OBIETTIVO', gruppo: 'giornaliera', principale: true, punti: 10, eventi: REVIEW_EVENTS },
  { id: 'materia-ferma', missione: 'MATERIA_FERMA', gruppo: 'giornaliera', principale: false, punti: 15, eventi: REVIEW_EVENTS },
  // A proposal leaves no dated row, so only the proposal itself can credit it.
  { id: 'scrivi', missione: 'SCRIVI', gruppo: 'giornaliera', principale: false, punti: 25, eventi: ['proposta'] },
  { id: 'convalida', missione: 'CONVALIDA', gruppo: 'giornaliera', principale: false, punti: 20, eventi: ['voto', 'lettura'] },
  // Needs the short cases; its enum value is added with them (`ALTER TYPE … ADD VALUE`).
  { id: 'caso', missione: null, gruppo: 'giornaliera', principale: false, punti: 40, eventi: [] },
  { id: 'settimana', missione: 'SETTIMANA', gruppo: 'settimanale', principale: false, punti: 50, eventi: REVIEW_EVENTS },
  { id: 'consolida', missione: 'CONSOLIDA', gruppo: 'lungo', principale: false, punti: 100, eventi: REVIEW_EVENTS },
];

/** A safety net, not the rule (G-315): the catalogue's most in one day stays under it (a test pins it). */
export const XP_DAILY_CEILING = 300;
/** The reviews «obiettivo» needs for XP whatever the user's own goal (L-27 choice 5; the default goal). */
export const XP_GOAL_FLOOR = 10;
/** The new cards «nuove» asks for, lowered only when fewer are left in the review scope (spec §3.3). */
export const NEW_CARDS_TARGET = 5;
/** «materia-ferma»: a subject last reviewed this many days ago or more, and the reviews it asks for today. */
export const STALE_SUBJECT_DAYS = 7;
export const STALE_SUBJECT_REVIEWS = 5;
export const VOTES_TARGET = 2;
export const STREAK_WEEK = 7;
export const CONSOLIDATED_TARGET = 50;

/**
 * The two-key advisory lock class of a user's XP (`pg_advisory_xact_lock(class, hashtext(user))`): its key
 * space does not overlap the one-key locks the grade takes on `hashtext(user || ':' || card)`.
 */
export const LINGO_XP_LOCK_CLASS = 5870;

const FONTE: Record<XpEvent['tipo'], LingoFonteXp> = { revisione: 'REVISIONE', proposta: 'PROPOSTA', voto: 'VOTO', lettura: 'LETTURA' };

export interface XpCredito {
  missione: MissionId;
  punti: number;
}

export interface XpEsito {
  crediti: XpCredito[];
  livello: XpLivello;
  /** This event's credits crossed a level (G1c's celebration). */
  nuovoLivello: boolean;
}

export type MissionState = 'fatta' | 'aperta' | 'vuota' | 'in-arrivo';

export interface MissioneLetta {
  id: MissionId;
  gruppo: XpPeriodKind;
  principale: boolean;
  punti: number;
  stato: MissionState;
  progresso?: { fatte: number; di: number };
  motivo?: 'quota';
  materia?: LingoMateria;
}

interface Evaluation {
  fulfilled: boolean;
  /** Nothing to do in this period. */
  vuota: boolean;
  progresso?: { fatte: number; di: number };
  motivo?: 'quota';
  materia?: LingoMateria;
}

interface SubjectStat {
  materia: LingoMateria;
  /** The Rome day of the last recorded review before today, or null when never reviewed before today. */
  ultimo: string | null;
  oggi: number;
}

/** A value computed on first use: a mission not evaluated reads nothing. */
function lazy<T>(compute: () => Promise<T>): () => Promise<T> {
  let value: Promise<T> | null = null;
  return () => (value ??= compute());
}

/** The stored facts the missions read, for one user and one Rome day. */
function factsFor(db: Prisma.TransactionClient, userId: string, today: string) {
  const prefs = lazy(() => readPreferences(db, userId));
  const scope = lazy(async () => reviewScope(userId, (await prefs()).materieComunita));
  const day = lazy(async () => {
    const row = await db.lingoGiornataStudio.findUnique({ where: { utenteId_giorno: { utenteId: userId, giorno: dayToDate(today) } } });
    return { ripassi: row?.ripassi ?? 0, nuove: row?.nuove ?? 0, valido: row?.valido ?? false, voti: row?.voti ?? 0 };
  });
  const due = lazy(async () => db.lingoStatoRipasso.count({ where: dueWhere(userId, await scope(), today) }));
  /** New cards left in the review scope, whatever the daily quota. */
  const newLeft = lazy(async () => db.lingoCard.count({ where: newCardsWhere(userId, await scope()) }));
  const streak = lazy(async () => computeStreak(await countedDays(db, userId), today, (await day()).valido).attuale);
  const consolidated = lazy(async () => {
    const states = await db.lingoStatoRipasso.findMany({ where: { utenteId: userId, card: await scope() }, select: { dueAt: true, lastReviewAt: true } });
    return states.filter((s) => maturity(s.lastReviewAt, s.dueAt) === 'consolidate').length;
  });
  /** Per subject: the Rome day of the last recorded review before today, and today's recorded reviews. */
  const subjects = lazy(async (): Promise<SubjectStat[]> => {
    const rows = await db.$queryRaw<{ materia: LingoMateria; ultimo: string | null; oggi: number }[]>`
      SELECT c.materia::text AS materia,
             to_char(((MAX(r.data_revisione) FILTER (WHERE r.data_revisione < ${romeDayStartSql(today)}) AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Rome')::date, 'YYYY-MM-DD') AS ultimo,
             (COUNT(*) FILTER (WHERE r.data_revisione >= ${romeDayStartSql(today)}))::int AS oggi
      FROM lingo_revisioni_srs r JOIN lingo_cards c ON c.id = r.card_id
      WHERE r.utente_id = ${userId}
      GROUP BY c.materia`;
    return rows;
  });
  const votable = lazy(async () => (await db.lingoCard.findFirst({ where: votableWhere(userId), select: { id: true } })) !== null);
  return { prefs, scope, day, due, newLeft, streak, consolidated, subjects, votable };
}

type Facts = ReturnType<typeof factsFor>;

/** A subject qualifies for «materia-ferma» when its last review before today fell on today − 7 or earlier. */
function qualifies(stat: SubjectStat, today: string): boolean {
  return stat.ultimo !== null && stat.ultimo <= addDays(today, -STALE_SUBJECT_DAYS);
}

const progress = (fatte: number, di: number) => ({ fatte: Math.min(fatte, di), di });

async function evaluate(id: MissionId, facts: Facts, today: string, event: XpEvent, userId: string, db: Prisma.TransactionClient): Promise<Evaluation> {
  switch (id) {
    case 'dovute': {
      const { ripassi, nuove } = await facts.day();
      const fatte = ripassi - nuove;
      const due = await facts.due();
      const vuota = fatte === 0 && due === 0;
      return { fulfilled: fatte >= 1 && due === 0, vuota, ...(vuota ? {} : { progresso: progress(fatte, fatte + due) }) };
    }
    case 'nuove': {
      const imparate = (await facts.day()).nuove;
      const target = Math.min(NEW_CARDS_TARGET, imparate + (await facts.newLeft()));
      if (target === 0) return { fulfilled: false, vuota: true };
      const fulfilled = imparate >= target;
      // The daily quota is not lowered for XP (L-27 choice 5): say when it is what stops the mission.
      const quotaLeft = (await facts.prefs()).nuoveAlGiorno - imparate;
      const motivo = !fulfilled && quotaLeft < target - imparate ? { motivo: 'quota' as const } : {};
      return { fulfilled, vuota: false, progresso: progress(imparate, target), ...motivo };
    }
    case 'obiettivo': {
      const { ripassi, valido } = await facts.day();
      const target = Math.max((await facts.prefs()).ripassiAlGiorno, XP_GOAL_FLOOR);
      const nothingLeft = (await facts.due()) === 0 && (await facts.newLeft()) === 0;
      if (ripassi === 0 && nothingLeft) return { fulfilled: false, vuota: true };
      // Fewer cards than the floor: the day counts, holds a review, and nothing is left in the scope.
      const fulfilled = valido && (ripassi >= target || (ripassi >= 1 && nothingLeft));
      return { fulfilled, vuota: false, progresso: progress(ripassi, target) };
    }
    case 'materia-ferma':
      return evaluateStaleSubject(facts, today, event, userId, db);
    case 'scrivi':
      return { fulfilled: event.tipo === 'proposta', vuota: false };
    case 'convalida': {
      const { voti } = await facts.day();
      const vuota = voti < VOTES_TARGET && !(await facts.votable());
      return { fulfilled: voti >= VOTES_TARGET, vuota, progresso: progress(voti, VOTES_TARGET) };
    }
    case 'settimana': {
      const { valido } = await facts.day();
      const attuale = await facts.streak();
      const fulfilled = valido && attuale > 0 && attuale % STREAK_WEEK === 0;
      return { fulfilled, vuota: false, progresso: fulfilled ? progress(STREAK_WEEK, STREAK_WEEK) : progress(attuale % STREAK_WEEK, STREAK_WEEK) };
    }
    case 'consolida': {
      const n = await facts.consolidated();
      return { fulfilled: n >= CONSOLIDATED_TARGET, vuota: false, progresso: progress(n, CONSOLIDATED_TARGET) };
    }
    case 'caso':
      return { fulfilled: false, vuota: false };
  }
}

/**
 * «materia-ferma» (spec §5.1). On a grade, only the graded card's subject, once it has 5 reviews today. On a read,
 * the subject shown is the qualifying one with the most reviews today; failing that, the qualifying one with the
 * oldest last review among those where today's reviews, the cards due today and the new cards left today (with
 * the quota) reach 5; «vuota» when none.
 */
async function evaluateStaleSubject(facts: Facts, today: string, event: XpEvent, userId: string, db: Prisma.TransactionClient): Promise<Evaluation> {
  const stats = (await facts.subjects()).filter((s) => qualifies(s, today));
  if (event.tipo === 'revisione') {
    const stat = stats.find((s) => s.materia === event.materia);
    if (!stat || stat.oggi < STALE_SUBJECT_REVIEWS) return { fulfilled: false, vuota: false };
    return { fulfilled: true, vuota: false, materia: stat.materia, progresso: progress(stat.oggi, STALE_SUBJECT_REVIEWS) };
  }
  let chosen: SubjectStat | undefined;
  for (const stat of stats) if (stat.oggi > 0 && (!chosen || stat.oggi > chosen.oggi)) chosen = stat;
  if (!chosen) {
    const { nuoveAlGiorno, materieComunita } = await facts.prefs();
    const newSlots = Math.max(0, nuoveAlGiorno - (await introducedToday(db, userId, today)));
    const reachable: SubjectStat[] = [];
    for (const stat of stats) {
      const scope = reviewScope(userId, materieComunita, stat.materia);
      const [due, fresh] = await Promise.all([
        db.lingoStatoRipasso.count({ where: dueWhere(userId, scope, today) }),
        db.lingoCard.count({ where: newCardsWhere(userId, scope) }),
      ]);
      if (stat.oggi + due + Math.min(fresh, newSlots) >= STALE_SUBJECT_REVIEWS) reachable.push(stat);
    }
    for (const stat of reachable) if (!chosen || stat.ultimo! < chosen.ultimo!) chosen = stat;
  }
  if (!chosen) return { fulfilled: false, vuota: true };
  return { fulfilled: chosen.oggi >= STALE_SUBJECT_REVIEWS, vuota: false, materia: chosen.materia, progresso: progress(chosen.oggi, STALE_SUBJECT_REVIEWS) };
}

/** The missions this event evaluates, the subject- and interval-bound ones narrowed as spec §5.1 says. */
async function evaluatedBy(event: XpEvent, db: Prisma.TransactionClient, userId: string): Promise<MissionDef[]> {
  const isValidator = event.tipo === 'lettura' ? await validator(db, userId) : true;
  return MISSIONS.filter((m) => {
    if (m.missione === null || !m.eventi.includes(event.tipo)) return false;
    if (m.id === 'consolida' && event.tipo === 'revisione') return event.intervallo >= CONSOLIDATED_DAYS;
    if (m.id === 'convalida' && event.tipo === 'lettura') return isValidator;
    return true;
  });
}

async function validator(db: Prisma.TransactionClient, userId: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { lingoValidatore: true } });
  return user?.lingoValidatore ?? false;
}

function fonteIdOf(event: XpEvent): string | null {
  if (event.tipo === 'revisione') return event.logId;
  if (event.tipo === 'proposta') return event.cardId;
  if (event.tipo === 'voto') return event.votoId;
  return null;
}

/**
 * Credits every mission this event completes, inside the caller's transaction (spec §5.1 «What it does»). Under a
 * savepoint and a lock timeout of its own: an error or a long wait rolls back to the savepoint, is logged, and
 * answers no credit, so XP never fails a grade, a proposal or a vote. A mission missed so is caught up by the
 * next read, except «scrivi».
 *
 * Lock order (spec §5.1): the caller has taken its card rows and today's day row; this takes the user's XP lock
 * last. Two settles of one user take turns, and under READ COMMITTED each counts what the other committed.
 */
export async function settleMissions(tx: Prisma.TransactionClient, userId: string, today: string, event: XpEvent): Promise<XpEsito> {
  await tx.$executeRawUnsafe('SAVEPOINT xp');
  try {
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '1s'`);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LINGO_XP_LOCK_CLASS}::int, hashtext(${userId}::text))`;
    const before = await levelNow(tx, userId, today);
    const credited = await creditedNow(tx, userId, today);
    const facts = factsFor(tx, userId, today);
    const crediti: XpCredito[] = [];
    let dayTotal = before.oggi;
    for (const mission of await evaluatedBy(event, tx, userId)) {
      if (credited.has(mission.missione!)) continue;
      const result = await evaluate(mission.id, facts, today, event, userId, tx);
      if (!result.fulfilled) continue;
      if (dayTotal + mission.punti > XP_DAILY_CEILING) {
        console.warn(`[xp] daily ceiling reached: «${mission.id}» not credited`);
        continue;
      }
      const materia = mission.id === 'scrivi' && event.tipo === 'proposta' ? event.materia : (result.materia ?? null);
      const written = await insertCredit(tx, {
        userId, missione: mission.missione!, periodo: periodOf(mission.gruppo, today), today,
        punti: mission.punti, fonte: FONTE[event.tipo], fonteId: fonteIdOf(event), materia,
      });
      if (!written) continue;
      crediti.push({ missione: mission.id, punti: mission.punti });
      dayTotal += mission.punti;
    }
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT xp');
    await tx.$executeRawUnsafe('SET LOCAL lock_timeout TO DEFAULT');
    const total = before.totale + crediti.reduce((sum, c) => sum + c.punti, 0);
    const livello = { ...levelOf(total), totale: total, oggi: dayTotal };
    return { crediti, livello, nuovoLivello: livello.livello > before.livello };
  } catch (error) {
    // Also undoes the SET LOCAL. The error's text may carry the statement's values: only its name is logged.
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT xp');
    console.error(`[xp] settle after «${event.tipo}» failed:`, error instanceof Error ? error.name : 'unknown error');
    return { crediti: [], livello: await levelNow(tx, userId, today), nuovoLivello: false };
  }
}

/**
 * The missions as the progress read answers them (spec §5.3), from what is stored: the catalogue in order,
 * «convalida» only for a validator, «caso» announced. A mission is «fatta» if and only if its credit exists.
 */
export async function readMissions(db: Prisma.TransactionClient, userId: string, today: string): Promise<MissioneLetta[]> {
  const [credited, isValidator] = await Promise.all([creditedNow(db, userId, today), validator(db, userId)]);
  const facts = factsFor(db, userId, today);
  const read: MissioneLetta[] = [];
  for (const mission of MISSIONS) {
    if (mission.id === 'convalida' && !isValidator) continue;
    const base = { id: mission.id, gruppo: mission.gruppo, principale: mission.principale, punti: mission.punti };
    if (mission.missione === null) {
      read.push({ ...base, stato: 'in-arrivo' });
      continue;
    }
    const credit = credited.get(mission.missione);
    const result = await evaluate(mission.id, facts, today, { tipo: 'lettura' }, userId, db);
    if (credit) {
      const materia = credit.materia ?? result.materia;
      read.push({
        ...base,
        stato: 'fatta',
        ...(mission.id === 'materia-ferma' ? { progresso: progress(STALE_SUBJECT_REVIEWS, STALE_SUBJECT_REVIEWS) } : result.progresso ? { progresso: progress(result.progresso.di, result.progresso.di) } : {}),
        ...(mission.id === 'materia-ferma' && materia ? { materia } : {}),
      });
      continue;
    }
    read.push({
      ...base,
      stato: result.vuota ? 'vuota' : 'aperta',
      ...(result.progresso ? { progresso: result.progresso } : {}),
      ...(result.motivo ? { motivo: result.motivo } : {}),
      ...(result.materia ? { materia: result.materia } : {}),
    });
  }
  return read;
}
