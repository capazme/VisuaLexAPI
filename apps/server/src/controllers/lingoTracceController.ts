import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { lingoTracceQuerySchema } from '../schemas/lingo/tracciaQuery';

/**
 * What a candidate may see of a trace. An explicit `select`, not an `omit`:
 * `normeRiferimento`, `questioniForma` and `questioniSostanza` are the answer
 * key the correction compares an essay against, and a column added to the model
 * later must stay hidden until someone decides to show it.
 */
const SUMMARY_SELECT = {
  id: true,
  materia: true,
  tipoProva: true,
  sottoTipoAtto: true,
  titolo: true,
  fonteTraccia: true,
  difficolta: true,
} satisfies Prisma.LingoTracciaSelect;

const DETAIL_SELECT = { ...SUMMARY_SELECT, testoTraccia: true } satisfies Prisma.LingoTracciaSelect;

// Newest session first ("sessione_2006" sorts after "sessione_2005"), then a stable order.
const ORDER: Prisma.LingoTracciaOrderByWithRelationInput[] = [
  { fonteTraccia: 'desc' },
  { materia: 'asc' },
  { tipoProva: 'asc' },
  { titolo: 'asc' },
  { id: 'asc' },
];

export const listTracce = async (req: Request, res: Response) => {
  const { materia, tipoProva, sottoTipoAtto, limit, offset } = lingoTracceQuerySchema.parse(req.query);
  const where: Prisma.LingoTracciaWhereInput = {
    attiva: true,
    ...(materia && { materia }),
    ...(tipoProva && { tipoProva }),
    ...(sottoTipoAtto && { sottoTipoAtto }),
  };

  const [items, total] = await prisma.$transaction([
    prisma.lingoTraccia.findMany({ where, select: SUMMARY_SELECT, orderBy: ORDER, take: limit, skip: offset }),
    prisma.lingoTraccia.count({ where }),
  ]);

  res.json({ items, total, limit, offset });
};

export const getTraccia = async (req: Request, res: Response) => {
  // An inactive trace answers exactly as one that does not exist.
  const traccia = await prisma.lingoTraccia.findFirst({
    where: { id: req.params.id, attiva: true },
    select: DETAIL_SELECT,
  });
  if (!traccia) throw new AppError(404, 'Trace not found');

  res.json(traccia);
};
