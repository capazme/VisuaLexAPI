import { Router, type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { hasNoNul } from '../lingo/noNul';
import { prisma } from '../lib/prisma';
import { forNoKeyUpdate } from '../lib/sqlDialect';

/**
 * Atti: the acts a lawyer drafts in Work,
 * on the model of `routes/tasks.ts`: the user's session only (no route in the delegated table, so an exchanged MCP
 * token gets the default-deny 403).
 *
 * - `GET /api/atti[?dossierId=]` — `{ atti }`, the newest change first, without the text;
 * - `GET /api/atti/:id` — `{ atto }`, with the text;
 * - `POST /api/atti { titolo, tipo?, testo?, dossierId? }` — 201 `{ atto }`;
 * - `PUT /api/atti/:id { titolo?, tipo?, testo?, stato?, dossierId?, baseUpdatedAt? }` — `{ atto }`. With
 *   `baseUpdatedAt` (the `updatedAt` of the copy the editor loaded), a save over a newer version is refused: 409
 *   `{ error: "conflict", atto }` with the act as it is, and nothing written. Without it, the save goes as before;
 * - an account holds at most MAX_ATTI_PER_USER acts: the next create is 409 `{ error: "atti_limit" }`;
 * - `DELETE /api/atti/:id` — 204. Gone for good: the trash is an open question (spec).
 *
 * Writes are rate-limited by `app.ts`'s `writeRateLimiter` on every non-GET under `/api`, mounted before this router.
 * Another user's act, or a dossier that is not the caller's, answers 404, never 403 (no existence leak).
 * The text may name a client: no message repeats it, and an unexpected error is logged by its kind only.
 */
const router = Router();
router.use(authenticate);
router.param('id', (_req, _res, next, id: string) => next(hasNoNul(id) ? undefined : new AppError(404, 'Atto non trovato.')));

const MAX_TITOLO = 300;
const MAX_TIPO = 100;
// About 200 pages of plain text: an act is long, a row is not a file store. Under `app.ts`'s 2 MB body limit even
// with every character two bytes in UTF-8 (accented Italian), so an over-long act gets this message, not a 413.
export const MAX_TESTO = 500_000;
/**
 * The acts an account may hold (item 13 of the security inventory; the owner chooses the number, G-519). The list
 * below shows as many, so no act ever falls out of it. With MAX_TESTO it bounds what one account can put on the disk.
 */
export const MAX_ATTI_PER_USER = 500;

const noNul = { message: 'Il testo contiene un carattere non valido.' };
const id = z.string().min(1).max(64).refine(hasNoNul, { message: 'Identificativo non valido.' });
const fields = {
  titolo: z
    .string()
    .max(MAX_TITOLO)
    .refine((value) => value.trim().length > 0, { message: 'Il titolo è obbligatorio.' })
    .refine(hasNoNul, noNul),
  tipo: z.string().trim().max(MAX_TIPO).refine(hasNoNul, noNul).nullable(),
  testo: z.string().max(MAX_TESTO, { message: 'Il testo è troppo lungo.' }).refine(hasNoNul, noNul),
  stato: z.enum(['bozza', 'finale'], { error: 'Stato non valido.' }),
  dossierId: id.nullable(),
};
const createBody = z.object({ titolo: fields.titolo, tipo: fields.tipo.optional(), testo: fields.testo.optional(), dossierId: fields.dossierId.optional() }).strict();
const updateBody = z
  .object({ ...fields, baseUpdatedAt: z.string().datetime({ message: 'Versione non valida.' }) })
  .partial()
  .strict();

const LIST_SELECT = { id: true, titolo: true, tipo: true, stato: true, dossierId: true, createdAt: true, updatedAt: true } as const;

/** A dossier id the caller may file an act under: theirs, or a 404 that says nothing of anyone else's. */
async function ownDossier(userId: string, dossierId: string | null | undefined) {
  if (!dossierId) return;
  const dossier = await prisma.dossier.findFirst({ where: { id: dossierId, userId }, select: { id: true } });
  if (!dossier) throw new AppError(404, 'Pratica non trovata.');
}

async function ownAtto(userId: string, attoId: string) {
  const atto = await prisma.atto.findFirst({ where: { id: attoId, userId } });
  if (!atto) throw new AppError(404, 'Atto non trovato.');
  return atto;
}

const wrap = (handler: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) =>
  handler(req, res).catch((error: unknown) => {
    if (error instanceof ZodError) return next(new AppError(400, error.issues[0]?.message ?? 'Richiesta non valida.'));
    if (error instanceof AppError) return next(error);
    console.error('[atti] unexpected error:', error instanceof Error ? error.name : typeof error);
    next(new AppError(500, 'Errore interno.'));
  });

router.get('/', wrap(async (req, res) => {
  const dossierId = typeof req.query.dossierId === 'string' ? id.parse(req.query.dossierId) : undefined;
  await ownDossier(req.user!.id, dossierId);
  const atti = await prisma.atto.findMany({
    where: { userId: req.user!.id, ...(dossierId ? { dossierId } : {}) },
    orderBy: { updatedAt: 'desc' },
    select: LIST_SELECT,
    take: MAX_ATTI_PER_USER,
  });
  res.json({ atti });
}));

router.get('/:id', wrap(async (req, res) => {
  res.json({ atto: await ownAtto(req.user!.id, req.params.id) });
}));

router.post('/', wrap(async (req, res) => {
  const body = createBody.parse(req.body);
  const userId = req.user!.id;
  await ownDossier(userId, body.dossierId);
  // The count and the create in one transaction, the user's row locked: two creates at once cannot both pass the cap.
  // NO KEY UPDATE serializes the creates without holding up the user's other writes that only reference the row.
  const atto = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE id = ${userId}${forNoKeyUpdate()}`;
    if (locked.length === 0) throw new AppError(404, 'Account non trovato.'); // deleted while this create waited
    if ((await tx.atto.count({ where: { userId } })) >= MAX_ATTI_PER_USER) {
      throw new AppError(
        409,
        `Hai raggiunto il limite di ${MAX_ATTI_PER_USER} atti: eliminane qualcuno per crearne di nuovi.`,
        'atti_limit',
      );
    }
    return tx.atto.create({
      data: { userId, titolo: body.titolo.trim(), tipo: body.tipo ?? null, testo: body.testo ?? '', dossierId: body.dossierId ?? null },
    });
  });
  res.status(201).json({ atto });
}));

// The owner is in the write's own `where` (Irnerio's review): no window between a check and a write by id.
// With `baseUpdatedAt`, the version is in the same `where`: a save over a newer version writes nothing, with no window
// between the check and the write. Two tabs on one act no longer overwrite each other in silence (item 13).
router.put('/:id', wrap(async (req, res) => {
  const { baseUpdatedAt, ...body } = updateBody.parse(req.body);
  const userId = req.user!.id;
  if (body.dossierId !== undefined) await ownDossier(userId, body.dossierId);
  const { count } = await prisma.atto.updateMany({
    where: { id: req.params.id, userId, ...(baseUpdatedAt ? { updatedAt: new Date(baseUpdatedAt) } : {}) },
    data: { ...body, ...(body.titolo !== undefined ? { titolo: body.titolo.trim() } : {}) },
  });
  if (count === 0) {
    const current = await ownAtto(userId, req.params.id); // 404 when it is not the caller's, whatever version it names
    res.status(409).json({
      detail: "L'atto è stato modificato in un'altra scheda: ricarica prima di salvare.",
      error: 'conflict',
      atto: current,
    });
    return;
  }
  res.json({ atto: await ownAtto(userId, req.params.id) });
}));

router.delete('/:id', wrap(async (req, res) => {
  const { count } = await prisma.atto.deleteMany({ where: { id: req.params.id, userId: req.user!.id } });
  if (count === 0) throw new AppError(404, 'Atto non trovato.');
  res.status(204).end();
}));

export default router;
