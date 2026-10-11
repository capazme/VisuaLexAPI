import { LingoGiudizio, LingoMateria, Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { hasNoNul } from '../lingo/noNul';
import { serialize } from '../lingo/serializeCard';
import { stateAfterVotes } from '../lingo/validationRule';

/**
 * Validating the community's cards (spec §5, decisions 12–15). Only a
 * validator, read from the database on every call, sees the queue or votes.
 * The queue never carries the author; a vote is one per validator and card,
 * and the card's state is decided in the same transaction by
 * `stateAfterVotes`. For the user's session only: not in the delegated table.
 */
const router = Router();
router.use(authenticate);
router.param('cardId', (_req, _res, next, id: string) => next(hasNoNul(id) ? undefined : new AppError(404, 'Scheda non in attesa di validazione.')));

const querySchema = z.object({
  materia: z.nativeEnum(LingoMateria).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

// The reason is trimmed; it may be empty only for an approval (checked below).
const voteSchema = z
  .object({
    giudizio: z.nativeEnum(LingoGiudizio),
    motivazione: z.string().trim().max(2000).refine(hasNoNul, { message: 'Il motivo contiene un carattere non valido.' }).optional(),
  })
  .strict()
  .refine((vote) => vote.giudizio === 'APPROVATA' || (vote.motivazione ?? '').length > 0, {
    message: 'Scrivi il motivo del tuo giudizio.',
    path: ['motivazione'],
  });

const NOT_VALIDATOR = 'Solo i validatori possono votare le schede.';

router.get('/coda', async (req, res) => {
  const { materia, limit } = querySchema.parse(req.query);
  const me = req.user!.id;
  const voter = await prisma.user.findUnique({ where: { id: me }, select: { lingoValidatore: true } });
  if (!voter?.lingoValidatore) throw new AppError(403, NOT_VALIDATOR);
  const where: Prisma.LingoCardWhereInput = {
    stato: 'PROPOSTA_COMMUNITY',
    // A card whose author's account is gone has a null author: it is still to be validated.
    // (`autoreId: { not }` alone would drop it, as SQL's <> does with NULL.)
    OR: [{ autoreId: null }, { autoreId: { not: me } }],
    validazioni: { none: { utenteId: me } },
    ...(materia ? { materia } : {}),
  };
  const cards = await prisma.lingoCard.findMany({
    where,
    include: { ancore: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
  });
  res.json({ cards: cards.map(serialize) });
});

router.post('/:cardId', async (req, res) => {
  const { giudizio, motivazione } = voteSchema.parse(req.body);
  const { cardId } = req.params;
  const me = req.user!.id;
  try {
    const stato = await prisma.$transaction(async (tx) => {
      const voter = await tx.user.findUnique({ where: { id: me }, select: { lingoValidatore: true } });
      if (!voter?.lingoValidatore) throw new AppError(403, NOT_VALIDATOR);
      // The row is locked: two votes on the same card, or a vote and a withdrawal, take turns.
      const [card] = await tx.$queryRaw<{ autore_id: string | null; stato: string }[]>`
        SELECT autore_id, stato FROM lingo_cards WHERE id = ${cardId} FOR UPDATE`;
      if (!card || card.stato !== 'PROPOSTA_COMMUNITY') throw new AppError(404, 'Scheda non in attesa di validazione.');
      if (card.autore_id === me) throw new AppError(403, 'Non puoi validare una tua scheda.');
      const already = await tx.lingoValidazioneCard.findFirst({ where: { cardId, utenteId: me } });
      if (already) throw new AppError(409, 'Hai già votato questa scheda.');
      await tx.lingoValidazioneCard.create({ data: { cardId, utenteId: me, giudizio, motivazione: motivazione || null } });
      const votes = await tx.lingoValidazioneCard.findMany({ where: { cardId }, select: { giudizio: true } });
      const next = stateAfterVotes(votes.map((v) => v.giudizio));
      if (next !== card.stato) await tx.lingoCard.update({ where: { id: cardId }, data: { stato: next } });
      return next;
    });
    res.json({ stato });
  } catch (error) {
    // The unique key (card, validator) is the last word on a duplicate vote.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError(409, 'Hai già votato questa scheda.');
    throw error;
  }
});

export default router;
