import type { LingoCardStato, LingoFonteXp, LingoMateria, LingoMissione } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { vi } from 'vitest';
import { request, app, prisma, createTestUser, type TestUser } from './helpers';
import { startOfRomeDay } from '../src/lingo/studyDay';

// Shared by the Gymnasium XP suites (spec 2026-10-20-gymnasium-xp-levels). «Today» is the Rome day of the
// server's clock, so the clock is moved with fake Dates (timers stay real), and tokens outlive the jumps.

export const PROGRESS = '/api/lingo/srs/progressi';
export const SESSION = '/api/lingo/srs/sessione';
export const GRADE = '/api/lingo/srs/revisioni';
export const PREFS = '/api/lingo/srs/preferenze';

export function setClock(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

export type Headers = { Authorization: string };

/** A token signed for 90 days: the clock jumps days in these suites. */
export function session(user: TestUser, jti = 'xp'): Headers {
  const token = jwt.sign({ userId: user.id, email: user.email, type: 'access' }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '90d', jwtid: jti });
  return { Authorization: `Bearer ${token}` };
}

let sequence = 0;
export async function card(author: TestUser | null, materia: LingoMateria = 'DIRITTO_CIVILE', stato: LingoCardStato = 'BOZZA_PERSONALE') {
  sequence += 1;
  return prisma.lingoCard.create({
    data: {
      autoreId: author?.id ?? null,
      materia,
      istituto: `Istituto ${sequence}`,
      domanda: `Domanda ${sequence}?`,
      risposta: `Risposta ${sequence}.`,
      stato,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence % 60, Math.floor(sequence / 60))),
    },
  });
}

export async function cards(author: TestUser, n: number, materia: LingoMateria = 'DIRITTO_CIVILE') {
  const made = [];
  for (let i = 0; i < n; i++) made.push(await card(author, materia));
  return made;
}

/** A review state due on `dueDay`, last reviewed at `lastReviewAt` (interval = the days between). */
export function reviewed(user: TestUser, cardId: string, dueDay: string, lastReviewAt: Date) {
  return prisma.lingoStatoRipasso.create({
    data: { utenteId: user.id, cardId, stability: 8.2, difficulty: 4.1, dueAt: startOfRomeDay(dueDay), lastReviewAt, reps: 2 },
  });
}

/** A review log row written by hand (the history of a subject). */
export function logged(user: TestUser, cardId: string, at: string) {
  return prisma.lingoRevisioneSRS.create({
    data: { utenteId: user.id, cardId, dataRevisione: new Date(at), rating: 3, scheduledDays: 1, stability: 1, difficulty: 5 },
  });
}

export function storedDay(user: TestUser, day: string, over: { ripassi?: number; nuove?: number; valido?: boolean; codaFinita?: boolean; voti?: number } = {}) {
  return prisma.lingoGiornataStudio.create({
    data: { utenteId: user.id, giorno: new Date(`${day}T00:00:00Z`), ripassi: over.ripassi ?? 0, nuove: over.nuove ?? 0, valido: over.valido ?? false, codaFinita: over.codaFinita ?? false, voti: over.voti ?? 0 },
  });
}

export function preferences(user: TestUser, data: { nuoveAlGiorno?: number; ripassiAlGiorno?: number; materieComunita?: LingoMateria[] }) {
  return prisma.lingoPreferenzeStudio.upsert({ where: { utenteId: user.id }, create: { utenteId: user.id, ...data }, update: data });
}

export const grade = (h: Headers, cardId: string, rating: 1 | 2 | 3 | 4 = 3) => request(app).post(GRADE).set(h).send({ cardId, rating });
export const progress = (h: Headers, materia?: LingoMateria) => request(app).get(materia ? `${PROGRESS}?materia=${materia}` : PROGRESS).set(h);

/** Grades every card once, in order, and returns the answers. */
export async function gradeAll(h: Headers, ids: string[], rating: 1 | 2 | 3 | 4 = 3) {
  const answers = [];
  for (const id of ids) answers.push(await grade(h, id, rating));
  return answers;
}

export async function makeValidator(name: string) {
  const user = await createTestUser(name);
  await prisma.user.update({ where: { id: user.id }, data: { lingoValidatore: true } });
  return user;
}

const notice = () => prisma.lingoTestoVersione.findFirstOrThrow({ where: { chiave: 'PROPOSTA_SCHEDA' }, orderBy: { versione: 'desc' } });
/** Proposes the card, accepting the current notice in the same call. */
export async function propose(h: Headers, id: string) {
  return request(app).post(`/api/lingo/cards/${id}/proponi`).set(h).send({ accettoTestoId: (await notice()).id });
}
export const withdraw = (h: Headers, id: string) => request(app).post(`/api/lingo/cards/${id}/ritira`).set(h);
export const vote = (h: Headers, id: string, giudizio: 'APPROVATA' | 'MIGLIORABILE' | 'ERRATA' = 'APPROVATA') =>
  request(app).post(`/api/lingo/validazione/${id}`).set(h).send(giudizio === 'APPROVATA' ? { giudizio } : { giudizio, motivazione: 'Da rivedere.' });

/** The user's credits, oldest first. */
export function credits(user: TestUser) {
  return prisma.lingoCreditoXp.findMany({ where: { utenteId: user.id }, orderBy: [{ createdAt: 'asc' }, { missione: 'asc' }] });
}

/** A credit written by hand (a past the test needs). */
export function creditByHand(user: TestUser, missione: LingoMissione, periodo: string, giorno: string, punti: number, fonte: LingoFonteXp = 'LETTURA', fonteId: string | null = null) {
  return prisma.lingoCreditoXp.create({ data: { utenteId: user.id, missione, periodo, giorno: new Date(`${giorno}T00:00:00Z`), punti, fonte, fonteId } });
}

export { request, app, prisma, createTestUser, type TestUser };
