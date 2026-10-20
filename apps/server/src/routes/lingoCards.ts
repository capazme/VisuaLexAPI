import { LingoCardStato, LingoCardTipo, LingoMateria, type Prisma } from '@prisma/client';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { createLingoCard } from '../lingo/cards';
import { canTransition } from '../lingo/cardStates';
import { hasNoNul } from '../lingo/noNul';
import { settleMissions } from '../lingo/missions';
import { cardInputSchema, planCards } from '../lingo/planCards';
import { REVIEWABLE_OWN_STATES } from '../lingo/reviewQueue';
import { serialize } from '../lingo/serializeCard';
import { currentText, hasAccepted, serializeText } from '../lingo/texts';
import { romeDay, startOfRomeDay } from '../lingo/studyDay';
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
 * trash (drafts, archived: what account deletion removes too). Proposing a
 * draft to the community, under the notice the author accepted, and
 * withdrawing a proposal are for the session only too.
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
  // Cards due for review up to today (Rome), by the caller's own review state.
  dovuteOggi: z.literal('true').optional(),
  ordine: z.enum(['recenti', 'materia']).default('recenti'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
const proposeSchema = z
  .object({ accettoTestoId: z.string().min(1).max(64).refine(hasNoNul, { message: 'Identificativo non valido.' }).optional() })
  .strict();
const trashSchema = z.object({ cardIds: z.array(z.string().min(1).max(64).refine(hasNoNul, { message: 'Identificativo non valido.' })).min(1).max(MAX_CARDS_PER_CALL) }).strict();

/**
 * What the caller's own review state adds to a card: the Rome day it is next due, null before its first
 * review, and null for a card that can no longer be reviewed (its state row stays but nothing is due). The
 * study state is the user's session's: a connected application gets the card as before.
 */
const reviewedBy = (userId: string) => ({ ancore: true, statiRipasso: { where: { utenteId: userId } } }) satisfies Prisma.LingoCardInclude;
type CardWithReview = Prisma.LingoCardGetPayload<{ include: ReturnType<typeof reviewedBy> }>;
const serializeForCaller = (req: Request) => (card: CardWithReview) =>
  req.delegation
    ? serialize(card)
    : {
        ...serialize(card),
        prossimoRipasso: card.statiRipasso[0] && REVIEWABLE_OWN_STATES.includes(card.stato) ? romeDay(card.statiRipasso[0].dueAt) : null,
      };

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
  const { materia, stato, tipo, normaKey, q, origine, dovuteOggi, ordine, limit, offset } = listSchema.parse(req.query);
  const userId = req.user!.id;
  if (dovuteOggi && req.delegation) throw new AppError(403, 'Il ripasso è dell’utente: questo filtro non è disponibile alle applicazioni collegate.');
  const where: Prisma.LingoCardWhereInput = {
    autoreId: userId,
    ...(materia ? { materia } : {}),
    ...(stato ? { stato } : {}),
    ...(tipo ? { tipo } : {}),
    // Any anchor on the act, not only the primary one.
    ...(normaKey ? { ancore: { some: { normaKey } } } : {}),
    ...(q ? { OR: [{ istituto: { contains: q, mode: 'insensitive' } }, { domanda: { contains: q, mode: 'insensitive' } }] } : {}),
    ...(origine ? { createdByClientId: { not: null } } : {}),
    // A review state due before tomorrow's first instant in Rome: today's, or overdue.
    // An AND, so that it does not collide with the `stato` filter; the states are the ones a session offers.
    ...(dovuteOggi
      ? {
          AND: [
            {
              stato: { in: REVIEWABLE_OWN_STATES },
              statiRipasso: { some: { utenteId: userId, dueAt: { lt: startOfRomeDay(romeDay(new Date()), 1) } } },
            },
          ],
        }
      : {}),
  };
  const orderBy: Prisma.LingoCardOrderByWithRelationInput[] =
    ordine === 'materia'
      ? [{ materia: 'asc' }, { istituto: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }]
      : [{ createdAt: 'desc' }, { id: 'desc' }];
  const cards = await prisma.lingoCard.findMany({
    where,
    include: reviewedBy(userId),
    // The id breaks ties: restored cards keep their creation time, and pages must not repeat or skip one.
    orderBy,
    take: limit + 1,
    skip: offset,
  });
  res.json({ cards: cards.slice(0, limit).map(serializeForCaller(req)), nextOffset: cards.length > limit ? offset + limit : null });
});

router.get('/:id', async (req, res) => {
  const card = await prisma.lingoCard.findFirst({ where: { id: req.params.id, autoreId: req.user!.id }, include: reviewedBy(req.user!.id) });
  if (!card) throw new AppError(404, 'Scheda non trovata.');
  // A connected application reads the card as before: a validator's reason is their writing and may name
  // someone (spec decision 19), so it is not handed to an application unless the owner decides it.
  if (req.delegation) {
    res.json(serializeForCaller(req)(card));
    return;
  }
  // What the validators said about the current proposal: the count of approvals and each remark, never who made it.
  const [approvazioni, rilievi] = await Promise.all([
    prisma.lingoValidazioneCard.count({ where: { cardId: card.id, giudizio: 'APPROVATA' } }),
    prisma.lingoValidazioneCard.findMany({
      where: { cardId: card.id, giudizio: { in: ['MIGLIORABILE', 'ERRATA'] } },
      select: { giudizio: true, motivazione: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);
  res.json({ ...serializeForCaller(req)(card), approvazioni, rilievi: rilievi.map((r) => ({ ...r, motivazione: r.motivazione ?? '' })) });
});

router.post('/:id/proponi', async (req, res) => {
  const { accettoTestoId } = proposeSchema.parse(req.body);
  const outcome = await prisma.$transaction(async (tx) => {
    // The row is locked (the author's own, as in the edit): a second click or an edit waits its turn.
    const locked = await tx.$queryRaw<{ stato: LingoCardStato }[]>`SELECT stato FROM lingo_cards WHERE id = ${req.params.id} AND autore_id = ${req.user!.id} FOR UPDATE`;
    if (locked.length !== 1) throw new AppError(404, 'Scheda non trovata.');
    if (!canTransition(locked[0].stato, 'PROPOSTA_COMMUNITY')) {
      throw new AppError(409, 'Solo una bozza si può proporre alla comunità.');
    }
    const current = await currentText(tx, 'PROPOSTA_SCHEDA');
    if (!(await hasAccepted(tx, req.user!.id, current.id))) {
      // Only the current version counts: a stale or unknown id writes nothing and the person is shown the current text.
      if (accettoTestoId !== current.id) return { richiedeTesto: serializeText(current, false) };
      // A concurrent duplicate (a double click) is harmless: the pair (person, version) is unique.
      await tx.lingoAccettazioneTesto.createMany({ data: [{ utenteId: req.user!.id, testoId: current.id }], skipDuplicates: true });
    }
    const card = await tx.lingoCard.update({
      where: { id: req.params.id },
      data: { stato: 'PROPOSTA_COMMUNITY', propostaTestoId: current.id },
      include: { ancore: true },
    });
    // «Proponi una scheda» (G-314), in the proposal's transaction: once per card in its life (Gymnasium XP spec §3.4).
    const xp = await settleMissions(tx, req.user!.id, romeDay(new Date()), { tipo: 'proposta', cardId: card.id, materia: card.materia });
    return { card, xp };
  });
  if ('richiedeTesto' in outcome) {
    res.status(409).json({ detail: 'Prima di proporre la scheda devi accettare il testo.', richiedeTesto: outcome.richiedeTesto });
    return;
  }
  res.json({ ...serialize(outcome.card), xp: outcome.xp });
});

router.post('/:id/ritira', async (req, res) => {
  const card = await prisma.$transaction(async (tx) => {
    // Locked like a vote's: a vote that comes in at this moment either lands before (and is deleted here) or finds a draft.
    const locked = await tx.$queryRaw<{ stato: LingoCardStato }[]>`SELECT stato FROM lingo_cards WHERE id = ${req.params.id} AND autore_id = ${req.user!.id} FOR UPDATE`;
    if (locked.length !== 1) throw new AppError(404, 'Scheda non trovata.');
    if (!canTransition(locked[0].stato, 'BOZZA_PERSONALE')) {
      throw new AppError(409, 'Solo una scheda in attesa di validazione si può ritirare.');
    }
    // The votes belong to the proposal being withdrawn: a new proposal starts from none.
    await tx.lingoValidazioneCard.deleteMany({ where: { cardId: req.params.id } });
    return tx.lingoCard.update({
      where: { id: req.params.id },
      data: { stato: 'BOZZA_PERSONALE', propostaTestoId: null },
      include: { ancore: true },
    });
  });
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
