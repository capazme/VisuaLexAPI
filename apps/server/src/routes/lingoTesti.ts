import { Router } from 'express';
import { z } from 'zod';
import { isSwitchOn } from '../assistant/switches';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { hasNoNul } from '../lingo/noNul';
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

const acceptSchema = z.object({ testoId: z.string().min(1).max(64).refine(hasNoNul, { message: 'Identificativo non valido.' }) }).strict();

/**
 * The declaration on one's study material (Percorsi, A1; spec 2026-10-23 §10.5, §12), accepted on its own in the
 * web before the first course: this key alone, since the other texts are accepted where they are used (a card's
 * proposal, the MERL-T consent). Only the current version counts: another id writes nothing and answers 409 with
 * the current one. Session only (not in the delegated table); 404 while the switch `lingo_courses` is off.
 */
router.post('/MATERIALE_STUDIO/accetta', async (req, res) => {
  if (!(await isSwitchOn('lingo_courses'))) throw new AppError(404, 'Testo non trovato.');
  const { testoId } = acceptSchema.parse(req.body);
  const current = await currentText(prisma, 'MATERIALE_STUDIO');
  if (testoId !== current.id) {
    res.status(409).json({ detail: 'Il testo è cambiato: leggi la versione attuale.', richiedeTesto: serializeText(current, await hasAccepted(prisma, req.user!.id, current.id)) });
    return;
  }
  // A double click is harmless: the pair (person, version) is unique.
  await prisma.lingoAccettazioneTesto.createMany({ data: [{ utenteId: req.user!.id, testoId: current.id }], skipDuplicates: true });
  res.json(serializeText(current, true));
});

export default router;
