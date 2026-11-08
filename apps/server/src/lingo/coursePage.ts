import type { LingoMateria, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { LIMITS } from '../schemas/lingo/corso';
import { checkCardRank, wantsCheckCards } from './courseMastery';
import { evaluatePassed, masteryFor, serializeMastery, type CourseMastery } from './courseProgress';
import { countingModules, courseState, EXAM_PAUSE_DAYS, NOT_FOUND } from './courses';
import { EXAM_PASS, examIsOpen } from './courseStudy';
import { COURSE_MISSION, MODULE_MISSION, settleMissions, type XpCredito } from './missions';
import { REVIEWABLE_OWN_STATES, reviewScope } from './reviewQueue';
import { addDays, startOfRomeDay } from './studyDay';
import { dateToDay, dayToDate } from './studyDays';
import { readPreferences } from './studyPreferences';
import { dueWhere, newCardsWhere } from './todayQueue';

/**
 * The course's reads for the user's session (Percorsi, A1; spec 2026-10-23 §6, §10.5, §10.7): the course page
 * (`GET /:id`), «Oggi»'s row (`GET /oggi`), and the course's review — its cards in scope and its check cards.
 */

type Db = Prisma.TransactionClient;

/** The user's review scope narrowed to one course's cards (§10.5: `GET /srs/sessione?corso=`). */
export function courseScope(userId: string, materieComunita: LingoMateria[], today: string, corsoId: string): Prisma.LingoCardWhereInput {
  return { AND: [reviewScope(userId, materieComunita, today), { modulo: { corsoId } }] };
}

/**
 * The check cards of a course for today (§10.7, G-377 Q10): for each competence that wants them (`wantsCheckCards`,
 * «da riprendere» first), the course's cards tagged with it that the user has already reviewed, due or not, never
 * one graded today, until five answers on it can be made today. The due cards already in the session count toward
 * the five. Never a new card. A competence whose reviewed cards cannot reach five answers today gets none: they
 * could not make a session, and offering them every day would drill the same cards. Returns their ids, in order.
 */
export async function checkCardIds(db: Db, userId: string, scope: Prisma.LingoCardWhereInput, mastery: CourseMastery, dueCardIds: readonly string[], today: string): Promise<string[]> {
  const wanting = mastery.competenze
    .map((c) => ({ c, m: mastery.padronanza.get(c.id)! }))
    .map(({ c, m }) => ({ c, m, need: wantsCheckCards(m, today) }))
    .filter(({ need }) => need > 0)
    .sort((a, b) => checkCardRank(a.m.stato) - checkCardRank(b.m.stato) || a.c.ordine - b.c.ordine);
  if (wanting.length === 0) return [];
  const startOfToday = startOfRomeDay(today);
  const cards = await db.lingoCard.findMany({
    where: {
      AND: [
        scope,
        { competenze: { some: { competenzaId: { in: wanting.map((w) => w.c.id) } } } },
        { statiRipasso: { some: { utenteId: userId } } },
      ],
    },
    select: { id: true, competenze: { select: { competenzaId: true } }, statiRipasso: { where: { utenteId: userId }, select: { dueAt: true, lastReviewAt: true } } },
  });
  const covered = new Map<string, number>();
  const cover = (card: (typeof cards)[number]) => {
    for (const { competenzaId } of card.competenze) covered.set(competenzaId, (covered.get(competenzaId) ?? 0) + 1);
  };
  const due = new Set(dueCardIds);
  for (const card of cards) if (due.has(card.id)) cover(card);
  // The closest to due first: an early grade moves its interval least.
  const candidates = cards
    .filter((card) => !due.has(card.id) && card.statiRipasso[0] && card.statiRipasso[0].lastReviewAt < startOfToday)
    .sort((a, b) => a.statiRipasso[0].dueAt.getTime() - b.statiRipasso[0].dueAt.getTime() || (a.id < b.id ? -1 : 1));
  const chosen: string[] = [];
  const taken = new Set<string>();
  for (const { c, need } of wanting) {
    const reachable = (covered.get(c.id) ?? 0) + candidates.filter((card) => !taken.has(card.id) && card.competenze.some((x) => x.competenzaId === c.id)).length;
    if (reachable < need) continue;
    for (const card of candidates) {
      if ((covered.get(c.id) ?? 0) >= need) break;
      if (taken.has(card.id) || !card.competenze.some((x) => x.competenzaId === c.id)) continue;
      taken.add(card.id);
      chosen.push(card.id);
      cover(card);
    }
  }
  return chosen;
}

/** A course's cards for the page and «Oggi»: due, new (never reviewed, in scope), waiting for their module, and today's check cards. */
async function courseCards(userId: string, corsoId: string, mastery: CourseMastery, today: string) {
  const { materieComunita } = await readPreferences(prisma, userId);
  const scope = courseScope(userId, materieComunita, today, corsoId);
  const dueStates = await prisma.lingoStatoRipasso.findMany({ where: dueWhere(userId, scope, today), select: { cardId: true } });
  const [nuove, inAttesa, verifica] = await Promise.all([
    prisma.lingoCard.count({ where: newCardsWhere(userId, scope) }),
    prisma.lingoCard.count({
      where: {
        autoreId: userId,
        stato: { in: REVIEWABLE_OWN_STATES },
        modulo: { corsoId, NOT: { stati: { some: { iscrizione: { utenteId: userId }, OR: [{ fattoGiorno: { lt: dayToDate(today) } }, { ritiratoIl: { not: null } }] } } } },
      },
    }),
    checkCardIds(prisma, userId, scope, mastery, dueStates.map((s) => s.cardId), today),
  ]);
  return { dovute: dueStates.length, nuove, inAttesa, verifica: verifica.length };
}

type ExamState = 'assente' | 'bloccato' | 'aperto' | 'in-corso' | 'non-superato' | 'superato';

// ─── The course page ────────────────────────────────────────────────────────────────────────────────────────

/**
 * `GET /:id` (§6, point 4; §10.5): the competences with their state and numbers, the modules with their state and
 * «creato da», what «in preparazione» lacks, the exam's state, the dossier, the course's cards. It also settles what
 * a rolled-back savepoint or the daily net left behind (§10.8) and checks «superato», in a transaction that takes the
 * study write's locks, only when there may be something to settle.
 */
export async function readCoursePage(userId: string, corsoId: string, today: string) {
  const corso = await prisma.lingoCorso.findFirst({
    where: { id: corsoId, autoreId: userId },
    include: {
      moduli: {
        orderBy: [{ ordine: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, ordine: true, titolo: true, minuti: true, sostituisceId: true, createdByClientId: true, createdByClientName: true, createdAt: true, competenze: { select: { competenzaId: true } } },
      },
      esami: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, iscrizioneId: true, createdAt: true } },
    },
  });
  if (!corso) throw new AppError(404, NOT_FOUND);
  const enrolment = await prisma.lingoCorsoIscrizione.findFirst({
    where: { corsoId, utenteId: userId },
    include: { dossier: { select: { id: true, name: true } }, stati: true, tentativi: { orderBy: [{ apertoIl: 'asc' }, { id: 'asc' }] } },
  });
  if (!enrolment) throw new AppError(404, NOT_FOUND);

  // Settling first, so the page shows what it credits.
  let superatoIl = enrolment.superatoIl;
  let crediti: XpCredito[] = [];
  const passedModules = enrolment.stati.filter((s) => s.fattoIl && (s.quizPercentuale ?? 0) >= MODULE_MISSION.percentuale).map((s) => s.id);
  const creditedModules = passedModules.length === 0 ? 0 : await prisma.lingoCreditoXp.count({ where: { missione: 'MODULO', fonteId: { in: passedModules } } });
  const passedExam = enrolment.tentativi.some((t) => t.superato);
  // A course under the mission's minimums never earns it: nothing to settle there.
  const earnsCourse = (await prisma.lingoCorsoCompetenza.count({ where: { corsoId } })) >= COURSE_MISSION.competenze
    && countingModules(corso.moduli, new Set(enrolment.stati.filter((s) => s.ritiratoIl).map((s) => s.moduloId))).length >= COURSE_MISSION.moduli;
  const courseCredited = superatoIl && earnsCourse ? (await prisma.lingoCreditoXp.count({ where: { missione: 'PERCORSO', fonteId: enrolment.id } })) > 0 : true;
  if (creditedModules < passedModules.length || (passedExam && !superatoIl) || !courseCredited) {
    const settled = await prisma.$transaction(async (tx) => {
      const course = await tx.$queryRaw<unknown[]>`SELECT 1 FROM lingo_corsi WHERE id = ${corsoId} AND autore_id = ${userId} FOR KEY SHARE`;
      if (course.length === 0) return null;
      await tx.$queryRaw`SELECT 1 FROM users WHERE id = ${userId} FOR KEY SHARE`;
      await tx.$queryRaw`SELECT 1 FROM lingo_corsi_iscrizioni WHERE id = ${enrolment.id} FOR NO KEY UPDATE`;
      await evaluatePassed(tx, userId, enrolment, today);
      const xp = await settleMissions(tx, userId, today, { tipo: 'corso', iscrizioneId: enrolment.id });
      const row = await tx.lingoCorsoIscrizione.findUnique({ where: { id: enrolment.id }, select: { superatoIl: true } });
      return { crediti: xp.crediti, superatoIl: row?.superatoIl ?? null };
    });
    if (!settled) throw new AppError(404, NOT_FOUND);
    ({ crediti, superatoIl } = settled);
  }

  const mastery = (await masteryFor(prisma, userId, [enrolment], today)).get(corsoId)!;
  const codeOf = new Map(mastery.competenze.map((c) => [c.id, c.codice]));
  const stateOf = new Map(enrolment.stati.map((s) => [s.moduloId, s]));
  const withdrawn = new Set(enrolment.stati.filter((s) => s.ritiratoIl).map((s) => s.moduloId));
  const counting = countingModules(corso.moduli, withdrawn);
  const countingIds = new Set(counting.map((m) => m.id));
  const esami = corso.esami.filter((e) => e.iscrizioneId === null || e.iscrizioneId === enrolment.id);
  const hasFirstExam = esami.some((e) => e.iscrizioneId === null);
  const stato = courseState({ moduliPrevisti: corso.moduliPrevisti, counting: counting.length, hasFirstExam, superatoIl });

  const moduli = corso.moduli.map((m) => {
    const s = stateOf.get(m.id);
    const liveCorrections = corso.moduli.filter((x) => x.sostituisceId === m.id && !withdrawn.has(x.id)).map((x) => x.id);
    return {
      id: m.id,
      ordine: m.ordine,
      titolo: m.titolo,
      minuti: m.minuti,
      competenze: m.competenze.map((c) => codeOf.get(c.competenzaId)).filter(Boolean),
      stato: s?.ritiratoIl ? 'ritirato' : s?.fattoGiorno ? 'fatto' : s ? 'in-corso' : 'da-iniziare',
      fattoGiorno: s?.fattoGiorno ? dateToDay(s.fattoGiorno) : null,
      quizPercentuale: s?.quizPercentuale ?? null,
      conta: countingIds.has(m.id),
      sostituisceId: m.sostituisceId,
      sostituitoDa: liveCorrections,
      eliminabile: !s,
      ritirabile: Boolean(s && !s.ritiratoIl && liveCorrections.length > 0),
      creatoDa: m.createdByClientName === null && m.createdByClientId === null ? null : { clientName: m.createdByClientName },
      createdAt: m.createdAt,
    };
  });

  // What «in preparazione» lacks (§6, point 4), with the counts the sentence to the assistant needs.
  const served = new Set(counting.flatMap((m) => m.competenze.map((c) => c.competenzaId)));
  const liveModuleIds = corso.moduli.filter((m) => !withdrawn.has(m.id)).map((m) => m.id);
  const cardCounts = await prisma.lingoCardCompetenza.groupBy({
    by: ['competenzaId'],
    where: { competenzaId: { in: mastery.competenze.map((c) => c.id) }, card: { moduloId: { in: liveModuleIds } } },
    _count: { _all: true },
  });
  const cardsOf = new Map(cardCounts.map((r) => [r.competenzaId, r._count._all]));
  const inPreparazione = stato === 'in-preparazione'
    ? {
        moduli: { contati: counting.length, previsti: corso.moduliPrevisti },
        manca: { esame: !hasFirstExam },
        competenzeSenzaModulo: mastery.competenze.filter((c) => !served.has(c.id)).map((c) => c.codice),
        schede: mastery.competenze
          .filter((c) => (cardsOf.get(c.id) ?? 0) < LIMITS.cardsPerCompetence)
          .map((c) => ({ codice: c.codice, schede: cardsOf.get(c.id) ?? 0, servono: LIMITS.cardsPerCompetence })),
      }
    : null;

  return {
    id: corso.id,
    titolo: corso.titolo,
    materia: corso.materia,
    descrizione: corso.descrizione,
    stato,
    superatoIl: superatoIl && dateToDay(superatoIl),
    moduliPrevisti: corso.moduliPrevisti,
    competenze: mastery.competenze.map((c) => serializeMastery(c, mastery.padronanza.get(c.id)!)),
    moduli,
    inPreparazione,
    esame: await examState(corsoId, enrolment.id, esami, enrolment.tentativi, mastery, today),
    dossier: enrolment.dossier,
    schede: await courseCards(userId, corsoId, mastery, today),
    creatoDa: corso.createdByClientName === null && corso.createdByClientId === null ? null : { clientName: corso.createdByClientName },
    createdAt: corso.createdAt,
    xp: { crediti },
  };
}

/** The final exam's state on the course page (§6, point 4): locked, open, under way, not passed, passed. */
async function examState(
  corsoId: string,
  iscrizioneId: string,
  esami: { id: string; createdAt: Date }[],
  tentativi: Prisma.LingoCorsoTentativoGetPayload<object>[],
  mastery: CourseMastery,
  today: string,
) {
  const passed = tentativi.find((t) => t.superato);
  const latest = esami.at(-1);
  const attemptOf = new Map(tentativi.map((t) => [t.esameId, t]));
  const summary = (t: (typeof tentativi)[number] | undefined) =>
    t ? { id: t.id, consegnatoIl: t.consegnatoIl, giorno: t.giorno && dateToDay(t.giorno), percentuale: t.percentuale, superato: t.superato, perCompetenza: t.perCompetenza } : null;
  let stato: ExamState;
  let esameId: string | null = latest?.id ?? null;
  let tentativo = latest ? attemptOf.get(latest.id) : undefined;
  if (passed) {
    stato = 'superato';
    esameId = passed.esameId;
    tentativo = passed;
  } else if (!latest) stato = 'assente';
  else if (tentativo?.consegnatoIl) stato = 'non-superato';
  else if (tentativo) stato = 'in-corso';
  else stato = (await examIsOpen(prisma, corsoId, iscrizioneId)) ? 'aperto' : 'bloccato';
  const failed = stato === 'non-superato' && tentativo?.giorno ? dateToDay(tentativo.giorno) : null;
  const nuovoEsameDal = failed ? addDays(failed, EXAM_PAUSE_DAYS) : null;
  const perCompetenza = (tentativo?.perCompetenza ?? {}) as Record<string, number>;
  return {
    stato,
    esameId,
    tentativo: summary(tentativo),
    nuovoEsameDal,
    // From the third Rome day after a failed attempt: «Chiedi al tuo assistente un nuovo esame» (§4).
    chiediNuovoEsame: nuovoEsameDal !== null && today >= nuovoEsameDal,
    competenzeSotto: failed ? mastery.competenze.filter((c) => (perCompetenza[c.codice] ?? 100) < EXAM_PASS.perCompetence).map((c) => c.codice) : [],
  };
}

// ─── «Oggi» ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `GET /oggi` (§6, point 2; §10.5): per course with something to do, the module to suggest — the first counting
 * module not done, from the Rome day after the last one done (none on a day a module was done) — and the course's
 * due and check cards, which the web offers first. A read only: nothing is settled or written.
 */
export async function readToday(userId: string, today: string) {
  const courses = await prisma.lingoCorso.findMany({
    where: { autoreId: userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true, titolo: true, materia: true,
      moduli: { select: { id: true, ordine: true, titolo: true, sostituisceId: true }, orderBy: [{ ordine: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] },
    },
  });
  const enrolments = await prisma.lingoCorsoIscrizione.findMany({
    where: { utenteId: userId, corsoId: { in: courses.map((c) => c.id) } },
    select: { id: true, corsoId: true, stati: { select: { moduloId: true, fattoGiorno: true, ritiratoIl: true } } },
  });
  const byCourse = new Map(enrolments.map((e) => [e.corsoId, e]));
  const mastery = await masteryFor(prisma, userId, enrolments, today);
  const { materieComunita } = await readPreferences(prisma, userId);
  const out = [];
  for (const corso of courses) {
    const enrolment = byCourse.get(corso.id);
    const m = mastery.get(corso.id);
    if (!enrolment || !m) continue;
    const withdrawn = new Set(enrolment.stati.filter((s) => s.ritiratoIl).map((s) => s.moduloId));
    const done = new Set(enrolment.stati.filter((s) => s.fattoGiorno).map((s) => s.moduloId));
    const doneToday = enrolment.stati.some((s) => s.fattoGiorno && dateToDay(s.fattoGiorno) === today);
    const next = doneToday ? undefined : countingModules(corso.moduli, withdrawn).find((x) => !done.has(x.id));
    const scope = courseScope(userId, materieComunita, today, corso.id);
    const dueStates = await prisma.lingoStatoRipasso.findMany({ where: dueWhere(userId, scope, today), select: { cardId: true } });
    const verifica = await checkCardIds(prisma, userId, scope, m, dueStates.map((s) => s.cardId), today);
    if (!next && dueStates.length === 0 && verifica.length === 0) continue;
    out.push({
      corso: { id: corso.id, titolo: corso.titolo, materia: corso.materia },
      modulo: next ? { id: next.id, ordine: next.ordine, titolo: next.titolo } : null,
      schede: { dovute: dueStates.length, verifica: verifica.length },
    });
  }
  return out;
}
