import { LingoTestoChiave, Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { AppError } from '../middleware/errorHandler';
import { hasNoNul } from '../lingo/noNul';
import { parseTextKey } from '../lingo/texts';

/**
 * The administrator's side of the texts a person must accept in VisuaLex Studia
 * (spec decision 22): every version of each text, and a new version. Versions
 * are never edited or deleted. Mounted on its own path, so it carries its own
 * authentication and admin check; none of it is in the delegated table.
 */
const router = Router();
router.use(authenticate, requireAdmin);

const field = (max: number) =>
  z.string().trim().min(1).max(max).refine(hasNoNul, { message: 'Il testo contiene un carattere non valido.' });
const versionSchema = z.object({ titolo: field(200), corpo: field(8000), conferma: field(120), azione: field(120) }).strict();

const keyOf = (raw: string): LingoTestoChiave => {
  const key = parseTextKey(raw);
  if (!key) throw new AppError(404, 'Testo non trovato.');
  return key;
};

const versionRow = {
  id: true, versione: true, titolo: true, corpo: true, conferma: true, azione: true, createdAt: true,
  autore: { select: { username: true } },
} satisfies Prisma.LingoTestoVersioneSelect;

type VersionRow = Prisma.LingoTestoVersioneGetPayload<{ select: typeof versionRow }>;
const present = ({ autore, ...rest }: VersionRow) => ({ ...rest, autore: autore?.username ?? null });

router.get('/', async (_req, res) => {
  const testi = await Promise.all(
    Object.values(LingoTestoChiave).map(async (chiave) => ({
      chiave,
      versioni: (await prisma.lingoTestoVersione.findMany({ where: { chiave }, select: versionRow, orderBy: { versione: 'desc' } })).map(present),
    })),
  );
  res.json({ testi });
});

router.post('/:chiave', async (req, res) => {
  const chiave = keyOf(req.params.chiave);
  const body = versionSchema.parse(req.body);
  try {
    const last = await prisma.lingoTestoVersione.aggregate({ where: { chiave }, _max: { versione: true } });
    const created = await prisma.lingoTestoVersione.create({
      data: { chiave, versione: (last._max.versione ?? 0) + 1, ...body, autoreId: req.user!.id },
      select: versionRow,
    });
    res.status(201).json({ chiave, ...present(created) });
  } catch (error) {
    // Two administrators saving at once read the same highest version: the unique key lets one through.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'Un’altra versione è stata salvata nel frattempo: ricarica.');
    }
    throw error;
  }
});

export default router;
