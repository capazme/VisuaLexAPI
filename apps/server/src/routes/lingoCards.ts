import { LingoCardStato, LingoMateria, type Prisma } from '@prisma/client';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { createLingoCard } from '../lingo/cards';
import { resolveAnchors, type AnchorOutcome } from '../lingo/anchors';
import { lingoCardCreateSchema, MAX_ANCHORS_PER_CARD } from '../schemas/lingo/card';
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
  .extend({ ancore: z.array(anchorReferenceSchema).min(1).max(MAX_ANCHORS_PER_CARD) })
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
  ancore: card.ancore.map((a) => ({ normaKey: a.normaKey, articleId: a.articleId, urn: a.urn, isPrimary: a.isPrimary })),
});

router.post('/', async (req, res) => {
  const { cards } = createSchema.parse(req.body);
  const references = [...new Set(cards.flatMap((card) => card.ancore.map((a) => a.riferimento)))];
  const outcomes = new Map<string, AnchorOutcome>((await resolveAnchors(references)).map((o) => [o.reference, o]));
  const results = [];
  for (const card of cards) {
    const anchors = card.ancore.map((a) => outcomes.get(a.riferimento)!);
    const failed = anchors.filter((a) => a.outcome !== 'anchored');
    if (failed.length > 0) {
      results.push({ outcome: 'refused' as const, detail: 'Un’ancora non è verificabile: la scheda non è stata creata.', anchors: failed });
      continue;
    }
    const { ancore, ...fields } = card;
    const created = await createLingoCard(req.user!.id, {
      ...fields,
      ancore: ancore.map((a, i) => {
        const anchored = anchors[i] as Extract<AnchorOutcome, { outcome: 'anchored' }>;
        return { ...anchored.anchor, isPrimary: a.principale ?? false };
      }),
    });
    results.push({ outcome: 'created' as const, id: created.id });
  }
  // Under an exchanged token each distinct reference costs two points, as on the dossier's norms
  // route; one the sources could not check is handed back.
  res.locals.delegatedRefund = [...outcomes.values()].filter((o) => o.outcome === 'unavailable').length * 2;
  res.json({ results });
});

router.post('/trash', async (req: Request, res) => {
  if (!req.delegation) throw new AppError(403, 'Il cestino raccoglie solo ciò che eliminano le applicazioni collegate.');
  const { cardIds } = trashSchema.parse(req.body);
  const by = { clientId: req.delegation.clientId, clientName: req.delegation.clientName, grantId: req.delegation.grantId };
  res.json(await trashLingoCards(req.user!.id, cardIds, by));
});

router.get('/', async (req, res) => {
  const { materia, stato, limit, offset } = listSchema.parse(req.query);
  const cards = await prisma.lingoCard.findMany({
    where: { autoreId: req.user!.id, ...(materia ? { materia } : {}), ...(stato ? { stato } : {}) },
    include: { ancore: true },
    orderBy: { createdAt: 'desc' },
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
