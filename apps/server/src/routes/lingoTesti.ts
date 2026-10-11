import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { currentText, hasAccepted, parseTextKey, serializeText } from '../lingo/texts';

/**
 * The current version of a text the person must accept, and whether they
 * accepted that very version (spec decision 22). For the user's session only:
 * not in the delegated table. The wording is the database's, never the app's.
 */
const router = Router();
router.use(authenticate);

router.get('/:chiave', async (req, res) => {
  const key = parseTextKey(req.params.chiave);
  if (!key) throw new AppError(404, 'Testo non trovato.');
  const text = await currentText(prisma, key);
  res.json(serializeText(text, await hasAccepted(prisma, req.user!.id, text.id)));
});

export default router;
