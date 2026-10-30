import { randomUUID } from 'node:crypto';
import { Prisma, type LingoCorsoTipoDomanda } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { citeStoredItem } from '../norms/decisionCitation';
import { rebuildDecisionEntry } from '../schemas/decisionItem';
import { LIMITS, type CourseCreateInput, type ExamCreateInput, type ModuleCreateInput } from '../schemas/lingo/corso';
import { rebuildNormEntry } from '../schemas/normEntry';
import { checkLessonText } from './courseFormat';
import { masteryFor } from './courseProgress';
import { addDays, romeDay } from './studyDay';
import { dateToDay } from './studyDays';
import { currentText, hasAccepted, serializeText } from './texts';

/**
 * Gymnasium's courses, the content side (Percorsi, A1; spec 2026-10-23 §10.2–§10.5, §10.9, §10.12): creating a
 * course with its author's enrolment, adding a module (lesson and verification together) or a final exam, and the
 * reads that do not need mastery (the list, the assistant's structure, the export). Content rows are never updated
 * once written: a correction is a new module. Every read and write is scoped to the caller — a course by its
 * author, its rows through it — and anything else is a 404, never a 403.
 */

type Tx = Prisma.TransactionClient;

/** The connected application that writes, from the delegation, never from a body. */
export type Origin = { clientId: string; clientName: string | null } | null;

/**
 * Locks the caller's course row. `NO KEY UPDATE` for a write under it (a module, an exam): two writes queue, so a
 * limit or «one exam open at a time» cannot be passed by two calls at once, and a course trashed meanwhile is
 * waited for and found gone (404), never a foreign-key 500; it does not block the foreign-key checks of the rows
 * written under it. `UPDATE` for the trash and the patch.
 */
export async function lockCourse(tx: Tx, userId: string, corsoId: string, mode: 'NO KEY UPDATE' | 'UPDATE'): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM lingo_corsi WHERE id = ${corsoId} AND autore_id = ${userId} FOR ${Prisma.raw(mode)}`,
  );
  return rows.length === 1;
}

export const NOT_FOUND = 'Percorso non trovato.';

/** The author's own enrolment (A1: a private course has one, the author's). */
export async function ownEnrolment(tx: Tx, userId: string, corsoId: string) {
  const enrolment = await tx.lingoCorsoIscrizione.findUnique({ where: { corsoId_utenteId: { corsoId, utenteId: userId } } });
  if (!enrolment) throw new AppError(404, NOT_FOUND);
  return enrolment;
}

interface ModuleLike {
  id: string;
  sostituisceId: string | null;
}

/**
 * The modules that count for the programme: live (not withdrawn from the enrolment) and not superseded by a live
 * correction. «8 di 10 moduli», the exam's opening and the limit of 40 all count these.
 */
export function countingModules<M extends ModuleLike>(modules: M[], withdrawn: ReadonlySet<string>): M[] {
  const live = modules.filter((m) => !withdrawn.has(m.id));
  const superseded = new Set(live.flatMap((m) => (m.sostituisceId ? [m.sostituisceId] : [])));
  return live.filter((m) => !superseded.has(m.id));
}

export type CourseState = 'in-preparazione' | 'in-corso' | 'superato';

/** «in preparazione» while fewer counting modules than planned, or no first exam (§10.5); «superato» once passed. */
export function courseState(input: { moduliPrevisti: number; counting: number; hasFirstExam: boolean; superatoIl: Date | null }): CourseState {
  if (input.superatoIl) return 'superato';
  return input.counting < input.moduliPrevisti || !input.hasFirstExam ? 'in-preparazione' : 'in-corso';
}

// ─── Creating a course ───────────────────────────────────────────────────────────────────────────────────────

export type CourseCreated =
  | { richiedeTesto: ReturnType<typeof serializeText> }
  | {
      corso: {
        id: string;
        titolo: string;
        materia: string;
        moduliPrevisti: number;
        competenze: { codice: string; testo: string }[];
        dossier: { id: string; name: string };
      };
    };

/**
 * The course, its competences (C1, C2… in the order given) and the author's enrolment with the study dossier, in
 * one transaction. Until the current version of the declaration `MATERIALE_STUDIO` is accepted, nothing is
 * written and the caller answers 409 with the text (the web shows it in «Percorsi»).
 */
export async function createCourse(userId: string, input: CourseCreateInput, origin: Origin): Promise<CourseCreated> {
  return prisma.$transaction(async (tx) => {
    const declaration = await currentText(tx, 'MATERIALE_STUDIO');
    if (!(await hasAccepted(tx, userId, declaration.id))) return { richiedeTesto: serializeText(declaration, false) };
    // The user's row first, as every Studia write that inserts a row pointing at it: an account's deletion and
    // this creation never wait on each other in opposite orders.
    await lockUserRow(tx, userId);
    // Two creations at once cannot both pass the limit.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('lingo_corsi:' || ${userId}::text))`;
    if ((await tx.lingoCorso.count({ where: { autoreId: userId } })) >= LIMITS.coursesPerUser) {
      throw new AppError(409, `Hai già ${LIMITS.coursesPerUser} percorsi: eliminane uno prima di crearne un altro.`);
    }
    // The dossier is locked while the course is written: one trashed meanwhile is waited for and found gone (404).
    const dossiers = await tx.$queryRaw<{ id: string; name: string; kind: string }[]>`
      SELECT id, name, kind::text AS kind FROM dossiers WHERE id = ${input.dossierId} AND user_id = ${userId} FOR KEY SHARE`;
    if (dossiers.length === 0) throw new AppError(404, 'Dossier non trovato.');
    if (dossiers[0].kind !== 'studio') throw new AppError(400, 'Il dossier di un percorso deve essere un dossier di studio.');
    const corso = await tx.lingoCorso.create({
      data: {
        autoreId: userId,
        titolo: input.titolo,
        materia: input.materia,
        descrizione: input.descrizione ?? null,
        moduliPrevisti: input.moduliPrevisti,
        dichiarazioneTestoId: declaration.id,
        createdByClientId: origin?.clientId ?? null,
        createdByClientName: origin?.clientName ?? null,
        competenze: { create: input.competenze.map((c, i) => ({ codice: `C${i + 1}`, ordine: i + 1, testo: c.testo })) },
        iscrizioni: { create: { utenteId: userId, dossierId: dossiers[0].id } },
      },
      include: { competenze: { orderBy: { ordine: 'asc' } } },
    });
    return {
      corso: {
        id: corso.id,
        titolo: corso.titolo,
        materia: corso.materia,
        moduliPrevisti: corso.moduliPrevisti,
        competenze: corso.competenze.map((c) => ({ codice: c.codice, testo: c.testo })),
        dossier: { id: dossiers[0].id, name: dossiers[0].name },
      },
    };
  });
}

// ─── Adding a module ─────────────────────────────────────────────────────────────────────────────────────────

/** A citation as a block stores it: the dossier entry's identity and citation, copied (§10.3). */
export interface StoredCitation {
  marcatore: string;
  voce: string;
  tipo: 'norm' | 'sentenza';
  riferimento: Prisma.InputJsonObject;
  citation: string | null;
}

const refuse = (where: string, why: string): never => {
  throw new AppError(400, `${where}: ${why}`);
};

/** The codes as competence ids, every one the course's and, when `within` is given, among those. */
function competenceIds(codes: string[], byCode: Map<string, string>, where: string, within?: ReadonlySet<string>): string[] {
  return [...new Set(codes)].map((code) => {
    const id = byCode.get(code);
    if (!id) return refuse(where, `la competenza ${code} non è di questo percorso`);
    if (within && !within.has(id)) return refuse(where, `la competenza ${code} non è tra quelle del modulo`);
    return id;
  });
}

/** Resolves a module's citations against the course's dossier; a refusal names the block and the marker. */
async function resolveCitations(tx: Tx, dossierId: string | null, blocks: ModuleCreateInput['blocchi']): Promise<StoredCitation[][]> {
  const wanted = [...new Set(blocks.flatMap((b) => b.citazioni.map((c) => c.voce)))];
  if (wanted.length === 0) return blocks.map(() => []);
  if (!dossierId) throw new AppError(409, 'Il dossier del percorso non c’è più: un modulo senza dossier non può avere citazioni.');
  // The dossier is locked while its entries are copied: one trashed meanwhile is waited for, then found gone.
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM dossiers WHERE id = ${dossierId} FOR KEY SHARE`;
  if (locked.length === 0) throw new AppError(409, 'Il dossier del percorso non c’è più: un modulo senza dossier non può avere citazioni.');
  const items = await tx.dossierItem.findMany({ where: { id: { in: wanted }, dossierId }, select: { id: true, itemType: true, content: true } });
  const byId = new Map(items.map((item) => [item.id, item]));
  return blocks.map((block, b) =>
    block.citazioni.map(({ marcatore, voce }) => {
      const where = `Blocco ${b + 1}, citazione ${marcatore}`;
      const item = byId.get(voce);
      if (!item) return refuse(where, 'la voce non è nel dossier del percorso');
      if (item.itemType === 'norm') {
        const rebuilt = rebuildNormEntry(item.content);
        if (!rebuilt.ok) return refuse(where, `la norma non si può citare (${rebuilt.reason})`);
        return { marcatore, voce, tipo: 'norm' as const, riferimento: { ...rebuilt.entry }, citation: citeStoredItem('norm', rebuilt.entry) };
      }
      if (item.itemType === 'sentenza') {
        const rebuilt = rebuildDecisionEntry(item.content);
        if (!rebuilt.ok) return refuse(where, `la sentenza non si può citare (${rebuilt.reason})`);
        const riferimento = JSON.parse(JSON.stringify(rebuilt.entry)) as Prisma.InputJsonObject;
        return { marcatore, voce, tipo: 'sentenza' as const, riferimento, citation: citeStoredItem('sentenza', rebuilt.entry) };
      }
      return refuse(where, 'si possono citare solo norme e sentenze del dossier');
    }),
  );
}

interface ItemRow {
  id: string;
  moduloId: string | null;
  esameId: string | null;
  bloccoId: string | null;
  tipo: LingoCorsoTipoDomanda;
  applicazione: boolean;
  ordine: number;
  testo: string;
  opzioni: Prisma.InputJsonValue | typeof Prisma.DbNull;
  corretta: string | null;
  rispostaModello: string | null;
  rubrica: Prisma.InputJsonValue | typeof Prisma.DbNull;
}

export interface ModuleAdded {
  id: string;
  ordine: number;
  titolo: string;
  sostituisceId: string | null;
  blocchi: number;
  parole: number;
  citazioni: number;
  domande: number;
  corso: { moduli: { contati: number; previsti: number } };
}

/**
 * One module whole — blocks, citations, items, competences, and the module it corrects if any — or nothing: a
 * refusal is an Italian 400 naming the part. The course is locked `FOR NO KEY UPDATE` (one trashed meanwhile: 404).
 */
export async function addModule(userId: string, corsoId: string, input: ModuleCreateInput, origin: Origin): Promise<ModuleAdded> {
  // The format first: no transaction is opened for a body that cannot be stored.
  const lessonChars = input.blocchi.reduce((sum, b) => sum + b.testo.length, 0);
  if (lessonChars > LIMITS.lessonChars) refuse('Lezione', `al massimo ${LIMITS.lessonChars.toLocaleString('it-IT')} caratteri in tutto`);
  const citationCount = input.blocchi.reduce((sum, b) => sum + b.citazioni.length, 0);
  if (citationCount > LIMITS.citationsPerModule) refuse('Citazioni', `al massimo ${LIMITS.citationsPerModule} per modulo`);
  const words = input.blocchi.map((block, b) => {
    const where = `Blocco ${b + 1}`;
    const format = checkLessonText(block.testo);
    if (!format.ok) return refuse(where, format.reason);
    const given = block.citazioni.map((c) => c.marcatore);
    if (new Set(given).size !== given.length) refuse(where, 'un marcatore di citazione è ripetuto');
    const missing = format.markers.find((m) => !given.includes(m));
    if (missing) refuse(where, `il testo cita #${missing}, che non ha una voce`);
    const unused = given.find((m) => !format.markers.includes(m));
    if (unused) refuse(where, `la citazione ${unused} non è usata nel testo`);
    return format.words;
  });
  const applied = input.quiz.filter((q) => q.applicazione).length;
  if (applied * 2 < input.quiz.length) refuse('Quiz', 'almeno metà delle domande deve essere di applicazione');

  return prisma.$transaction(async (tx) => {
    if (!(await lockCourse(tx, userId, corsoId, 'NO KEY UPDATE'))) throw new AppError(404, NOT_FOUND);
    const enrolment = await ownEnrolment(tx, userId, corsoId);
    const corso = await tx.lingoCorso.findUniqueOrThrow({ where: { id: corsoId }, include: { competenze: true } });
    const byCode = new Map(corso.competenze.map((c) => [c.codice, c.id]));
    const moduleCompetences = competenceIds(input.competenze, byCode, 'Modulo');
    const within = new Set(moduleCompetences);

    const modules = await tx.lingoCorsoModulo.findMany({ where: { corsoId }, select: { id: true, sostituisceId: true } });
    if (input.sostituisceId && !modules.some((m) => m.id === input.sostituisceId)) {
      refuse('Modulo', 'il modulo da correggere non è di questo percorso');
    }
    if (modules.length + 1 > LIMITS.moduleRows) refuse('Modulo', `un percorso ha al massimo ${LIMITS.moduleRows} moduli, correzioni comprese`);
    const withdrawn = await withdrawnModules(tx, enrolment.id);
    const id = randomUUID();
    const counting = countingModules([...modules, { id, sostituisceId: input.sostituisceId ?? null }], withdrawn);
    if (counting.length > LIMITS.liveModules) refuse('Modulo', `un percorso ha al massimo ${LIMITS.liveModules} moduli`);
    // The programme is fixed at creation and only the user lowers it: a module past it is refused, a correction is not.
    if (counting.length > corso.moduliPrevisti) {
      throw new AppError(409, `Il programma ha ${corso.moduliPrevisti} moduli e sono già tutti presenti: si può aggiungere solo la correzione di uno.`);
    }

    const citations = await resolveCitations(tx, enrolment.dossierId, input.blocchi);

    const blockIds = input.blocchi.map(() => randomUUID());
    const items: ItemRow[] = [];
    const itemCompetences: { domandaId: string; competenzaId: string }[] = [];
    const push = (row: Omit<ItemRow, 'id' | 'ordine' | 'moduloId' | 'esameId'>, codes: string[], where: string) => {
      const itemId = randomUUID();
      items.push({ ...row, id: itemId, moduloId: id, esameId: null, ordine: items.length + 1 });
      for (const competenzaId of competenceIds(codes, byCode, where, within)) itemCompetences.push({ domandaId: itemId, competenzaId });
    };
    input.blocchi.forEach((block, b) =>
      block.richiamo.forEach((q, i) =>
        push(
          { bloccoId: blockIds[b], tipo: 'RICHIAMO', applicazione: q.applicazione, testo: q.testo, opzioni: q.opzioni, corretta: q.corretta, rispostaModello: null, rubrica: Prisma.DbNull },
          q.competenze,
          `Blocco ${b + 1}, richiamo ${i + 1}`,
        ),
      ),
    );
    input.quiz.forEach((q, i) =>
      push(
        { bloccoId: null, tipo: 'QUIZ', applicazione: q.applicazione, testo: q.testo, opzioni: q.opzioni, corretta: q.corretta, rispostaModello: null, rubrica: Prisma.DbNull },
        q.competenze,
        `Quiz, domanda ${i + 1}`,
      ),
    );
    const open = input.aperta;
    push(
      { bloccoId: null, tipo: 'APERTA', applicazione: true, testo: open.testo, opzioni: open.opzioni, corretta: open.corretta, rispostaModello: open.rispostaModello, rubrica: open.rubrica },
      open.competenze,
      'Domanda aperta',
    );

    await tx.lingoCorsoModulo.create({
      data: {
        id,
        corsoId,
        ordine: input.ordine,
        titolo: input.titolo,
        minuti: input.minuti ?? null,
        domandePrima: input.domandePrima,
        sostituisceId: input.sostituisceId ?? null,
        createdByClientId: origin?.clientId ?? null,
        createdByClientName: origin?.clientName ?? null,
      },
    });
    await tx.lingoCorsoModuloCompetenza.createMany({ data: moduleCompetences.map((competenzaId) => ({ moduloId: id, competenzaId })) });
    await tx.lingoCorsoBlocco.createMany({
      data: input.blocchi.map((block, b) => ({
        id: blockIds[b],
        moduloId: id,
        ordine: b + 1,
        titolo: block.titolo ?? null,
        testo: block.testo,
        parole: words[b],
        citazioni: citations[b] as unknown as Prisma.InputJsonArray,
      })),
    });
    await tx.lingoCorsoDomanda.createMany({ data: items });
    await tx.lingoCorsoDomandaCompetenza.createMany({ data: itemCompetences });
    return {
      id,
      ordine: input.ordine,
      titolo: input.titolo,
      sostituisceId: input.sostituisceId ?? null,
      blocchi: input.blocchi.length,
      parole: words.reduce((a, b) => a + b, 0),
      citazioni: citationCount,
      domande: items.length,
      corso: { moduli: { contati: counting.length, previsti: corso.moduliPrevisti } },
    };
  });
}

/** The modules this enrolment withdrew (a correction superseded them, §5.1). */
export async function withdrawnModules(tx: Tx, iscrizioneId: string): Promise<Set<string>> {
  const rows = await tx.lingoCorsoModuloStato.findMany({ where: { iscrizioneId, ritiratoIl: { not: null } }, select: { moduloId: true } });
  return new Set(rows.map((r) => r.moduloId));
}

// ─── Adding a final exam ─────────────────────────────────────────────────────────────────────────────────────

/** The Rome days a failed attempt waits before a new exam can be written (§4, §10.4). */
export const EXAM_PAUSE_DAYS = 3;

/**
 * An exam (§10.5): refused while one is open or never attempted, after a passed one, before the third Rome day
 * after a failed one, while the counting modules are fewer than planned, when a competence is served by no
 * counting module or has fewer than five live cards (§10.7), or without two application items per competence and
 * one open item. The first exam is the course's content (`iscrizioneId` null); a later one is written for the
 * enrolment whose attempt failed, so in A3 a learner's new exam is theirs.
 */
export async function addExam(userId: string, corsoId: string, input: ExamCreateInput, origin: Origin, today = romeDay(new Date())) {
  return prisma.$transaction(async (tx) => {
    if (!(await lockCourse(tx, userId, corsoId, 'NO KEY UPDATE'))) throw new AppError(404, NOT_FOUND);
    const enrolment = await ownEnrolment(tx, userId, corsoId);
    const corso = await tx.lingoCorso.findUniqueOrThrow({ where: { id: corsoId }, include: { competenze: { orderBy: { ordine: 'asc' } } } });
    const byCode = new Map(corso.competenze.map((c) => [c.codice, c.id]));

    // The items' shape first: it is the assistant's to correct whatever the course's state.
    const perCompetence = new Map<string, number>();
    input.domande.forEach((q, i) => {
      for (const competenzaId of competenceIds(q.competenze, byCode, `Domanda ${i + 1}`)) {
        if (q.applicazione) perCompetence.set(competenzaId, (perCompetence.get(competenzaId) ?? 0) + 1);
      }
    });
    const openCompetences = competenceIds(input.aperta.competenze, byCode, 'Domanda aperta');
    const short = corso.competenze.find((c) => (perCompetence.get(c.id) ?? 0) < LIMITS.examItemsPerCompetence);
    if (short) refuse('Esame', `servono almeno ${LIMITS.examItemsPerCompetence} domande di applicazione sulla competenza ${short.codice}`);

    // Then the course's state.
    const exams = await tx.lingoCorsoEsame.findMany({
      where: { corsoId, OR: [{ iscrizioneId: null }, { iscrizioneId: enrolment.id }] },
      select: { id: true, iscrizioneId: true, tentativi: { where: { iscrizioneId: enrolment.id } } },
    });
    let lastFailed: string | null = null;
    for (const exam of exams) {
      const attempt = exam.tentativi[0];
      if (!attempt) throw new AppError(409, 'C’è già un esame finale non ancora svolto.');
      if (!attempt.consegnatoIl) throw new AppError(409, 'C’è un esame finale in corso.');
      if (attempt.superato) throw new AppError(409, 'L’esame finale è già superato.');
      const day = attempt.giorno ? dateToDay(attempt.giorno) : null;
      if (day && (!lastFailed || day > lastFailed)) lastFailed = day;
    }
    if (lastFailed && today < addDays(lastFailed, EXAM_PAUSE_DAYS)) {
      throw new AppError(409, `Un nuovo esame si può aggiungere dal ${addDays(lastFailed, EXAM_PAUSE_DAYS)}.`);
    }

    const modules = await tx.lingoCorsoModulo.findMany({
      where: { corsoId },
      select: { id: true, sostituisceId: true, competenze: { select: { competenzaId: true } } },
    });
    const withdrawn = await withdrawnModules(tx, enrolment.id);
    const counting = countingModules(modules, withdrawn);
    if (counting.length < corso.moduliPrevisti) {
      throw new AppError(409, `Il programma non è completo: ${counting.length} di ${corso.moduliPrevisti} moduli.`);
    }
    const served = new Set(counting.flatMap((m) => m.competenze.map((c) => c.competenzaId)));
    const unserved = corso.competenze.find((c) => !served.has(c.id));
    if (unserved) throw new AppError(409, `Nessun modulo serve la competenza ${unserved.codice}.`);
    // Live cards: a withdrawn module's leave the review (§10.7), so they do not count here either.
    const liveModuleIds = modules.filter((m) => !withdrawn.has(m.id)).map((m) => m.id);
    const cards = await tx.lingoCardCompetenza.groupBy({
      by: ['competenzaId'],
      where: { competenzaId: { in: corso.competenze.map((c) => c.id) }, card: { moduloId: { in: liveModuleIds } } },
      _count: { _all: true },
    });
    const cardCount = new Map(cards.map((row) => [row.competenzaId, row._count._all]));
    const fewCards = corso.competenze.find((c) => (cardCount.get(c.id) ?? 0) < LIMITS.cardsPerCompetence);
    if (fewCards) {
      throw new AppError(409, `La competenza ${fewCards.codice} ha ${cardCount.get(fewCards.id) ?? 0} schede su ${LIMITS.cardsPerCompetence}: aggiungine prima di scrivere l’esame.`);
    }

    const id = randomUUID();
    const items: ItemRow[] = [];
    const itemCompetences: { domandaId: string; competenzaId: string }[] = [];
    input.domande.forEach((q, i) => {
      const itemId = randomUUID();
      items.push({
        id: itemId, moduloId: null, esameId: id, bloccoId: null, tipo: 'ESAME', applicazione: q.applicazione, ordine: i + 1, testo: q.testo,
        opzioni: q.opzioni, corretta: q.corretta, rispostaModello: null, rubrica: Prisma.DbNull,
      });
      for (const competenzaId of competenceIds(q.competenze, byCode, `Domanda ${i + 1}`)) itemCompetences.push({ domandaId: itemId, competenzaId });
    });
    const openId = randomUUID();
    items.push({
      id: openId, moduloId: null, esameId: id, bloccoId: null, tipo: 'ESAME_APERTA', applicazione: true, ordine: items.length + 1,
      testo: input.aperta.testo, opzioni: Prisma.DbNull, corretta: null, rispostaModello: input.aperta.rispostaModello, rubrica: input.aperta.rubrica,
    });
    for (const competenzaId of openCompetences) itemCompetences.push({ domandaId: openId, competenzaId });

    const first = !exams.some((e) => e.iscrizioneId === null);
    await tx.lingoCorsoEsame.create({
      data: {
        id,
        corsoId,
        iscrizioneId: first ? null : enrolment.id,
        createdByClientId: origin?.clientId ?? null,
        createdByClientName: origin?.clientName ?? null,
      },
    });
    await tx.lingoCorsoDomanda.createMany({ data: items });
    await tx.lingoCorsoDomandaCompetenza.createMany({ data: itemCompetences });
    return { id, domande: items.length, perIscrizione: !first };
  });
}

// ─── Reads ───────────────────────────────────────────────────────────────────────────────────────────────────

/** An item's options as a learner sees them before answering: no explanation. */
export type StoredOption = { chiave: string; testo: string; spiegazione: string };

export interface ItemForRead {
  id: string;
  tipo: LingoCorsoTipoDomanda;
  bloccoId: string | null;
  applicazione: boolean;
  ordine: number;
  testo: string;
  opzioni: Prisma.JsonValue;
  corretta: string | null;
  rispostaModello: string | null;
  rubrica: Prisma.JsonValue;
  competenze: { competenzaId: string }[];
}

/** Every read of an item names the key's columns: none of them is read by default (§10.2). */
export const ITEM_SELECT = {
  id: true, tipo: true, bloccoId: true, applicazione: true, ordine: true, testo: true, opzioni: true, corretta: true,
  rispostaModello: true, rubrica: true, competenze: { select: { competenzaId: true } },
} satisfies Prisma.LingoCorsoDomandaSelect;

/**
 * An item as a read answers it. Without keys — an exam not yet handed in (§10.4, point 3: in an export and in the
 * assistant's structure too) — the right answer, the explanations, the model answer and the rubric are left out.
 */
export function serializeItem(item: ItemForRead, codeOf: Map<string, string>, withKeys: boolean) {
  const options = Array.isArray(item.opzioni) ? (item.opzioni as unknown as StoredOption[]) : null;
  return {
    id: item.id,
    tipo: item.tipo,
    ordine: item.ordine,
    applicazione: item.applicazione,
    testo: item.testo,
    competenze: item.competenze.map((c) => codeOf.get(c.competenzaId)).filter((c): c is string => Boolean(c)),
    opzioni: options && (withKeys ? options : options.map(({ chiave, testo }) => ({ chiave, testo }))),
    ...(withKeys ? { corretta: item.corretta, rispostaModello: item.rispostaModello, rubrica: item.rubrica } : {}),
  };
}

/**
 * A course's content and its enrolment's rows, read content first and person second, joined in memory by id
 * (T30's rule: a module trashed between two statements is left out, never a 500). Null when the course is not
 * the caller's.
 */
async function readCourse(userId: string, corsoId: string) {
  const corso = await prisma.lingoCorso.findFirst({
    where: { id: corsoId, autoreId: userId },
    include: {
      competenze: { orderBy: { ordine: 'asc' } },
      dichiarazioneTesto: { select: { versione: true } },
      moduli: {
        orderBy: [{ ordine: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        include: {
          competenze: { select: { competenzaId: true } },
          blocchi: { orderBy: { ordine: 'asc' } },
          domande: { orderBy: { ordine: 'asc' }, select: ITEM_SELECT },
        },
      },
      esami: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { domande: { orderBy: { ordine: 'asc' }, select: ITEM_SELECT } } },
    },
  });
  if (!corso) return null;
  const enrolment = await prisma.lingoCorsoIscrizione.findUnique({
    where: { corsoId_utenteId: { corsoId, utenteId: userId } },
    include: {
      dossier: { select: { id: true, name: true } },
      stati: { orderBy: { apertoIl: 'asc' } },
      esiti: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      tentativi: { orderBy: { apertoIl: 'asc' } },
    },
  });
  if (!enrolment) return null;
  // An exam written for another enrolment is reachable only from it (A3).
  const esami = corso.esami.filter((e) => e.iscrizioneId === null || e.iscrizioneId === enrolment.id);
  return { corso: { ...corso, esami }, enrolment };
}

type ReadCourse = NonNullable<Awaited<ReturnType<typeof readCourse>>>;

const handedIn = (read: ReadCourse) => new Set(read.enrolment.tentativi.filter((t) => t.consegnatoIl).map((t) => t.esameId));

/** The course's content, keys included except for an exam not yet handed in: the structure and the export share it. */
function serializeContent(read: ReadCourse) {
  const { corso } = read;
  const codeOf = new Map(corso.competenze.map((c) => [c.id, c.codice]));
  const done = handedIn(read);
  const blockOrder = new Map(corso.moduli.flatMap((m) => m.blocchi.map((b) => [b.id, b.ordine] as const)));
  return {
    id: corso.id,
    titolo: corso.titolo,
    materia: corso.materia,
    descrizione: corso.descrizione,
    moduliPrevisti: corso.moduliPrevisti,
    dichiarazione: { versione: corso.dichiarazioneTesto.versione },
    creatoDa: corso.createdByClientName === null && corso.createdByClientId === null ? null : { clientName: corso.createdByClientName },
    createdAt: corso.createdAt,
    updatedAt: corso.updatedAt,
    competenze: corso.competenze.map((c) => ({ codice: c.codice, ordine: c.ordine, testo: c.testo })),
    moduli: corso.moduli.map((m) => ({
      id: m.id,
      ordine: m.ordine,
      titolo: m.titolo,
      minuti: m.minuti,
      domandePrima: m.domandePrima,
      sostituisceId: m.sostituisceId,
      creatoDa: m.createdByClientName === null && m.createdByClientId === null ? null : { clientName: m.createdByClientName },
      createdAt: m.createdAt,
      competenze: m.competenze.map((c) => codeOf.get(c.competenzaId)),
      blocchi: m.blocchi.map((b) => ({ ordine: b.ordine, titolo: b.titolo, testo: b.testo, parole: b.parole, citazioni: b.citazioni })),
      domande: m.domande.map((d) => ({ ...serializeItem(d, codeOf, true), blocco: d.bloccoId ? (blockOrder.get(d.bloccoId) ?? null) : null })),
    })),
    esami: corso.esami.map((e) => ({
      id: e.id,
      perIscrizione: e.iscrizioneId !== null,
      consegnato: done.has(e.id),
      creatoDa: e.createdByClientName === null && e.createdByClientId === null ? null : { clientName: e.createdByClientName },
      createdAt: e.createdAt,
      domande: e.domande.map((d) => serializeItem(d, codeOf, done.has(e.id))),
    })),
  };
}

/**
 * `GET /struttura`, the course for the assistant (§10.5): the content (keys too, but not those of an exam not
 * yet handed in), the flags with their reasons and the judgements, so that it can correct, and every competence's
 * mastery (`padronanza`: «in corso», «da riprendere»… with the numbers), so that it can reinforce (A2). The text was
 * written from the user's material: the MCP tool says it is data, never instructions (§10.9).
 */
export async function courseStructure(userId: string, corsoId: string, today = romeDay(new Date())) {
  const read = await readCourse(userId, corsoId);
  if (!read) throw new AppError(404, NOT_FOUND);
  const content = serializeContent(read);
  const mastery = (await masteryFor(prisma, userId, [{ id: read.enrolment.id, corsoId }], today)).get(corsoId)!;
  const itemIds = new Set([...read.corso.moduli.flatMap((m) => m.domande.map((d) => d.id)), ...read.corso.esami.flatMap((e) => e.domande.map((d) => d.id))]);
  return {
    ...content,
    stato: summarize(read).stato,
    padronanza: mastery.competenze.map((c) => {
      const m = mastery.padronanza.get(c.id)!;
      return { codice: c.codice, stato: m.stato, sessioni: m.sessioni, prossimaDal: m.prossimaDal, ultima: m.ultima };
    }),
    segnalazioni: read.enrolment.esiti
      .filter((e) => e.segnalatoIl && itemIds.has(e.domandaId))
      .map((e) => ({ domandaId: e.domandaId, motivo: e.segnalazione, segnalataIl: e.segnalatoIl })),
    giudizi: read.enrolment.stati
      .filter((s) => s.giudizio !== null)
      .map((s) => ({ moduloId: s.moduloId, giudizio: s.giudizio, nota: s.giudizioNota })),
  };
}

/** A course as the account's export and `GET /:id/export` carry it: content, and the caller's enrolment whole. */
export function exportCourse(read: ReadCourse) {
  const { enrolment } = read;
  return {
    ...serializeContent(read),
    iscrizione: {
      id: enrolment.id,
      dossierId: enrolment.dossierId,
      superatoIl: enrolment.superatoIl && dateToDay(enrolment.superatoIl),
      createdAt: enrolment.createdAt,
      stati: enrolment.stati.map(({ iscrizioneId: _e, fattoGiorno, ...s }) => ({ ...s, fattoGiorno: fattoGiorno && dateToDay(fattoGiorno) })),
      esiti: enrolment.esiti.map(({ iscrizioneId: _e, giorno, ...e }) => ({ ...e, giorno: dateToDay(giorno) })),
      tentativi: enrolment.tentativi.map(({ iscrizioneId: _e, giorno, ...t }) => ({ ...t, giorno: giorno && dateToDay(giorno) })),
    },
  };
}

export async function exportOneCourse(userId: string, corsoId: string) {
  const read = await readCourse(userId, corsoId);
  if (!read) throw new AppError(404, NOT_FOUND);
  return exportCourse(read);
}

/** Every course the user wrote, for the account's export (§10.9): only the user's own enrolment of each. */
export async function exportUserCourses(userId: string) {
  const ids = await prisma.lingoCorso.findMany({ where: { autoreId: userId }, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const out = [];
  for (const { id } of ids) {
    const read = await readCourse(userId, id);
    if (read) out.push(exportCourse(read));
  }
  return out;
}

/** What the list row's state and next step need, of a course and of the caller's enrolment. */
interface SummaryInput {
  corso: {
    moduliPrevisti: number;
    moduli: { id: string; ordine: number; titolo: string; sostituisceId: string | null }[];
    esami: { id: string; iscrizioneId: string | null }[];
  };
  enrolment: {
    superatoIl: Date | null;
    stati: { moduloId: string; fattoGiorno: Date | null; ritiratoIl: Date | null }[];
    tentativi: { esameId: string; consegnatoIl: Date | null }[];
  };
}

/** The list row's state and next step, from rows already read. */
function summarize(read: SummaryInput) {
  const { corso, enrolment } = read;
  const withdrawn = new Set(enrolment.stati.filter((s) => s.ritiratoIl).map((s) => s.moduloId));
  const counting = countingModules(corso.moduli, withdrawn);
  const done = new Set(enrolment.stati.filter((s) => s.fattoGiorno).map((s) => s.moduloId));
  const stato = courseState({
    moduliPrevisti: corso.moduliPrevisti,
    counting: counting.length,
    hasFirstExam: corso.esami.some((e) => e.iscrizioneId === null),
    superatoIl: enrolment.superatoIl,
  });
  const next = counting.find((m) => !done.has(m.id));
  const attempts = new Map(enrolment.tentativi.map((t) => [t.esameId, t]));
  const openExam = corso.esami.find((e) => !attempts.get(e.id)?.consegnatoIl);
  const prossimo = next
    ? { tipo: 'modulo' as const, id: next.id, ordine: next.ordine, titolo: next.titolo }
    : stato !== 'superato' && counting.length >= corso.moduliPrevisti && openExam
      ? { tipo: 'esame' as const, id: openExam.id }
      : null;
  return { stato, counting: counting.length, prossimo };
}

/**
 * `GET /` (§10.5): the caller's courses, newest first, with their state, the competences acquired (mastery, §4),
 * the modules counted against the programme and the next step. Content first, then the person's rows, joined in
 * memory.
 */
export async function listCourses(userId: string, today = romeDay(new Date())) {
  const courses = await prisma.lingoCorso.findMany({
    where: { autoreId: userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true, titolo: true, materia: true, moduliPrevisti: true, createdAt: true,
      _count: { select: { competenze: true } },
      moduli: { select: { id: true, ordine: true, titolo: true, sostituisceId: true }, orderBy: [{ ordine: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] },
      esami: { select: { id: true, iscrizioneId: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
    },
  });
  const enrolments = await prisma.lingoCorsoIscrizione.findMany({
    where: { utenteId: userId, corsoId: { in: courses.map((c) => c.id) } },
    select: {
      id: true, corsoId: true, superatoIl: true,
      stati: { select: { moduloId: true, fattoGiorno: true, ritiratoIl: true } },
      tentativi: { select: { esameId: true, consegnatoIl: true } },
    },
  });
  const byCourse = new Map(enrolments.map((e) => [e.corsoId, e]));
  const mastery = await masteryFor(prisma, userId, enrolments, today);
  return courses.flatMap((corso) => {
    const enrolment = byCourse.get(corso.id);
    if (!enrolment) return [];
    const esami = corso.esami.filter((e) => e.iscrizioneId === null || e.iscrizioneId === enrolment.id);
    const { stato, counting, prossimo } = summarize({ corso: { ...corso, esami }, enrolment });
    return [
      {
        id: corso.id,
        titolo: corso.titolo,
        materia: corso.materia,
        stato,
        competenze: {
          acquisite: [...(mastery.get(corso.id)?.padronanza.values() ?? [])].filter((m) => m.stato === 'acquisita').length,
          totale: corso._count.competenze,
        },
        moduli: { contati: counting, previsti: corso.moduliPrevisti },
        prossimo,
        createdAt: corso.createdAt,
      },
    ];
  });
}

// ─── The content's only updates ─────────────────────────────────────────────────────────────────────────────

/**
 * `PATCH /:id` (§10.5): rename, and «Il programma finisce qui», which lowers `moduliPrevisti` — never raises it,
 * never under the counting modules or 1. The user's own acts, in the web: not in the delegated table.
 */
export async function patchCourse(userId: string, corsoId: string, body: { titolo?: string; moduliPrevisti?: number }) {
  return prisma.$transaction(async (tx) => {
    if (!(await lockCourse(tx, userId, corsoId, 'UPDATE'))) throw new AppError(404, NOT_FOUND);
    const corso = await tx.lingoCorso.findUniqueOrThrow({ where: { id: corsoId } });
    if (body.moduliPrevisti !== undefined && body.moduliPrevisti !== corso.moduliPrevisti) {
      if (body.moduliPrevisti > corso.moduliPrevisti) throw new AppError(400, 'Il programma si può solo accorciare: i moduli in più li aggiunge l’assistente.');
      const enrolment = await ownEnrolment(tx, userId, corsoId);
      const modules = await tx.lingoCorsoModulo.findMany({ where: { corsoId }, select: { id: true, sostituisceId: true } });
      const counting = countingModules(modules, await withdrawnModules(tx, enrolment.id)).length;
      if (body.moduliPrevisti < Math.max(1, counting)) {
        throw new AppError(400, `Il programma non può finire prima dei moduli che ha già: ${counting}.`);
      }
    }
    const updated = await tx.lingoCorso.update({
      where: { id: corsoId },
      data: { ...(body.titolo !== undefined ? { titolo: body.titolo } : {}), ...(body.moduliPrevisti !== undefined ? { moduliPrevisti: body.moduliPrevisti } : {}) },
    });
    return { id: updated.id, titolo: updated.titolo, moduliPrevisti: updated.moduliPrevisti };
  });
}

/** Takes the user's row `FOR KEY SHARE`, first in a transaction that inserts rows pointing at it. */
export async function lockUserRow(tx: Tx, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM users WHERE id = ${userId} FOR KEY SHARE`;
}

/**
 * For the card route: the caller's module, locked `FOR NO KEY UPDATE` (two calls adding cards to it queue, so the
 * limit holds; one trashed meanwhile is waited for, then 404), with its course's competences; null when not theirs.
 */
export async function lockModuleForCards(tx: Tx, userId: string, moduloId: string) {
  const rows = await tx.$queryRaw<{ id: string; corso_id: string }[]>`
    SELECT m.id, m.corso_id FROM lingo_corsi_moduli m JOIN lingo_corsi c ON c.id = m.corso_id
    WHERE m.id = ${moduloId} AND c.autore_id = ${userId} FOR NO KEY UPDATE OF m`;
  if (rows.length === 0) return null;
  const competenze = await tx.lingoCorsoCompetenza.findMany({ where: { corsoId: rows[0].corso_id }, select: { id: true, codice: true } });
  return { id: rows[0].id, corsoId: rows[0].corso_id, byCode: new Map(competenze.map((c) => [c.codice, c.id])) };
}

export const romeToday = () => romeDay(new Date());
