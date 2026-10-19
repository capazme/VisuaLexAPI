import { LingoMateria, LingoTipoProva } from '@prisma/client';
import { z } from 'zod';
import { SOTTO_TIPO_ATTO } from './traccia';

/**
 * The query of `GET /api/lingo/simulazioni/tracce`. Unknown parameters are
 * ignored (a client may add a cache-buster); the known ones are bounded, so a
 * request cannot ask for the whole bank at once.
 */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
// Far past any bank we will have; it keeps an absurd value a 400 instead of a database error.
export const MAX_OFFSET = 100_000;

export const lingoTracceQuerySchema = z.object({
  materia: z.nativeEnum(LingoMateria).optional(),
  tipoProva: z.nativeEnum(LingoTipoProva).optional(),
  sottoTipoAtto: z.string().max(80).regex(SOTTO_TIPO_ATTO).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).max(MAX_OFFSET).default(0),
});
export type LingoTracceQuery = z.infer<typeof lingoTracceQuerySchema>;
