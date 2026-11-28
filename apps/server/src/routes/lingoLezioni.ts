import { LingoMateria } from '../lib/db';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { answerLesson, createLesson } from '../lingo/lessons';

/**
 * Learn's short lesson (LC63, `lingo/lessons.ts`): build one, answer its exercises. For the user's session only:
 * nothing here is in the delegated table, so an exchanged token answers 403 and no connected application earns XP.
 */
const router = Router();
router.use(authenticate);

const createSchema = z.object({ materia: z.nativeEnum(LingoMateria) }).strict();
const answerSchema = z
  .object({
    indice: z.number().int().min(0).max(7),
    // The shape each kind takes is checked against the stored exercise.
    risposta: z.union([z.number().int(), z.boolean(), z.array(z.number().int()).max(8)]),
  })
  .strict();
const idSchema = z.string().uuid();

router.post('/', async (req, res) => {
  const { materia } = createSchema.parse(req.body);
  res.status(201).json(await createLesson(req.user!.id, materia));
});

router.post('/:id/risposte', async (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) {
    res.status(404).json({ detail: 'Lezione non trovata.' });
    return;
  }
  const { indice, risposta } = answerSchema.parse(req.body);
  res.json(await answerLesson(req.user!.id, id.data, indice, risposta));
});

export default router;
