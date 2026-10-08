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
 * user's session only: not in the delegated table. In PR A it lists only the
 * caller's own cards that are not archived; the community's come with the
 * validation (`comunita`, `approvazioni`).
 */
const router = Router();
router.use(authenticate);

const querySchema = z.object({ urn: z.string().min(1).max(600).refine(hasNoNul, { message: 'Indirizzo dell’articolo non valido.' }) });

router.get('/', async (req, res) => {
  const urn = anchorUrn(querySchema.parse(req.query).urn);
  if (!urn) throw new AppError(400, 'Indirizzo dell’articolo non valido.');
  const cards = await prisma.lingoCard.findMany({
    where: { autoreId: req.user!.id, stato: { not: 'ARCHIVIATA' }, ancore: { some: { urn } } },
    include: { ancore: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 50,
  });
  res.json({ cards: cards.map((card) => ({ ...serialize(card), comunita: false, approvazioni: null })) });
});

export default router;
