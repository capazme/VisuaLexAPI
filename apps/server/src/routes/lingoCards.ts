import { LingoCardStato, LingoCardTipo, LingoMateria, type Prisma } from '@prisma/client';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { createLingoCard } from '../lingo/cards';
import { resolveAnchors, type AnchorOutcome } from '../lingo/anchors';
import { lingoCardCreateSchema, MAX_ANCHORS_PER_CARD, type LingoCardAncoraInput } from '../schemas/lingo/card';
import { trashLingoCards } from '../trash/trash';

/**
 * Study cards for their author (MCP second round, spec §6; the spike plan's
 * Task 12). A card is always the author's own draft (`createLingoCard`); its
 * anchors are given as references («art. 1453 c.c.»), resolved and checked
 * like the dossier's norms, and anchored with the official URN and the
 * fingerprint the Python API computes (`lingo/anchors.ts`): the caller never
 * handles a hash. A card with an anchor that cannot be verified is refused,
 * and the others in the call go on. Open to the user's session and to
 * exchanged tokens (`lingo:cards:read` / `lingo:cards:write`); moving cards to
 * the trash is for connected applications only, and only for the user's
 * personal ones (drafts, archived: what account deletion removes too).
 */
const router = Router();
router.use(authenticate);

export const MAX_CARDS_PER_CALL = 10;
/** Distinct anchor references checked against the sources in one call, as a cost cap (each one is fetched). */
export const MAX_REFERENCES_PER_CALL = 20;

const anchorReferenceSchema = z
  .object({ riferimento: z.string().trim().min(1).max(200), principale: z.boolean().optional() })
  .strict();
const cardInputSchema = lingoCardCreateSchema
  .omit({ ancore: true })
  .extend({
    ancore: z
      .array(anchorReferenceSchema)
      .min(1)
      .max(MAX_ANCHORS_PER_CARD)
      .refine((ancore) => ancore.filter((a) => a.principale).length <= 1, { message: 'Al massimo un’ancora principale per scheda.' }),
  })
  .strict();
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
  q: z.string().trim().min(1).max(100).optional(),
  origine: z.literal('applicazione').optional(),
  ordine: z.enum(['recenti', 'materia']).default('recenti'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
const trashSchema = z.object({ cardIds: z.array(z.string().min(1).max(64)).min(1).max(MAX_CARDS_PER_CALL) }).strict();

type CardRow = Prisma.LingoCardGetPayload<{ include: { ancore: true } }>;

const serialize = (card: CardRow) => ({
  id: card.id,
  materia: card.materia,
  istituto: card.istituto,
  tipo: card.tipo,
  domanda: card.domanda,
  risposta: card.risposta,
  spiegazione: card.spiegazione,
  stato: card.stato,
  createdAt: card.createdAt,
  updatedAt: card.updatedAt,
  // Which connected application wrote the card; the client's id stays on the server.
  origine: card.createdByClientId ? { clientName: card.createdByClientName } : null,
  ancore: card.ancore.map((a) => ({ normaKey: a.normaKey, articleId: a.articleId, urn: a.urn, isPrimary: a.isPrimary })),
});

router.post('/', async (req, res) => {
  const { cards } = createSchema.parse(req.body);
  const references = [...new Set(cards.flatMap((card) => card.ancore.map((a) => a.riferimento)))];
  const outcomes = new Map<string, AnchorOutcome>((await resolveAnchors(references)).map((o) => [o.reference, o]));
  const failures = [...outcomes.values()].filter((o) => o.outcome !== 'anchored');

  // Sources down for every reference: nothing could be checked, so nothing is written or spent (503).
  if (failures.length === outcomes.size && failures.every((o) => o.transient)) {
    throw new AppError(503, 'Le fonti non rispondono: nessuna scheda è stata creata, riprova più tardi.');
  }

  // Every card is decided before the first is written, so a call never stops halfway (code review of PR 5).
  type Planned = { index: number; input: unknown } | { index: number; refused: { detail: string; anchors?: AnchorOutcome[] } };
  const planned: Planned[] = cards.map((card, index) => {
    const anchors = card.ancore.map((a) => outcomes.get(a.riferimento)!);
    const failed = anchors.filter((a) => a.outcome !== 'anchored');
    if (failed.length > 0) return { index, refused: { detail: 'Un’ancora non è verificabile: la scheda non è stata creata.', anchors: failed } };
    // The URN is the identity (S6): two references to the same article are one anchor, primary if either was.
    const byUrn = new Map<string, LingoCardAncoraInput>();
    card.ancore.forEach((a, i) => {
      const { anchor } = anchors[i] as Extract<AnchorOutcome, { outcome: 'anchored' }>;
      const seen = byUrn.get(anchor.urn);
      byUrn.set(anchor.urn, { ...anchor, isPrimary: Boolean(seen?.isPrimary || a.principale) });
    });
    const { ancore: _references, ...fields } = card;
    const input = { ...fields, ancore: [...byUrn.values()] };
    const valid = lingoCardCreateSchema.safeParse(input);
    if (!valid.success) {
      return { index, refused: { detail: `La scheda non rispetta il formato: ${valid.error.issues[0]?.message ?? 'dati non validi'}.` } };
    }
    return { index, input };
  });

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
  if (!req.delegation) throw new AppError(403, 'Il cestino raccoglie solo ciò che eliminano le applicazioni collegate.');
  const { cardIds } = trashSchema.parse(req.body);
  const by = { clientId: req.delegation.clientId, clientName: req.delegation.clientName, grantId: req.delegation.grantId };
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

export default router;
