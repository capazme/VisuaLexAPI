import { Prisma, type LingoCorsoTipoDomanda } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { countingModules, EXAM_PAUSE_DAYS, ITEM_SELECT, NOT_FOUND, serializeItem, type ItemForRead, type StoredOption } from './courses';
import { evaluatePassed } from './courseProgress';
import { settleMissions, type XpEsito } from './missions';
import { addDays } from './studyDay';
import { dateToDay, dayToDate } from './studyDays';

/**
 * Studying a course (Percorsi, A1; spec 2026-10-23 §5, §10.4, §10.5), the second server pull request (S2): open a
 * module, answer its items, the open question, the end, a flag, a withdrawal; start and hand in the final exam; and
 * the reads a session resumes from. The user's session only (none of these is in the delegated table).
 *
 * The server grades: the web sends a choice, never «right» or «wrong», and no read carries an item's key, its
 * explanations, a model answer or a rubric before the item is answered (an exam's, before it is handed in). One
 * outcome per item and person: a retry answers the stored one with `registrata: false`. A flag changes no score
 * (G-377 Q7) and the rubric's ticks are never scored (Q6). The day is the server's Rome day.
 */

type Tx = Prisma.TransactionClient;

const MODULE_NOT_FOUND = 'Modulo non trovato.';
const ITEM_NOT_FOUND = 'Domanda non trovata.';
const EXAM_NOT_FOUND = 'Esame non trovato.';
/** The quiz share at which the open question is written from memory; below it, the hybrid's choice (§5, step 6). */
export const OPEN_QUESTION_PERCENT = 70;
/** The final exam: 70% overall and 60% on every competence, no compensation (§4). */
export const EXAM_PASS = { overall: 70, perCompetence: 60 } as const;

const floorPercent = (right: number, total: number) => (total === 0 ? 0 : Math.floor((right * 100) / total));

interface Enrolment {
  id: string;
  corsoId: string;
}

/**
 * The locks of a study write, in this order: the caller's course `FOR KEY SHARE` (a course or module trash, which
 * takes the course `FOR UPDATE` first, waits for the write or the write finds it gone: 404, never a foreign-key
 * 500), the user's row `FOR KEY SHARE` (the XP credit's insert points at it; an account's deletion locks the courses
 * before it deletes the user, so this order is its own), then the enrolment `FOR NO KEY UPDATE`, which serialises
 * one person's writes on a course (one outcome per item, one hand-in, «superato» once). The XP lock comes last, in
 * `settleMissions`.
 */
async function lockStudy(tx: Tx, userId: string, corsoId: string): Promise<Enrolment> {
  const course = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM lingo_corsi WHERE id = ${corsoId} AND autore_id = ${userId} FOR KEY SHARE`;
  if (course.length === 0) throw new AppError(404, NOT_FOUND);
  await tx.$queryRaw`SELECT 1 FROM users WHERE id = ${userId} FOR KEY SHARE`;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM lingo_corsi_iscrizioni WHERE corso_id = ${corsoId} AND utente_id = ${userId} FOR NO KEY UPDATE`;
  if (rows.length === 0) throw new AppError(404, NOT_FOUND);
  return { id: rows[0].id, corsoId };
}

/** The caller's enrolment, for a read (no lock). */
async function enrolmentFor(userId: string, corsoId: string): Promise<Enrolment> {
  const enrolment = await prisma.lingoCorsoIscrizione.findFirst({
    where: { corsoId, utenteId: userId, corso: { autoreId: userId } },
    select: { id: true, corsoId: true },
  });
  if (!enrolment) throw new AppError(404, NOT_FOUND);
  return enrolment;
}

async function moduleOf(db: Tx, corsoId: string, moduloId: string) {
  const modulo = await db.lingoCorsoModulo.findFirst({ where: { id: moduloId, corsoId } });
  if (!modulo) throw new AppError(404, MODULE_NOT_FOUND);
  return modulo;
}

async function codesOf(db: Tx, corsoId: string): Promise<Map<string, string>> {
  const rows = await db.lingoCorsoCompetenza.findMany({ where: { corsoId }, select: { id: true, codice: true } });
  return new Map(rows.map((c) => [c.id, c.codice]));
}

type OutcomeRow = Prisma.LingoCorsoEsitoGetPayload<object>;

/** The quiz of a module as the enrolment answered it: the open question waits for it, the end needs it whole. */
function quizOf(items: ItemForRead[], outcomes: Map<string, OutcomeRow>) {
  const quiz = items.filter((i) => i.tipo === 'QUIZ');
  const answered = quiz.filter((i) => outcomes.has(i.id));
  const giuste = answered.filter((i) => outcomes.get(i.id)!.corretto === true).length;
  return { totale: quiz.length, risposte: answered.length, giuste, completo: answered.length === quiz.length, percentuale: floorPercent(giuste, quiz.length) };
}

/**
 * Whether the model answer and the rubric may be shown (§10.4): once every quiz item has an outcome and, under 70%,
 * once the hybrid's choice is graded too — the model answer would otherwise give the hybrid's key away.
 */
function openQuestionReady(items: ItemForRead[], outcomes: Map<string, OutcomeRow>): { ready: true } | { ready: false; why: string } {
  const quiz = quizOf(items, outcomes);
  if (!quiz.completo) return { ready: false, why: 'Rispondi prima a tutte le domande del quiz.' };
  const open = items.find((i) => i.tipo === 'APERTA');
  if (open && quiz.percentuale < OPEN_QUESTION_PERCENT && !outcomes.get(open.id)?.scelta) {
    return { ready: false, why: 'Scegli prima una delle opzioni della domanda aperta.' };
  }
  return { ready: true };
}

async function moduleItems(db: Tx, moduloId: string): Promise<ItemForRead[]> {
  return db.lingoCorsoDomanda.findMany({ where: { moduloId }, orderBy: { ordine: 'asc' }, select: ITEM_SELECT });
}

async function outcomesFor(db: Tx, iscrizioneId: string, domandaIds: string[]): Promise<Map<string, OutcomeRow>> {
  const rows = await db.lingoCorsoEsito.findMany({ where: { iscrizioneId, domandaId: { in: domandaIds } } });
  return new Map(rows.map((r) => [r.domandaId, r]));
}

/** An item with the caller's outcome: keys and explanations only once the choice was graded. */
function itemWithOutcome(item: ItemForRead, codeOf: Map<string, string>, outcome: OutcomeRow | undefined) {
  const graded = outcome?.scelta != null || outcome?.corretto != null;
  const base = serializeItem(item, codeOf, false);
  return {
    ...base,
    ...(graded ? { opzioni: item.opzioni as unknown as StoredOption[], corretta: item.corretta } : {}),
    esito: outcome
      ? { scelta: outcome.scelta, corretto: outcome.corretto, giorno: dateToDay(outcome.giorno), segnalata: outcome.segnalatoIl !== null }
      : null,
  };
}

/** The open question's model answer, rubric and ticks, or null while not yet ready. */
function openAnswer(items: ItemForRead[], outcomes: Map<string, OutcomeRow>) {
  const open = items.find((i) => i.tipo === 'APERTA');
  if (!open || !openQuestionReady(items, outcomes).ready) return null;
  return { domandaId: open.id, rispostaModello: open.rispostaModello, rubrica: open.rubrica as string[], spuntate: outcomes.get(open.id)?.spuntate ?? [] };
}

/** Opens the module for the enrolment if it was not: from now it is frozen (no trash, only a withdrawal). */
async function openState(tx: Tx, iscrizioneId: string, moduloId: string) {
  return tx.lingoCorsoModuloStato.upsert({
    where: { iscrizioneId_moduloId: { iscrizioneId, moduloId } },
    create: { iscrizioneId, moduloId },
    update: {},
  });
}

function serializeState(state: Prisma.LingoCorsoModuloStatoGetPayload<object> | null) {
  if (!state) return null;
  return {
    apertoIl: state.apertoIl,
    fattoIl: state.fattoIl,
    fattoGiorno: state.fattoGiorno && dateToDay(state.fattoGiorno),
    quizPercentuale: state.quizPercentuale,
    giudizio: state.giudizio,
    nota: state.giudizioNota,
    ritiratoIl: state.ritiratoIl,
  };
}

/** «Superato» checked, then the missions it or the event completes, inside the event's transaction. */
async function afterStudy(tx: Tx, userId: string, enrolment: Enrolment, today: string, tipo: 'modulo' | 'esame'): Promise<XpEsito> {
  await evaluatePassed(tx, userId, enrolment, today);
  return settleMissions(tx, userId, today, { tipo, iscrizioneId: enrolment.id });
}

// ─── The module ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `GET /:id/moduli/:moduloId`: the lesson and its items, the answered ones with their keys, explanations and the
 * caller's outcome, so a session resumes where it stopped. A module not yet opened is readable (§6, point 4).
 */
export async function readModule(userId: string, corsoId: string, moduloId: string) {
  const enrolment = await enrolmentFor(userId, corsoId);
  const modulo = await prisma.lingoCorsoModulo.findFirst({
    where: { id: moduloId, corsoId },
    include: { blocchi: { orderBy: { ordine: 'asc' } }, competenze: { select: { competenzaId: true } } },
  });
  if (!modulo) throw new AppError(404, MODULE_NOT_FOUND);
  const items = await moduleItems(prisma, moduloId);
  const codeOf = await codesOf(prisma, corsoId);
  const [outcomes, state, corrections] = await Promise.all([
    outcomesFor(prisma, enrolment.id, items.map((i) => i.id)),
    prisma.lingoCorsoModuloStato.findUnique({ where: { iscrizioneId_moduloId: { iscrizioneId: enrolment.id, moduloId } } }),
    prisma.lingoCorsoModulo.findMany({ where: { sostituisceId: moduloId }, select: { id: true } }),
  ]);
  const blockOrder = new Map(modulo.blocchi.map((b) => [b.id, b.ordine]));
  return {
    id: modulo.id,
    corsoId,
    ordine: modulo.ordine,
    titolo: modulo.titolo,
    minuti: modulo.minuti,
    competenze: modulo.competenze.map((c) => codeOf.get(c.competenzaId)).filter(Boolean),
    sostituisceId: modulo.sostituisceId,
    sostituitoDa: corrections.map((c) => c.id),
    creatoDa: modulo.createdByClientName === null && modulo.createdByClientId === null ? null : { clientName: modulo.createdByClientName },
    domandePrima: modulo.domandePrima,
    blocchi: modulo.blocchi.map((b) => ({ ordine: b.ordine, titolo: b.titolo, testo: b.testo, parole: b.parole, citazioni: b.citazioni })),
    domande: items.map((i) => ({ ...itemWithOutcome(i, codeOf, outcomes.get(i.id)), blocco: i.bloccoId ? (blockOrder.get(i.bloccoId) ?? null) : null })),
    quiz: (({ completo: _c, ...q }) => q)(quizOf(items, outcomes)),
    aperta: openAnswer(items, outcomes),
    stato: serializeState(state),
  };
}

/** `POST …/apri`: the module's state row; idempotent. */
export async function openModule(userId: string, corsoId: string, moduloId: string) {
  return prisma.$transaction(async (tx) => {
    const enrolment = await lockStudy(tx, userId, corsoId);
    await moduleOf(tx, corsoId, moduloId);
    return serializeState(await openState(tx, enrolment.id, moduloId));
  });
}

const MODULE_KINDS: readonly LingoCorsoTipoDomanda[] = ['RICHIAMO', 'QUIZ', 'APERTA'];

/**
 * `POST …/risposte { domandaId, scelta }` (§10.4): grades one item of the module. The first answer opens the module.
 * The open question's choice is the hybrid's, graded only under 70% on the quiz and once the quiz is whole.
 */
export async function answerModuleItem(userId: string, corsoId: string, moduloId: string, body: { domandaId: string; scelta: string }, today: string) {
  return prisma.$transaction(async (tx) => {
    const enrolment = await lockStudy(tx, userId, corsoId);
    await moduleOf(tx, corsoId, moduloId);
    const items = await moduleItems(tx, moduloId);
    const item = items.find((i) => i.id === body.domandaId && MODULE_KINDS.includes(i.tipo));
    if (!item) throw new AppError(404, ITEM_NOT_FOUND);
    const options = item.opzioni as unknown as StoredOption[];
    if (!options.some((o) => o.chiave === body.scelta)) throw new AppError(400, 'La scelta non è tra le opzioni della domanda.');
    const state = await openState(tx, enrolment.id, moduloId);
    if (state.ritiratoIl) throw new AppError(409, 'Hai ritirato questo modulo: le sue domande non si rispondono più.');
    const outcomes = await outcomesFor(tx, enrolment.id, items.map((i) => i.id));
    const stored = outcomes.get(item.id);
    const answer = (outcome: OutcomeRow, registrata: boolean, xp: XpEsito | null) => ({
      registrata,
      domandaId: item.id,
      scelta: outcome.scelta,
      corretto: outcome.corretto,
      corretta: item.corretta,
      opzioni: options,
      xp,
    });
    if (stored?.scelta) return answer(stored, false, null);
    if (item.tipo === 'APERTA') {
      const quiz = quizOf(items, outcomes);
      if (!quiz.completo) throw new AppError(409, 'Rispondi prima a tutte le domande del quiz.');
      if (quiz.percentuale >= OPEN_QUESTION_PERCENT) throw new AppError(409, 'Con il quiz al 70% la domanda aperta si scrive a memoria, senza opzioni.');
    }
    const corretto = body.scelta === item.corretta;
    const outcome = stored
      ? await tx.lingoCorsoEsito.update({ where: { id: stored.id }, data: { scelta: body.scelta, corretto } })
      : await tx.lingoCorsoEsito.create({ data: { iscrizioneId: enrolment.id, domandaId: item.id, scelta: body.scelta, corretto, giorno: dayToDate(today) } });
    return answer(outcome, true, await afterStudy(tx, userId, enrolment, today, 'modulo'));
  });
}

/** `GET …/aperta`: the model answer, the rubric and the ticks, once the quiz is answered (§10.4). */
export async function readOpenQuestion(userId: string, corsoId: string, moduloId: string) {
  const enrolment = await enrolmentFor(userId, corsoId);
  await moduleOf(prisma, corsoId, moduloId);
  const items = await moduleItems(prisma, moduloId);
  const outcomes = await outcomesFor(prisma, enrolment.id, items.map((i) => i.id));
  const ready = openQuestionReady(items, outcomes);
  if (!ready.ready) throw new AppError(409, ready.why);
  return openAnswer(items, outcomes)!;
}

/**
 * `POST …/aperta { spuntate }`: the rubric's ticks on the open question's row (created with no choice at 70% or
 * more), never touching its choice; sent again until the module's end, the last send standing. Never scored (Q6).
 */
export async function tickOpenQuestion(userId: string, corsoId: string, moduloId: string, spuntate: number[], today: string) {
  return prisma.$transaction(async (tx) => {
    const enrolment = await lockStudy(tx, userId, corsoId);
    await moduleOf(tx, corsoId, moduloId);
    const items = await moduleItems(tx, moduloId);
    const open = items.find((i) => i.tipo === 'APERTA');
    if (!open) throw new AppError(404, ITEM_NOT_FOUND);
    const state = await openState(tx, enrolment.id, moduloId);
    if (state.ritiratoIl) throw new AppError(409, 'Hai ritirato questo modulo.');
    if (state.fattoIl) throw new AppError(409, 'Il modulo è finito: la griglia non si cambia più.');
    const outcomes = await outcomesFor(tx, enrolment.id, items.map((i) => i.id));
    const ready = openQuestionReady(items, outcomes);
    if (!ready.ready) throw new AppError(409, ready.why);
    const rubric = open.rubrica as string[];
    if (spuntate.some((i) => i >= rubric.length)) throw new AppError(400, `La griglia ha ${rubric.length} criteri.`);
    const sorted = [...spuntate].sort((a, b) => a - b);
    const stored = outcomes.get(open.id);
    const row = stored
      ? await tx.lingoCorsoEsito.update({ where: { id: stored.id }, data: { spuntate: sorted } })
      : await tx.lingoCorsoEsito.create({ data: { iscrizioneId: enrolment.id, domandaId: open.id, scelta: null, corretto: null, spuntate: sorted, giorno: dayToDate(today) } });
    return { domandaId: open.id, spuntate: row.spuntate };
  });
}

/**
 * `POST …/fine { giudizio?, nota? }` (§10.5): every quiz item answered (409 otherwise); the day, the quiz's share
 * (flags change nothing, Q7), the judgement; «Completa un modulo» at 70%. Idempotent: a second call answers the
 * stored summary with `xp` null.
 */
export async function endModule(userId: string, corsoId: string, moduloId: string, body: { giudizio?: number; nota?: string }, today: string) {
  return prisma.$transaction(async (tx) => {
    const enrolment = await lockStudy(tx, userId, corsoId);
    await moduleOf(tx, corsoId, moduloId);
    const items = await moduleItems(tx, moduloId);
    const outcomes = await outcomesFor(tx, enrolment.id, items.map((i) => i.id));
    const quiz = quizOf(items, outcomes);
    const summary = (state: Prisma.LingoCorsoModuloStatoGetPayload<object>, xp: XpEsito | null) => ({
      moduloId,
      fattoGiorno: dateToDay(state.fattoGiorno!),
      quiz: { giuste: quiz.giuste, totale: quiz.totale, percentuale: state.quizPercentuale },
      missione: (state.quizPercentuale ?? 0) >= OPEN_QUESTION_PERCENT,
      giudizio: state.giudizio,
      nota: state.giudizioNota,
      segnalate: items.filter((i) => outcomes.get(i.id)?.segnalatoIl).map((i) => i.id),
      xp,
    });
    const state = await openState(tx, enrolment.id, moduloId);
    if (state.fattoIl) return summary(state, null);
    if (state.ritiratoIl) throw new AppError(409, 'Hai ritirato questo modulo.');
    if (!quiz.completo) throw new AppError(409, `Rispondi prima a tutte le domande del quiz: ${quiz.risposte} di ${quiz.totale}.`);
    const done = await tx.lingoCorsoModuloStato.update({
      where: { id: state.id },
      data: { fattoIl: new Date(), fattoGiorno: dayToDate(today), quizPercentuale: quiz.percentuale, giudizio: body.giudizio ?? null, giudizioNota: body.nota ?? null },
    });
    return summary(done, await afterStudy(tx, userId, enrolment, today, 'modulo'));
  });
}

/**
 * `POST /:id/domande/:domandaId/segnala { motivo? }` (§5.1): a flag for the assistant, on an answered item only (an
 * exam's once handed in). It changes no score (Q7). A second flag replaces the reason.
 */
export async function flagItem(userId: string, corsoId: string, domandaId: string, motivo: string | undefined) {
  return prisma.$transaction(async (tx) => {
    const enrolment = await lockStudy(tx, userId, corsoId);
    const item = await tx.lingoCorsoDomanda.findFirst({
      where: {
        id: domandaId,
        OR: [{ modulo: { corsoId } }, { esame: { corsoId, OR: [{ iscrizioneId: null }, { iscrizioneId: enrolment.id }] } }],
      },
      select: { id: true },
    });
    if (!item) throw new AppError(404, ITEM_NOT_FOUND);
    const outcome = await tx.lingoCorsoEsito.findUnique({ where: { iscrizioneId_domandaId: { iscrizioneId: enrolment.id, domandaId } } });
    if (!outcome) throw new AppError(409, 'Si segnala una domanda dopo averle risposto.');
    const flagged = await tx.lingoCorsoEsito.update({ where: { id: outcome.id }, data: { segnalatoIl: new Date(), segnalazione: motivo ?? null } });
    return { domandaId, segnalataIl: flagged.segnalatoIl, motivo: flagged.segnalazione };
  });
}

/**
 * `POST …/ritira` (§5.1, §10.5): withdraws an opened module from the enrolment, only once a live correction
 * supersedes it (409 otherwise, Q7); from then its items and cards leave mastery and the review. Idempotent.
 */
export async function withdrawModule(userId: string, corsoId: string, moduloId: string, today: string) {
  return prisma.$transaction(async (tx) => {
    const enrolment = await lockStudy(tx, userId, corsoId);
    await moduleOf(tx, corsoId, moduloId);
    const state = await tx.lingoCorsoModuloStato.findUnique({ where: { iscrizioneId_moduloId: { iscrizioneId: enrolment.id, moduloId } } });
    if (!state) throw new AppError(409, 'Il modulo non è stato aperto: se non serve, eliminalo.');
    if (state.ritiratoIl) return { moduloId, ritiratoIl: state.ritiratoIl, xp: null };
    const corrections = await tx.lingoCorsoModulo.findMany({ where: { sostituisceId: moduloId }, select: { id: true } });
    const withdrawn = new Set(
      (await tx.lingoCorsoModuloStato.findMany({ where: { iscrizioneId: enrolment.id, ritiratoIl: { not: null } }, select: { moduloId: true } })).map((s) => s.moduloId),
    );
    if (!corrections.some((c) => !withdrawn.has(c.id))) {
      throw new AppError(409, 'Si può ritirare un modulo solo quando una sua correzione è nel percorso.');
    }
    const updated = await tx.lingoCorsoModuloStato.update({ where: { id: state.id }, data: { ritiratoIl: new Date() } });
    return { moduloId, ritiratoIl: updated.ritiratoIl, xp: await afterStudy(tx, userId, enrolment, today, 'modulo') };
  });
}

// ─── The final exam ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Whether the final exam is open for the enrolment (§10.4): the course has its planned count of counting modules
 * (live, not superseded by a live correction) and every one of them is done.
 */
export async function examIsOpen(db: Tx, corsoId: string, iscrizioneId: string): Promise<boolean> {
  const corso = await db.lingoCorso.findUnique({ where: { id: corsoId }, select: { moduliPrevisti: true, moduli: { select: { id: true, sostituisceId: true } } } });
  if (!corso) return false;
  const states = await db.lingoCorsoModuloStato.findMany({ where: { iscrizioneId }, select: { moduloId: true, fattoGiorno: true, ritiratoIl: true } });
  const withdrawn = new Set(states.filter((s) => s.ritiratoIl).map((s) => s.moduloId));
  const done = new Set(states.filter((s) => s.fattoGiorno).map((s) => s.moduloId));
  const counting = countingModules(corso.moduli, withdrawn);
  return counting.length >= corso.moduliPrevisti && counting.every((m) => done.has(m.id));
}

async function examOf(db: Tx, corsoId: string, esameId: string, iscrizioneId: string) {
  const exam = await db.lingoCorsoEsame.findFirst({
    where: { id: esameId, corsoId, OR: [{ iscrizioneId: null }, { iscrizioneId }] },
    include: { domande: { orderBy: { ordine: 'asc' }, select: ITEM_SELECT } },
  });
  if (!exam) throw new AppError(404, EXAM_NOT_FOUND);
  return exam;
}

type Attempt = Prisma.LingoCorsoTentativoGetPayload<object>;

/** An attempt as the routes answer it: the items without keys until handed in, then with them and the outcomes. */
async function serializeAttempt(db: Tx, corsoId: string, exam: Awaited<ReturnType<typeof examOf>>, attempt: Attempt, xp: XpEsito | null) {
  const codeOf = await codesOf(db, corsoId);
  const handedIn = attempt.consegnatoIl !== null;
  const outcomes = handedIn ? await outcomesFor(db, attempt.iscrizioneId, exam.domande.map((d) => d.id)) : new Map<string, OutcomeRow>();
  const open = exam.domande.find((d) => d.tipo === 'ESAME_APERTA');
  return {
    esameId: exam.id,
    tentativo: {
      id: attempt.id,
      apertoIl: attempt.apertoIl,
      consegnatoIl: attempt.consegnatoIl,
      giorno: attempt.giorno && dateToDay(attempt.giorno),
      percentuale: attempt.percentuale,
      superato: attempt.superato,
    },
    perCompetenza: handedIn
      ? Object.entries((attempt.perCompetenza ?? {}) as Record<string, number>).map(([codice, percentuale]) => ({
          codice, percentuale, superata: percentuale >= EXAM_PASS.perCompetence,
        }))
      : null,
    nuovoEsameDal: handedIn && !attempt.superato ? addDays(dateToDay(attempt.giorno!), EXAM_PAUSE_DAYS) : null,
    domande: exam.domande.map((d) =>
      handedIn
        ? { ...serializeItem(d, codeOf, true), esito: outcomes.get(d.id) ? { scelta: outcomes.get(d.id)!.scelta, corretto: outcomes.get(d.id)!.corretto, segnalata: outcomes.get(d.id)!.segnalatoIl !== null } : null }
        : serializeItem(d, codeOf, false),
    ),
    aperta: handedIn && open ? { domandaId: open.id, spuntate: outcomes.get(open.id)?.spuntate ?? [] } : null,
    xp,
  };
}

/**
 * `POST …/esami/:esameId/inizia` (§10.4): the attempt and the items without keys; leaving and coming back answers
 * the same attempt, and once handed in its result. Refused while the exam is not open (409). An exam is never
 * shown twice: one attempt per exam and enrolment.
 */
export async function startExam(userId: string, corsoId: string, esameId: string) {
  return prisma.$transaction(async (tx) => {
    const enrolment = await lockStudy(tx, userId, corsoId);
    const exam = await examOf(tx, corsoId, esameId, enrolment.id);
    let attempt = await tx.lingoCorsoTentativo.findUnique({ where: { iscrizioneId_esameId: { iscrizioneId: enrolment.id, esameId } } });
    if (!attempt) {
      if (!(await examIsOpen(tx, corsoId, enrolment.id))) throw new AppError(409, 'L’esame finale si apre quando hai finito tutti i moduli del programma.');
      attempt = await tx.lingoCorsoTentativo.create({ data: { iscrizioneId: enrolment.id, esameId } });
    }
    return serializeAttempt(tx, corsoId, exam, attempt, null);
  });
}

/**
 * `POST …/esami/:esameId/consegna { risposte, aperta? }` (§10.4): every choice at once; an item left without one is
 * wrong. Graded here: 70% overall and 60% on every competence; the rubric's ticks are stored, never scored (Q6).
 * Idempotent: a second hand-in answers the stored result with `xp` null.
 */
export async function handInExam(userId: string, corsoId: string, esameId: string, body: { risposte: { domandaId: string; scelta: string }[]; aperta?: { spuntate: number[] } }, today: string) {
  return prisma.$transaction(async (tx) => {
    const enrolment = await lockStudy(tx, userId, corsoId);
    const exam = await examOf(tx, corsoId, esameId, enrolment.id);
    const attempt = await tx.lingoCorsoTentativo.findUnique({ where: { iscrizioneId_esameId: { iscrizioneId: enrolment.id, esameId } } });
    if (!attempt) throw new AppError(409, 'Inizia prima l’esame.');
    if (attempt.consegnatoIl) return serializeAttempt(tx, corsoId, exam, attempt, null);

    const graded = exam.domande.filter((d) => d.tipo === 'ESAME');
    const byId = new Map(graded.map((d) => [d.id, d]));
    const choices = new Map<string, string>();
    body.risposte.forEach((r, i) => {
      const item = byId.get(r.domandaId);
      if (!item) throw new AppError(400, `Risposta ${i + 1}: la domanda non è di questo esame.`);
      if (!(item.opzioni as unknown as StoredOption[]).some((o) => o.chiave === r.scelta)) throw new AppError(400, `Risposta ${i + 1}: la scelta non è tra le opzioni.`);
      choices.set(r.domandaId, r.scelta);
    });
    const open = exam.domande.find((d) => d.tipo === 'ESAME_APERTA');
    const ticks = [...(body.aperta?.spuntate ?? [])].sort((a, b) => a - b);
    if (open && ticks.some((i) => i >= (open.rubrica as string[]).length)) throw new AppError(400, `La griglia ha ${(open.rubrica as string[]).length} criteri.`);

    const codes = await codesOf(tx, corsoId);
    const right = (d: ItemForRead) => choices.get(d.id) === d.corretta;
    const giuste = graded.filter(right).length;
    const perCompetenza: Record<string, number> = {};
    let everyCompetence = true;
    const competences = await tx.lingoCorsoCompetenza.findMany({ where: { corsoId }, orderBy: { ordine: 'asc' }, select: { id: true } });
    for (const { id } of competences) {
      const on = graded.filter((d) => d.competenze.some((c) => c.competenzaId === id));
      if (on.length === 0) continue;
      const ok = on.filter(right).length;
      perCompetenza[codes.get(id)!] = floorPercent(ok, on.length);
      if (ok * 100 < EXAM_PASS.perCompetence * on.length) everyCompetence = false;
    }
    const superato = graded.length > 0 && giuste * 100 >= EXAM_PASS.overall * graded.length && everyCompetence;
    const giorno = dayToDate(today);
    await tx.lingoCorsoEsito.createMany({
      data: [
        ...graded.map((d) => ({
          iscrizioneId: enrolment.id, domandaId: d.id, tentativoId: attempt.id, scelta: choices.get(d.id) ?? null, corretto: right(d), giorno,
        })),
        ...(open ? [{ iscrizioneId: enrolment.id, domandaId: open.id, tentativoId: attempt.id, scelta: null, corretto: null, spuntate: ticks, giorno }] : []),
      ],
    });
    const handed = await tx.lingoCorsoTentativo.update({
      where: { id: attempt.id },
      data: { consegnatoIl: new Date(), giorno, percentuale: floorPercent(giuste, graded.length), superato, perCompetenza },
    });
    return serializeAttempt(tx, corsoId, exam, handed, await afterStudy(tx, userId, enrolment, today, 'esame'));
  });
}

/**
 * `POST …/esami/:esameId/aperta { spuntate }`: the opinion's rubric ticks, once the exam is handed in — the rubric
 * reaches the browser only then (§10.4). Written on the opinion's row only, the last send standing; never scored
 * (Q6), so the attempt's result never changes.
 */
export async function tickExamOpinion(userId: string, corsoId: string, esameId: string, spuntate: number[]) {
  return prisma.$transaction(async (tx) => {
    const enrolment = await lockStudy(tx, userId, corsoId);
    const exam = await examOf(tx, corsoId, esameId, enrolment.id);
    const attempt = await tx.lingoCorsoTentativo.findUnique({ where: { iscrizioneId_esameId: { iscrizioneId: enrolment.id, esameId } } });
    if (!attempt?.consegnatoIl) throw new AppError(409, 'La griglia si spunta dopo aver consegnato l’esame.');
    const open = exam.domande.find((d) => d.tipo === 'ESAME_APERTA');
    if (!open) throw new AppError(404, ITEM_NOT_FOUND);
    const rubric = open.rubrica as string[];
    if (spuntate.some((i) => i >= rubric.length)) throw new AppError(400, `La griglia ha ${rubric.length} criteri.`);
    const sorted = [...spuntate].sort((a, b) => a - b);
    const row = await tx.lingoCorsoEsito.update({
      where: { iscrizioneId_domandaId: { iscrizioneId: enrolment.id, domandaId: open.id } },
      data: { spuntate: sorted },
    });
    return { domandaId: open.id, spuntate: row.spuntate };
  });
}
