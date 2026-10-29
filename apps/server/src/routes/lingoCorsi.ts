import { Router, type NextFunction, type Request, type Response } from 'express';
import { isSwitchOn } from '../assistant/switches';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { addExam, addModule, courseStructure, createCourse, exportOneCourse, listCourses, patchCourse, type Origin } from '../lingo/courses';
import { hasNoNul } from '../lingo/noNul';
import {
  LIMITS,
  controlCharacterAt,
  courseCreateSchema,
  coursePatchSchema,
  examCreateSchema,
  moduleCreateSchema,
} from '../schemas/lingo/corso';
import { BY_THE_USER, trashLingoCorso, trashLingoCorsoModulo } from '../trash/trash';

/**
 * Gymnasium's courses, «Percorsi» (A1; spec 2026-10-23 §10.5), the first server pull request (S1): the
 * assistant's side — create a course, add a module, add a final exam, read the user's courses and a course's
 * structure — and the user's — rename, «Il programma finisce qui», trash a course or a module never opened,
 * export a course. The study routes (open, answer, end, flag, withdraw, exam) and the course page are S2's.
 *
 * Behind the switch `lingo_courses`: off, every route answers 404 and the rows stay. Every read and write is
 * scoped to the caller (a course by its author, a module through its course): anything else is 404, never 403.
 * Writing content is for a connected application only (`lingo:courses:write`, the delegated table); the user's
 * session gets 403 there, as on the whole-dossier trash: a course is created from the assistant (§3).
 */
const router = Router();
router.use(authenticate);
router.use(async (_req: Request, _res: Response, next: NextFunction) => {
  next((await isSwitchOn('lingo_courses')) ? undefined : new AppError(404, 'Not found'));
});
// An id with a NUL byte names nothing (and would be a 500 in the database).
for (const name of ['id', 'moduloId']) {
  router.param(name, (_req, _res, next, value: string) => next(hasNoNul(value) ? undefined : new AppError(404, 'Percorso non trovato.')));
}

/** The connected application writing, or a 403 for the user's session. */
function connectedApplication(req: Request): NonNullable<Origin> {
  if (!req.delegation) throw new AppError(403, 'I percorsi si creano dal tuo assistente collegato.');
  return { clientId: req.delegation.clientId, clientName: req.delegation.clientName };
}

/** A body with a control character (NUL among them) is refused whole, naming where. */
function noControlCharacters(body: unknown): void {
  const at = controlCharacterAt(body);
  if (at) throw new AppError(400, `Carattere non valido in «${at}».`);
}

router.get('/', async (req, res) => {
  res.json(await listCourses(req.user!.id));
});

router.post('/', async (req, res) => {
  const origin = connectedApplication(req);
  noControlCharacters(req.body);
  const input = courseCreateSchema.parse(req.body);
  const outcome = await createCourse(req.user!.id, input, origin);
  if ('richiedeTesto' in outcome) {
    // Nothing written: the web shows the declaration in «Percorsi», and the assistant gives the user the link.
    res.status(409).json({
      detail: 'Prima di creare un percorso devi accettare la dichiarazione sul materiale di studio, in VisuaLex › Percorsi.',
      richiedeTesto: outcome.richiedeTesto,
      link: '/studia/percorsi',
    });
    return;
  }
  res.status(201).json(outcome.corso);
});

router.post('/:id/moduli', async (req, res) => {
  const origin = connectedApplication(req);
  // Measured first, so that a body the field limits would allow but nothing should hold is an Italian 400.
  if (JSON.stringify(req.body ?? null).length > LIMITS.moduleBodyChars) {
    throw new AppError(400, `Un modulo ha al massimo ${LIMITS.moduleBodyChars.toLocaleString('it-IT')} caratteri in tutto.`);
  }
  noControlCharacters(req.body);
  const input = moduleCreateSchema.parse(req.body);
  res.status(201).json(await addModule(req.user!.id, req.params.id, input, origin));
});

router.post('/:id/esami', async (req, res) => {
  const origin = connectedApplication(req);
  if (JSON.stringify(req.body ?? null).length > LIMITS.moduleBodyChars) {
    throw new AppError(400, `Un esame ha al massimo ${LIMITS.moduleBodyChars.toLocaleString('it-IT')} caratteri in tutto.`);
  }
  noControlCharacters(req.body);
  const input = examCreateSchema.parse(req.body);
  res.status(201).json(await addExam(req.user!.id, req.params.id, input, origin));
});

router.get('/:id/struttura', async (req, res) => {
  // The assistant's read: the session reads the course page (S2).
  connectedApplication(req);
  res.json(await courseStructure(req.user!.id, req.params.id));
});

router.patch('/:id', async (req, res) => {
  noControlCharacters(req.body);
  res.json(await patchCourse(req.user!.id, req.params.id, coursePatchSchema.parse(req.body)));
});

router.delete('/:id', async (req, res) => {
  res.json(await trashLingoCorso(req.user!.id, req.params.id, BY_THE_USER));
});

router.delete('/:id/moduli/:moduloId', async (req, res) => {
  res.json(await trashLingoCorsoModulo(req.user!.id, req.params.id, req.params.moduloId, BY_THE_USER));
});

router.get('/:id/export', async (req, res) => {
  res.json({ schemaVersion: 1, exportedAt: new Date().toISOString(), corso: await exportOneCourse(req.user!.id, req.params.id) });
});

export default router;
