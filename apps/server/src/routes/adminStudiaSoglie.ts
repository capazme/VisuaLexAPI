import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { SOGLIE_PREDEFINITE } from '../lingo/validationRule';
import {
  LIMITI_SOGLIE,
  anteprimaSoglie,
  applicaSoglie,
  leggiSoglie,
} from '../lingo/validationSettings';

/**
 * The administrator's side of the validation thresholds (Studia spec 2026-10-18):
 * the two values, a preview of what a change would do, and the change itself.
 * Mounted on its own path, so it carries its own authentication and admin check;
 * none of it is in the delegated table.
 */
const router = Router();
router.use(authenticate, requireAdmin);

const sogliaSchema = z
  .object({
    approvazioni: z
      .number({ invalid_type_error: 'Le approvazioni devono essere un numero intero.' })
      .int('Le approvazioni devono essere un numero intero.')
      .min(LIMITI_SOGLIE.approvazioni.min, 'Le approvazioni vanno da 1 a 5.')
      .max(LIMITI_SOGLIE.approvazioni.max, 'Le approvazioni vanno da 1 a 5.'),
    errate: z
      .number({ invalid_type_error: 'Le errate devono essere un numero intero.' })
      .int('Le errate devono essere un numero intero.')
      .min(LIMITI_SOGLIE.errate.min, 'Le errate vanno da 1 a 3.')
      .max(LIMITI_SOGLIE.errate.max, 'Le errate vanno da 1 a 3.'),
  })
  .strict();

router.get('/', async (_req, res) => {
  const soglie = await leggiSoglie(prisma);
  res.json({ soglie, limiti: LIMITI_SOGLIE, predefinite: SOGLIE_PREDEFINITE });
});

router.post('/anteprima', async (req, res) => {
  const soglie = sogliaSchema.parse(req.body);
  res.json(await anteprimaSoglie(prisma, soglie));
});

router.put('/', async (req, res) => {
  const soglie = sogliaSchema.parse(req.body);
  const esito = await prisma.$transaction((tx) => applicaSoglie(tx, soglie, req.user!.id), { timeout: 30_000 });
  res.json(esito);
});

export default router;
