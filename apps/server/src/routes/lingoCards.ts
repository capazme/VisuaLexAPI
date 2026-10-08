import { LingoCardStato, LingoCardTipo, LingoMateria, type Prisma } from '@prisma/client';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { createLingoCard } from '../lingo/cards';
import { hasNoNul } from '../lingo/noNul';
import { cardInputSchema, planCards } from '../lingo/planCards';
import { serialize } from '../lingo/serializeCard';
import { lingoCardCreateSchema } from '../schemas/lingo/card';
import { trashLingoCards } from '../trash/trash';

/**
 * Study cards for their author (MCP second round, spec §6; the spike plan's
 * Task 12). A card is always the author's own draft (`createLingoCard`); its
 * anchors are given as references («art. 1453 c.c.»), resolved and checked
 * like the dossier's norms, and anchored with the official URN and the
 * fingerprint the Python API computes (`lingo/anchors.ts`): the caller never
 * handles a hash. A card with an anchor that cannot be verified is refused,
 * and the others in the call go on. Creating, listing, reading and moving to
 * the trash are open to the user's session and to exchanged tokens
 * (`lingo:cards:read` / `lingo:cards:write`, `content:delete`); editing a
 * draft is for the session only. Only the user's personal cards go to the
 * trash (drafts, archived: what account deletion removes too).
 */
const router = Router();
router.use(authenticate);
// An id with a NUL byte names no card (and would be a 500 in the database).
router.param('id', (_req, _res, next, id: string) => next(hasNoNul(id) ? undefined : new AppError(404, 'Scheda non trovata.')));

export const MAX_CARDS_PER_CALL = 10;
/** Distinct anchor references checked against the sources in one call, as a cost cap (each one is fetched). */
export const MAX_REFERENCES_PER_CALL = 20;

const createSchema = z
  .object({ cards: z.array(cardInputSchema).min(1).max(MAX_CARDS_PER_CALL) })
  .strict()
  .refine((body) => new Set(body.cards.flatMap((card) => card.ancore.map((a) => a.riferimento))).size <= MAX_REFERENCES_PER_CALL, {
    message: `Al massimo ${MAX_REFERENCES_PER_CALL} riferimenti diversi per chiamata.`,
  });
const listSchema = z.object({
  materia: z.nativeEnum(LingoMateria).optional(),
  stato: z.nativeEnum(LingoCardStato).optional(),
  tipo: z.nativeEnum(LingoCardTipo).optional(),
  normaKey: z.string().max(100).regex(/^[a-z0-9]+(_[a-z0-9]+)*$/).optional(),
  q: z.string().trim().min(1).max(100).refine(hasNoNul, { message: 'Il testo contiene un carattere non valido.' }).optional(),
  origine: z.literal('applicazione').optional(),
  ordine: z.enum(['recenti', 'materia']).default('recenti'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
const trashSchema = z.object({ cardIds: z.array(z.string().min(1).max(64).refine(hasNoNul, { message: 'Identificativo non valido.' })).min(1).max(MAX_CARDS_PER_CALL) }).strict();

router.post('/', async (req, res) => {
  const { cards } = createSchema.parse(req.body);
  const { planned, failures, allTransient } = await planCards(cards);

  // Sources down for every reference: nothing could be checked, so nothing is written or spent (503).
  if (allTransient) throw new AppError(503, 'Le fonti non rispondono: nessuna scheda è stata creata, riprova più tardi.');

  const origin = req.delegation ? { clientId: req.delegation.clientId, clientName: req.delegation.clientName } : null;
  const created = await prisma.$transaction(async (tx) => {
    const ids = new Map<number, string>();
    for (const plan of planned) {
      if ('input' in plan) ids.set(plan.index, (await createLingoCard(req.user!.id, plan.input, tx, origin)).id);
    }
    return ids;
  });

  const results = planned.map((plan) =>
    'input' in plan ? { outcome: 'created' as const, id: created.get(plan.index)! } : { outcome: 'refused' as const, ...plan.refused },
  );
  // Under an exchanged token each distinct reference costs two points, as on the dossier's norms
  // route; only one a source failed to check is handed back — a refusal that will not change is paid.
  res.locals.delegatedRefund = failures.filter((o) => o.transient).length * 2;
  res.json({ results });
});

router.post('/trash', async (req: Request, res) => {
  const { cardIds } = trashSchema.parse(req.body);
  // The user's own deletion carries no application: the trash lists it as theirs.
  const by = req.delegation
    ? { clientId: req.delegation.clientId, clientName: req.delegation.clientName, grantId: req.delegation.grantId }
    : { clientId: null, clientName: null, grantId: null };
  res.json(await trashLingoCards(req.user!.id, cardIds, by));
});

router.get('/', async (req, res) => {
  const { materia, stato, tipo, normaKey, q, origine, ordine, limit, offset } = listSchema.parse(req.query);
  const where: Prisma.LingoCardWhereInput = {
    autoreId: req.user!.id,
    ...(materia ? { materia } : {}),
    ...(stato ? { stato } : {}),
    ...(tipo ? { tipo } : {}),
    // Any anchor on the act, not only the primary one.
    ...(normaKey ? { ancore: { some: { normaKey } } } : {}),
    ...(q ? { OR: [{ istituto: { contains: q, mode: 'insensitive' } }, { domanda: { contains: q, mode: 'insensitive' } }] } : {}),
    ...(origine ? { createdByClientId: { not: null } } : {}),
  };
  const orderBy: Prisma.LingoCardOrderByWithRelationInput[] =
    ordine === 'materia'
      ? [{ materia: 'asc' }, { istituto: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }]
      : [{ createdAt: 'desc' }, { id: 'desc' }];
  const cards = await prisma.lingoCard.findMany({
    where,
    include: { ancore: true },
    // The id breaks ties: restored cards keep their creation time, and pages must not repeat or skip one.
    orderBy,
    take: limit + 1,
    skip: offset,
  });
  res.json({ cards: cards.slice(0, limit).map(serialize), nextOffset: cards.length > limit ? offset + limit : null });
});

router.get('/:id', async (req, res) => {
  const card = await prisma.lingoCard.findFirst({ where: { id: req.params.id, autoreId: req.user!.id }, include: { ancore: true } });
  if (!card) throw new AppError(404, 'Scheda non trovata.');
  res.json(serialize(card));
});

router.patch('/:id', async (req, res) => {
  const body = cardInputSchema.parse(req.body);
  const { planned, allTransient } = await planCards([body]);
  // Sources down for every reference: nothing could be checked, so the draft stays as it is (503).
  if (allTransient) throw new AppError(503, 'Le fonti non rispondono: la scheda non è stata modificata, riprova più tardi.');
  const [plan] = planned;
  if ('refused' in plan) {
    const { detail, anchors } = plan.refused;
    res.status(400).json({ detail: anchors ? 'Un’ancora non è verificabile: la scheda non è stata modificata.' : detail, anchors });
    return;
  }
  const card = lingoCardCreateSchema.parse(plan.input);
  const markFirstPrimary = !card.ancore.some((a) => a.isPrimary);

  const updated = await prisma.$transaction(async (tx) => {
    // The row is locked, then read again: a state changed since the plan (a proposal, an archive) refuses the edit.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM lingo_cards WHERE id = ${req.params.id} AND autore_id = ${req.user!.id} FOR UPDATE`;
    if (locked.length !== 1) throw new AppError(404, 'Scheda non trovata.');
    const current = await tx.lingoCard.findUniqueOrThrow({ where: { id: req.params.id }, select: { stato: true } });
    if (current.stato !== 'BOZZA_PERSONALE') throw new AppError(409, 'Solo una bozza si può modificare.');
    await tx.lingoCardAncora.deleteMany({ where: { cardId: req.params.id } });
    // The origin columns are not touched: they say who created the card, and an edit by hand keeps it.
    return tx.lingoCard.update({
      where: { id: req.params.id },
      data: {
        materia: card.materia,
        istituto: card.istituto,
        tipo: card.tipo,
        domanda: card.domanda,
        risposta: card.risposta,
        spiegazione: card.spiegazione ?? null,
        ancore: {
          create: card.ancore.map((a, i) => ({
            normaKey: a.normaKey,
            articleId: a.articleId,
            urn: a.urn,
            aknFingerprint: a.aknFingerprint,
            isPrimary: a.isPrimary || (markFirstPrimary && i === 0),
          })),
        },
      },
      include: { ancore: true },
    });
  });
  res.json(serialize(updated));
});

export default router;
