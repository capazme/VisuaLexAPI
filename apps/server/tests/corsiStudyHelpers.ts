import { CORSI, app, prisma, request, type Headers } from './corsiHelpers';
import type { TestUser } from './helpers';
import { startOfRomeDay } from '../src/lingo/studyDay';

// Shared by the Percorsi study suites (spec 2026-10-23, S2): a module studied through the routes, and a course
// card's grades written by hand (the review log is what mastery reads).

export const moduleUrl = (corsoId: string, moduloId: string) => `${CORSI}/${corsoId}/moduli/${moduloId}`;

export const answer = (h: Headers, corsoId: string, moduloId: string, domandaId: string, scelta: string) =>
  request(app).post(`${moduleUrl(corsoId, moduloId)}/risposte`).set(h).send({ domandaId, scelta });

type Item = { id: string; tipo: string } & Record<string, unknown>;

/** The module read, with `domande`: its items flat, in the order recall, quiz, open question. */
export async function readModule(h: Headers, corsoId: string, moduloId: string) {
  const read = await request(app).get(moduleUrl(corsoId, moduloId)).set(h);
  if (read.status !== 200) throw new Error(`module read: ${read.status} ${JSON.stringify(read.body)}`);
  const body = read.body as { blocchi: { richiamo: Item[] }[]; quiz: Item[]; domandaAperta: Item | null } & Record<string, unknown>;
  const domande = [...body.blocchi.flatMap((b) => b.richiamo), ...body.quiz, ...(body.domandaAperta ? [body.domandaAperta] : [])];
  return { ...body, domande };
}

/** Answers the module's quiz: the first `wrong` items with «b» (wrong in the fixtures), the rest with «a». */
export async function answerQuiz(h: Headers, corsoId: string, moduloId: string, wrong = 0) {
  const quiz = (await readModule(h, corsoId, moduloId)).domande.filter((d) => d.tipo === 'QUIZ');
  for (const [i, d] of quiz.entries()) {
    const res = await answer(h, corsoId, moduloId, d.id, i < wrong ? 'b' : 'a');
    if (res.status !== 200) throw new Error(`answer: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return quiz;
}

export const finish = (h: Headers, corsoId: string, moduloId: string, body: Record<string, unknown> = {}) =>
  request(app).post(`${moduleUrl(corsoId, moduloId)}/fine`).set(h).send(body);

/** The quiz answered (`wrong` of them wrong) and the module ended. */
export async function studyModule(h: Headers, corsoId: string, moduloId: string, wrong = 0) {
  await answerQuiz(h, corsoId, moduloId, wrong);
  const done = await finish(h, corsoId, moduloId);
  if (done.status !== 200) throw new Error(`fine: ${done.status} ${JSON.stringify(done.body)}`);
  return done.body;
}

/** The course's cards tagged with the competence `codice`, oldest first. */
export async function cardsOf(corsoId: string, codice: string) {
  return prisma.lingoCard.findMany({
    where: { competenze: { some: { competenza: { corsoId, codice } } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

/**
 * One grade per card of `cards` at `at` (an instant), as the grade route would leave them: a log row and the review
 * state, due `dueInDays` Rome days later. `rights[i]` false is «Di nuovo».
 */
export async function gradeByHand(user: TestUser, cards: { id: string }[], at: string, rights: boolean[], dueInDays = 30) {
  const when = new Date(at);
  for (const [i, card] of cards.entries()) {
    const rating = rights[i] === false ? 1 : 3;
    await prisma.lingoRevisioneSRS.create({
      data: { utenteId: user.id, cardId: card.id, dataRevisione: when, rating, scheduledDays: dueInDays, stability: 8, difficulty: 5 },
    });
    const day = when.toISOString().slice(0, 10);
    const state = { stability: 8, difficulty: 5, dueAt: startOfRomeDay(day, dueInDays), lastReviewAt: when };
    await prisma.lingoStatoRipasso.upsert({
      where: { utenteId_cardId: { utenteId: user.id, cardId: card.id } },
      create: { utenteId: user.id, cardId: card.id, ...state, reps: 1 },
      update: { ...state, reps: { increment: 1 } },
    });
  }
}

/** The ledger's credits of a user for a mission of the courses. */
export const courseCredits = (user: TestUser) =>
  prisma.lingoCreditoXp.findMany({ where: { utenteId: user.id, missione: { in: ['MODULO', 'PERCORSO'] } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
