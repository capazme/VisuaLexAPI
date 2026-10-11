import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { anchorUrn } from '../lingo/anchors';
import { hasNoNul } from '../lingo/noNul';
import { serialize } from '../lingo/serializeCard';

/**
 * The study cards resting on an article, for the reader's side panel. The
 * address is the one the reader holds (Normattiva's, with its version); the
 * identity of the anchor is the official URN cut from it (`anchorUrn`). For the
 * user's session only: not in the delegated table. It lists the caller's own
 * cards that are not archived (`comunita: false`), then other people's
 * validated cards (`comunita: true`, with the count of approvals), at most 50
 * in all. Another person's draft, proposal or archived card is never shown.
 */
const router = Router();
router.use(authenticate);

const MAX_CARDS = 50;

const querySchema = z.object({ urn: z.string().min(1).max(600).refine(hasNoNul, { message: 'Indirizzo dell’articolo non valido.' }) });

router.get('/', async (req, res) => {
  const urn = anchorUrn(querySchema.parse(req.query).urn);
  if (!urn) throw new AppError(400, 'Indirizzo dell’articolo non valido.');
  const me = req.user!.id;
  const own = await prisma.lingoCard.findMany({
    where: { autoreId: me, stato: { not: 'ARCHIVIATA' }, ancore: { some: { urn } } },
    include: { ancore: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MAX_CARDS,
  });
  const others =
    own.length >= MAX_CARDS
      ? []
      : await prisma.lingoCard.findMany({
          // A card whose author's account is gone (null) is still the community's; `not` alone would drop it.
          where: { stato: 'VALIDATA', OR: [{ autoreId: null }, { autoreId: { not: me } }], ancore: { some: { urn } } },
          include: { ancore: true, _count: { select: { validazioni: { where: { giudizio: 'APPROVATA' } } } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: MAX_CARDS - own.length,
        });
  res.json({
    cards: [
      ...own.map((card) => ({ ...serialize(card), comunita: false, approvazioni: null })),
      ...others.map(({ _count, ...card }) => ({ ...serialize(card), comunita: true, approvazioni: _count.validazioni })),
    ],
  });
});

export default router;
