import { LingoMateria, Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { hasNoNul } from '../lingo/noNul';
import { readProgress } from '../lingo/progress';
import { readPercorso } from '../lingo/percorso';
import { previewIntervals, reviewScope } from '../lingo/reviewQueue';
import { serialize } from '../lingo/serializeCard';
import { computeStreak } from '../lingo/streak';
import { countedDays, markQueueFinished, recordGradeDay, recountToday } from '../lingo/studyDays';
import { answerPreferences, readPreferences } from '../lingo/studyPreferences';
import { daysBetween, romeDay, startOfRomeDay } from '../lingo/studyDay';
import { dueWhere, introducedToday, newCardsWhere, queueFinished } from '../lingo/todayQueue';
import { review } from '../srs/fsrsEngine';

/**
 * The review of study cards (Studia PR C, spec §5): today's session, a grade,
 * the study preferences, and the progress dashboard's read (Studia progress
 * spec §5). For the user's session only: nothing here is in the delegated
 * table, so an exchanged token answers 403.
 *
 * Time is the Europe/Rome calendar day (`lingo/studyDay.ts`), read from the
 * server's clock and never from the browser's. `LingoStatoRipasso.dueAt` is 00:00
 * Rome of the day a card is due, so «due today» is `dueAt` before the start of
 * tomorrow. Only the first grade of a card in a day is recorded.
 */
const router = Router();
router.use(authenticate);

/** The most due cards one session carries; `conteggi.dovute` stays the exact count. */
const MAX_DUE_PER_SESSION = 500;
const MAX_COMMUNITY_SUBJECTS = Object.keys(LingoMateria).length;

const subjectQuerySchema = z.object({ materia: z.nativeEnum(LingoMateria).optional() });
const sessionSchema = z
  .object({
    materia: z.nativeEnum(LingoMateria).optional(),
    istituto: z
      .string({ invalid_type_error: 'Istituto non valido.' })
      .trim()
      .min(1, 'L’istituto non può essere vuoto.')
      .max(200, 'L’istituto è troppo lungo (al massimo 200 caratteri).')
      .refine(hasNoNul, { message: 'L’istituto contiene un carattere non valido.' })
      .optional(),
  })
  .refine((query) => query.istituto === undefined || query.materia !== undefined, {
    message: 'L’istituto richiede la materia.',
    path: ['istituto'],
  });
const gradeSchema = z
  .object({
    cardId: z.string().min(1).max(64).refine(hasNoNul, { message: 'Identificativo non valido.' }),
    rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    durataMs: z.number().int().min(0).max(3_600_000).optional(),
  })
  .strict();
const preferencesSchema = z
  .object({
    nuoveAlGiorno: z.number().int().min(1).max(200).optional(),
    ripassiAlGiorno: z.number().int().min(1).max(200).optional(),
    materieComunita: z.array(z.nativeEnum(LingoMateria)).max(MAX_COMMUNITY_SUBJECTS).optional(),
  })
  .strict();

const cardNotFound = () => new AppError(404, 'Scheda non trovata.');

// `?materia=` narrows the session to a subject; `?istituto=` (only with `materia`) to one institute of it, matched
// exactly as `/percorso` lists it. Either way the day's queue is not marked finished.
router.get('/sessione', async (req, res) => {
  const userId = req.user!.id;
  const { materia, istituto } = sessionSchema.parse(req.query);
  const today = romeDay(new Date());

  const { nuoveAlGiorno, materieComunita } = await readPreferences(prisma, userId);
  const scope = reviewScope(userId, materieComunita, materia, istituto);

  const due = dueWhere(userId, scope, today);
  const [dovute, dueRows, introduced] = await Promise.all([
    prisma.lingoStatoRipasso.count({ where: due }),
    prisma.lingoStatoRipasso.findMany({
      where: due,
      include: { card: { include: { ancore: true } } },
      orderBy: [{ dueAt: 'asc' }, { cardId: 'asc' }],
      take: MAX_DUE_PER_SESSION,
    }),
    introducedToday(prisma, userId, today),
  ]);

  const newSlots = Math.max(0, nuoveAlGiorno - introduced);
  const newCards = newSlots === 0
    ? []
    : await prisma.lingoCard.findMany({
        where: newCardsWhere(userId, scope),
        include: { ancore: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: newSlots,
      });
  // Nothing left in the whole queue (not just in one subject or institute): today counts (Studia progress spec D7).
  if (!materia && dovute === 0 && newCards.length === 0 && (await queueFinished(prisma, userId, today))) {
    await markQueueFinished(prisma, userId, today);
  }

  const cards = [
    ...dueRows.map(({ card, ...state }) => {
      // A clock set back since the last review must not make the elapsed time negative.
      const elapsed = Math.max(0, daysBetween(romeDay(state.lastReviewAt), today));
      return { ...serialize(card), nuova: false, comunita: card.autoreId !== userId, anteprima: previewIntervals(state, elapsed) };
    }),
    ...newCards.map((card) => ({ ...serialize(card), nuova: true, comunita: card.autoreId !== userId, anteprima: previewIntervals(null, 0) })),
  ];
  res.json({ conteggi: { dovute, nuove: newCards.length }, cards });
});

router.post('/revisioni', async (req, res) => {
  const userId = req.user!.id;
  const { cardId, rating, durataMs } = gradeSchema.parse(req.body);
  const now = new Date();
  const today = romeDay(now);

  const answer = await prisma.$transaction(async (tx) => {
    // Two first grades of one card racing must not both insert, and the state row may not exist yet,
    // so FOR UPDATE cannot lock it: serialise on the pair itself.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}::text || ':' || ${cardId}::text))`;

    // Lock the card's row against deletion and key changes (what the state row's foreign key needs): the trash
    // deletes under FOR UPDATE, so a grade racing it waits, then finds no card (404) instead of a foreign-key error.
    const present = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM lingo_cards WHERE id = ${cardId} FOR KEY SHARE`;
    if (present.length !== 1) throw cardNotFound();

    // The scope is read with the user's current preferences: a card that left the pool since the session was fetched is refused.
    const { materieComunita } = await readPreferences(tx, userId);
    const inScope = await tx.lingoCard.findFirst({ where: { AND: [{ id: cardId }, reviewScope(userId, materieComunita)] }, select: { id: true } });
    if (!inScope) throw cardNotFound();

    const previous = await tx.lingoStatoRipasso.findUnique({ where: { utenteId_cardId: { utenteId: userId, cardId } } });
    if (previous && romeDay(previous.lastReviewAt) === today) {
      const dueDay = romeDay(previous.dueAt);
      return { registrata: false, prossimoRipasso: dueDay, scheduledDays: daysBetween(today, dueDay), day: null };
    }

    const elapsedDays = previous ? Math.max(0, daysBetween(romeDay(previous.lastReviewAt), today)) : 0;
    // `previous` is the user's state of the card, so no state means its first review ever (spec §5.1 «nuove»).
    const result = review(previous, rating, elapsedDays);
    const dueAt = startOfRomeDay(today, result.scheduledDays);
    const lapse = rating === 1 && previous ? 1 : 0;
    await tx.lingoStatoRipasso.upsert({
      where: { utenteId_cardId: { utenteId: userId, cardId } },
      create: { utenteId: userId, cardId, stability: result.stability, difficulty: result.difficulty, dueAt, lastReviewAt: now, reps: 1, lapses: 0 },
      update: { stability: result.stability, difficulty: result.difficulty, dueAt, lastReviewAt: now, reps: (previous?.reps ?? 0) + 1, lapses: (previous?.lapses ?? 0) + lapse },
    });
    await tx.lingoRevisioneSRS.create({
      data: {
        utenteId: userId,
        cardId,
        dataRevisione: now,
        rating,
        scheduledDays: result.scheduledDays,
        stability: result.stability,
        difficulty: result.difficulty,
        durataMs: durataMs ?? null,
      },
    });
    const day = await recordGradeDay(tx, userId, today, { isNew: !previous, wrong: rating === 1 });
    return { registrata: true, prossimoRipasso: romeDay(dueAt), scheduledDays: result.scheduledDays, day };
  }).catch((error: unknown) => {
    // Belt: a card that vanished under the insert is a missing card, never a 500.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') throw cardNotFound();
    throw error;
  });
  const { day, ...recorded } = answer;
  if (day === null) {
    res.json(recorded);
    return;
  }
  const serie = computeStreak(await countedDays(prisma, userId), today, day.after).attuale;
  res.json({
    ...recorded,
    // What the session needs to celebrate the goal at the grade that closes it (Studia progress spec §5.3).
    oggi: { giorno: today, ripassi: day.ripassi, obiettivo: day.obiettivo, raggiunto: day.after, appenaRaggiunto: day.after && !day.before, serie },
  });
});

// Everything the Studia dashboard draws, in one read (Studia progress spec §5.2).
router.get('/progressi', async (req, res) => {
  const { materia } = subjectQuerySchema.parse(req.query);
  res.json(await readProgress(req.user!.id, materia));
});

// The user's review scope counted by institute, for the road of a subject (Gymnasium restyle spec §6, G5).
// Each stop: `nuove` never reviewed, `apprendimento` / `consolidate` reviewed with an interval under / at least
// `CONSOLIDATED_DAYS`, `dovute` reviewed and due by the end of today in Rome (a subset of the last two).
// Same scope as the session, `?materia=` optional. Definitions: `lingo/percorso.ts`.
const percorsoSchema = z.object({ materia: z.nativeEnum(LingoMateria, { errorMap: () => ({ message: 'Materia non valida.' }) }).optional() });
router.get('/percorso', async (req, res) => {
  const { materia } = percorsoSchema.parse(req.query);
  res.json(await readPercorso(req.user!.id, materia));
});

router.get('/preferenze', async (req, res) => {
  res.json(await readPreferences(prisma, req.user!.id));
});

router.put('/preferenze', async (req, res) => {
  const userId = req.user!.id;
  const { nuoveAlGiorno, ripassiAlGiorno, materieComunita } = preferencesSchema.parse(req.body);
  const data = {
    ...(nuoveAlGiorno !== undefined ? { nuoveAlGiorno } : {}),
    ...(ripassiAlGiorno !== undefined ? { ripassiAlGiorno } : {}),
    ...(materieComunita !== undefined ? { materieComunita: [...new Set(materieComunita)] } : {}),
  };
  const row = await prisma.lingoPreferenzeStudio.upsert({
    where: { utenteId: userId },
    create: { utenteId: userId, ...data },
    update: data,
  });
  // Today counts by the goal as it now stands; the past days stay as they were (spec §5.1).
  if (ripassiAlGiorno !== undefined) await recountToday(prisma, userId, romeDay(new Date()), row.ripassiAlGiorno);
  res.json(answerPreferences(row));
});

export default router;
