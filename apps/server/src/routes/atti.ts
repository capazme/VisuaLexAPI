import { Router, type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { hasNoNul } from '../lingo/noNul';
import { prisma } from '../lib/prisma';

/**
 * Atti — DRAFT for Alfred and Guglielmo (15-11-2026), not to merge without their yes. The acts a lawyer drafts in Work,
 * on the model of `routes/tasks.ts`: the user's session only (no route in the delegated table, so an exchanged MCP
 * token gets the default-deny 403).
 *
 * - `GET /api/atti[?dossierId=]` — `{ atti }`, the newest change first, without the text;
 * - `GET /api/atti/:id` — `{ atto }`, with the text;
 * - `POST /api/atti { titolo, tipo?, testo?, dossierId? }` — 201 `{ atto }`;
 * - `PUT /api/atti/:id { titolo?, tipo?, testo?, stato?, dossierId? }` — `{ atto }`;
 * - `DELETE /api/atti/:id` — 204. Gone for good in this draft: the trash is an open question (spec).
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
const updateBody = z.object(fields).partial().strict();

const LIST_SELECT = { id: true, titolo: true, tipo: true, stato: true, dossierId: true, createdAt: true, updatedAt: true } as const;

/** A dossier id the caller may file an act under: theirs, or a 404 that says nothing of anyone else's. */
async function ownDossier(userId: string, dossierId: string | null | undefined) {
  if (!dossierId) return;
  const dossier = await prisma.dossier.findFirst({ where: { id: dossierId, userId }, select: { id: true } });
  if (!dossier) throw new AppError(404, 'Dossier non trovato.');
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
    take: 500,
  });
  res.json({ atti });
}));

router.get('/:id', wrap(async (req, res) => {
  res.json({ atto: await ownAtto(req.user!.id, req.params.id) });
}));

router.post('/', wrap(async (req, res) => {
  const body = createBody.parse(req.body);
  await ownDossier(req.user!.id, body.dossierId);
  const atto = await prisma.atto.create({
    data: { userId: req.user!.id, titolo: body.titolo.trim(), tipo: body.tipo ?? null, testo: body.testo ?? '', dossierId: body.dossierId ?? null },
  });
  res.status(201).json({ atto });
}));

router.put('/:id', wrap(async (req, res) => {
  const body = updateBody.parse(req.body);
  await ownAtto(req.user!.id, req.params.id);
  if (body.dossierId !== undefined) await ownDossier(req.user!.id, body.dossierId);
  const atto = await prisma.atto.update({
    where: { id: req.params.id },
    data: { ...body, ...(body.titolo !== undefined ? { titolo: body.titolo.trim() } : {}) },
  });
  res.json({ atto });
}));

router.delete('/:id', wrap(async (req, res) => {
  await ownAtto(req.user!.id, req.params.id);
  await prisma.atto.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

export default router;
