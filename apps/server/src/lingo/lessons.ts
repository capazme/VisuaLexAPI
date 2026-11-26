import { randomInt } from 'crypto';
import { Prisma, type LingoMateria } from '../lib/db';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { settleMissions, type XpEsito } from './missions';
import { courseDayFor, reviewScope } from './reviewQueue';
import { dayToDate } from './studyDays';
import { levelNow } from './xpLedger';
import { readPreferences } from './studyPreferences';
import { romeDay } from './studyDay';

/**
 * Learn's short lesson (LC63; vault spec «Learn alla Duolingo - specifica (17-11)», §L2): 5–8 exercises in a row,
 * built here from the validated cards of the review scope (`reviewScope`: one's own and the community's in the subjects
 * switched on; never a draft, L-67) and graded here. Every exercise recombines the cards' own
 * words — a question, an answer, an institute, an article — and writes no legal sentence of its own. The keys are
 * stored with the lesson and never sent before the answer; the last answer ends the lesson and `settleMissions`
 * credits «Lezione» in the same transaction. Session only: no route of the lessons is in the delegated table.
 */

/** One card for the question and three for the other answers (the web's `LESSON_MIN_CARDS`). */
export const LESSON_MIN_CARDS = 4;
export const LESSON_MIN_EXERCISES = 5;
export const LESSON_MAX_EXERCISES = 8;
/** Lessons a person may build in a Rome day: a bound on the table, far above any real use. */
export const LESSONS_PER_DAY = 20;
/** The cards read to draw a lesson from. */
const CARDS_READ = 300;

export type Esercizio =
  | { tipo: 'scelta'; domanda: string; opzioni: string[]; giusta: number }
  | { tipo: 'vero-falso'; domanda: string; affermazione: string; giusta: boolean }
  | { tipo: 'abbina'; norme: string[]; istituti: string[]; giusta: number[] }
  | { tipo: 'completa'; domanda: string; testo: string; opzioni: string[]; giusta: number };

export interface Esito {
  indice: number;
  giusta: boolean;
}

interface LessonCard {
  domanda: string;
  risposta: string;
  istituto: string;
  norma: string | null;
}

type Rand = (n: number) => number;
const defaultRand: Rand = (n) => randomInt(n);

function shuffle<T>(items: readonly T[], rand: Rand): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** «art. 1453 codice civile» from an anchor's keys (`lingo/anchors.ts`: `art_1453`, `codice_civile`). */
export function normLabel(normaKey: string, articleId: string): string {
  const article = articleId.replace(/^.*?art_/, '').replace(/_/g, ' ');
  return `art. ${article} ${normaKey.replace(/_/g, ' ')}`;
}

/** Up to `n` texts of `pool` different from `exclude` and from each other (case and spaces aside). */
function others(pool: readonly string[], exclude: string, n: number, rand: Rand): string[] {
  const key = (t: string) => t.trim().toLowerCase();
  const seen = new Set([key(exclude)]);
  const out: string[] = [];
  for (const text of shuffle(pool, rand)) {
    if (out.length === n) break;
    if (seen.has(key(text))) continue;
    seen.add(key(text));
    out.push(text);
  }
  return out;
}

/** Four options with the right one at a random place, or null without three distinct others. */
function choices(right: string, pool: readonly string[], rand: Rand): { opzioni: string[]; giusta: number } | null {
  const wrong = others(pool, right, 3, rand);
  if (wrong.length < 3) return null;
  const opzioni = shuffle([right, ...wrong], rand);
  return { opzioni, giusta: opzioni.indexOf(right) };
}

const WORD = /[A-Za-zÀ-ÖØ-öø-ÿ]{6,}/g;
const wordsOf = (text: string) => text.match(WORD) ?? [];

function multipleChoice(card: LessonCard, cards: LessonCard[], rand: Rand): Esercizio | null {
  const options = choices(card.risposta, cards.map((c) => c.risposta), rand);
  return options && { tipo: 'scelta', domanda: card.domanda, ...options };
}

function trueFalse(card: LessonCard, cards: LessonCard[], rand: Rand): Esercizio | null {
  if (rand(2) === 0) return { tipo: 'vero-falso', domanda: card.domanda, affermazione: card.risposta, giusta: true };
  const [other] = others(cards.map((c) => c.risposta), card.risposta, 1, rand);
  return other ? { tipo: 'vero-falso', domanda: card.domanda, affermazione: other, giusta: false } : null;
}

/** The card's answer with one of its words taken out, to choose among four words of the subject's answers. */
function fillIn(card: LessonCard, cards: LessonCard[], rand: Rand): Esercizio | null {
  const words = wordsOf(card.risposta);
  if (words.length === 0) return null;
  const word = words[rand(words.length)];
  const options = choices(word, cards.flatMap((c) => wordsOf(c.risposta)), rand);
  if (!options) return null;
  // The word alone, not inside a longer one («regola» in «regolare»).
  const testo = card.risposta.replace(new RegExp(`(?<![A-Za-zÀ-ÖØ-öø-ÿ])${word}(?![A-Za-zÀ-ÖØ-öø-ÿ])`), '_____');
  return { tipo: 'completa', domanda: card.domanda, testo, ...options };
}

/** Three cards with different articles and institutes: each article to its institute. */
function match(cards: LessonCard[], rand: Rand): Esercizio | null {
  const picked: LessonCard[] = [];
  for (const card of shuffle(cards, rand)) {
    if (picked.length === 3) break;
    if (!card.norma || picked.some((p) => p.norma === card.norma || p.istituto === card.istituto)) continue;
    picked.push(card);
  }
  if (picked.length < 3) return null;
  const istituti = shuffle(picked.map((p) => p.istituto), rand);
  return { tipo: 'abbina', norme: picked.map((p) => p.norma!), istituti, giusta: picked.map((p) => istituti.indexOf(p.istituto)) };
}

const BUILDERS = [multipleChoice, trueFalse, fillIn] as const;

/**
 * The exercises of one lesson from the subject's cards (at least `LESSON_MIN_CARDS`): one match when three cards allow
 * it, then a card per exercise in a shuffled order, each kind in turn and the next kind when one cannot be built; a
 * card comes round again until five exercises are there. Pure but for `rand`.
 */
export function buildExercises(cards: LessonCard[], rand: Rand = defaultRand): Esercizio[] {
  const out: Esercizio[] = [];
  const paired = match(cards, rand);
  if (paired) out.push(paired);
  const target = Math.min(LESSON_MAX_EXERCISES, Math.max(LESSON_MIN_EXERCISES, cards.length + out.length));
  const order = shuffle(cards, rand);
  for (let i = 0; out.length < target && i < order.length * BUILDERS.length; i++) {
    const card = order[i % order.length];
    for (let k = 0; k < BUILDERS.length; k++) {
      const built = BUILDERS[(i + k) % BUILDERS.length](card, cards, rand);
      if (built) {
        out.push(built);
        break;
      }
    }
  }
  return shuffle(out, rand);
}

/** What the browser sees of an exercise: everything but its key. */
function publicExercise(exercise: Esercizio) {
  const { giusta: _key, ...shown } = exercise;
  return shown;
}

export async function createLesson(userId: string, materia: LingoMateria) {
  const today = romeDay(new Date());
  const built = await prisma.$transaction(async (tx) => {
    // The person's row first, as every Learn write does (an account's deletion). Two creations racing may pass the
    // count together: one lesson over the bound, harmless.
    const user = await tx.$queryRaw<unknown[]>`SELECT 1 FROM users WHERE id = ${userId} FOR KEY SHARE`;
    if (user.length !== 1) throw new AppError(404, 'Utente non trovato.');
    if ((await tx.lingoLezione.count({ where: { utenteId: userId, giorno: dayToDate(today) } })) >= LESSONS_PER_DAY) {
      throw new AppError(429, `Hai già fatto ${LESSONS_PER_DAY} lezioni oggi: riprendi domani.`);
    }
    const { materieComunita } = await readPreferences(tx, userId);
    const rows = await tx.lingoCard.findMany({
      // Validated cards only (L-67): never a draft, not even one's own.
      where: { AND: [reviewScope(userId, materieComunita, await courseDayFor(tx, today), materia), { stato: 'VALIDATA' }] },
      select: { domanda: true, risposta: true, istituto: true, ancore: { where: { isPrimary: true }, select: { normaKey: true, articleId: true }, take: 1 } },
      // shortcut: the first CARDS_READ by id, shuffled after; a random sample in SQL if a subject ever holds more.
      orderBy: { id: 'asc' },
      take: CARDS_READ,
    });
    if (rows.length < LESSON_MIN_CARDS) {
      throw new AppError(409, `Per una lezione servono almeno ${LESSON_MIN_CARDS} schede validate in questa materia (ne hai ${rows.length}).`);
    }
    const cards = rows.map((r) => ({ domanda: r.domanda, risposta: r.risposta, istituto: r.istituto, norma: r.ancore[0] ? normLabel(r.ancore[0].normaKey, r.ancore[0].articleId) : null }));
    const esercizi = buildExercises(cards);
    if (esercizi.length < LESSON_MIN_EXERCISES) {
      throw new AppError(409, 'Le schede di questa materia sono troppo simili tra loro per una lezione: servono risposte diverse.');
    }
    return tx.lingoLezione.create({ data: { utenteId: userId, giorno: dayToDate(today), materia, esercizi: esercizi as unknown as Prisma.InputJsonValue } });
  });
  return { id: built.id, materia: built.materia, esercizi: (built.esercizi as unknown as Esercizio[]).map(publicExercise) };
}

/** Whether `risposta` has the shape the exercise asks for; a shape it does not is a 400. */
function shapeFits(exercise: Esercizio, risposta: unknown): boolean {
  if (exercise.tipo === 'vero-falso') return typeof risposta === 'boolean';
  if (exercise.tipo === 'abbina') {
    return Array.isArray(risposta) && risposta.length === exercise.norme.length && risposta.every((r) => Number.isInteger(r) && r >= 0 && r < exercise.istituti.length);
  }
  return Number.isInteger(risposta) && (risposta as number) >= 0 && (risposta as number) < exercise.opzioni.length;
}

const isRight = (exercise: Esercizio, risposta: unknown) =>
  exercise.tipo === 'abbina' ? exercise.giusta.every((g, i) => (risposta as number[])[i] === g) : exercise.giusta === risposta;

export interface LessonAnswer {
  registrata: boolean;
  indice: number;
  giusta: boolean;
  soluzione: Esercizio['giusta'];
  /** With the answer that ended the lesson: the right ones, the total, and what the server credited. */
  fine?: { giuste: number; totale: number; xp: XpEsito };
}

/**
 * Grades one answer and stores its outcome; a second answer to the same exercise changes nothing (`registrata:
 * false`, the stored outcome). The answer that completes the lesson ends it and settles «Lezione», under the lesson's
 * lock, so two last answers racing end it once.
 */
export async function answerLesson(userId: string, lessonId: string, indice: number, risposta: unknown): Promise<LessonAnswer> {
  const today = romeDay(new Date());
  return prisma.$transaction(async (tx) => {
    // The person's row before the lesson's, as the reads that settle missions take it (an account's deletion).
    const user = await tx.$queryRaw<unknown[]>`SELECT 1 FROM users WHERE id = ${userId} FOR KEY SHARE`;
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM lingo_lezioni WHERE id = ${lessonId} AND utente_id = ${userId} FOR UPDATE`;
    if (user.length !== 1 || locked.length !== 1) throw new AppError(404, 'Lezione non trovata.');
    const lesson = await tx.lingoLezione.findUniqueOrThrow({ where: { id: lessonId } });
    const esercizi = lesson.esercizi as unknown as Esercizio[];
    const esiti = lesson.esiti as unknown as Esito[];
    if (indice >= esercizi.length) throw new AppError(400, 'Esercizio non trovato in questa lezione.');
    const exercise = esercizi[indice];
    if (!shapeFits(exercise, risposta)) throw new AppError(400, 'La risposta non è nella forma di questo esercizio.');
    const stored = esiti.find((e) => e.indice === indice);
    if (stored) {
      // A lesson already ended says its end again (a last answer whose response was lost, sent once more), with what
      // the ledger holds for it — never a credit assumed.
      if (!lesson.finitaIl) return { registrata: false, indice, giusta: stored.giusta, soluzione: exercise.giusta };
      const credit = await tx.lingoCreditoXp.findFirst({ where: { missione: 'LEZIONE', fonteId: lessonId }, select: { punti: true } });
      const xp: XpEsito = { crediti: credit ? [{ missione: 'lezione', punti: credit.punti }] : [], livello: await levelNow(tx, userId, today), nuovoLivello: false };
      return { registrata: false, indice, giusta: stored.giusta, soluzione: exercise.giusta, fine: { giuste: esiti.filter((e) => e.giusta).length, totale: esercizi.length, xp } };
    }

    const giusta = isRight(exercise, risposta);
    const next = [...esiti, { indice, giusta }];
    const ends = next.length === esercizi.length;
    await tx.lingoLezione.update({
      where: { id: lessonId },
      data: { esiti: next as unknown as Prisma.InputJsonValue, ...(ends ? { finitaIl: new Date() } : {}) },
    });
    if (!ends) return { registrata: true, indice, giusta, soluzione: exercise.giusta };
    const xp = await settleMissions(tx, userId, today, { tipo: 'lezione', lezioneId: lessonId, materia: lesson.materia });
    return { registrata: true, indice, giusta, soluzione: exercise.giusta, fine: { giuste: next.filter((e) => e.giusta).length, totale: esercizi.length, xp } };
  });
}
