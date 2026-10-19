import { LingoCardTipo, LingoMateria } from '@prisma/client';
import { z } from 'zod';

/**
 * What a caller may send to create a study card. Every object is `.strict()`:
 * the state, the authority score, the controversy flag, the author and the id
 * are decided by the server (a draft starts as a draft, whoever asks), so a
 * body that tries to set them is refused rather than quietly ignored.
 *
 * The anchor is the point of the model: a card with no norm under it is
 * floating knowledge, and cannot be created. The fingerprint is the SHA-256
 * (lower-case hexadecimal) that the Python API computes over the article text.
 */

const SHA256_HEX = /^[0-9a-f]{64}$/;
/** snake_case, e.g. "codice_civile". */
const NORMA_KEY = /^[a-z0-9]+(_[a-z0-9]+)*$/;

export const MAX_ANCHORS_PER_CARD = 10;

export const lingoCardAncoraInputSchema = z
  .object({
    normaKey: z.string().max(100).regex(NORMA_KEY),
    articleId: z.string().trim().min(1).max(50),
    urn: z.string().max(500).startsWith('urn:'),
    aknFingerprint: z.string().regex(SHA256_HEX),
    isPrimary: z.boolean().default(false),
  })
  .strict();
export type LingoCardAncoraInput = z.infer<typeof lingoCardAncoraInputSchema>;

export const lingoCardCreateSchema = z
  .object({
    materia: z.nativeEnum(LingoMateria),
    istituto: z.string().trim().min(1).max(200),
    tipo: z.nativeEnum(LingoCardTipo).default('ISTITUTO_DEFINIZIONE'),
    domanda: z.string().trim().min(1).max(2_000),
    risposta: z.string().trim().min(1).max(4_000),
    spiegazione: z.string().trim().max(8_000).optional(),
    ancore: z
      .array(lingoCardAncoraInputSchema)
      .min(1)
      .max(MAX_ANCHORS_PER_CARD)
      .refine((ancore) => ancore.filter((a) => a.isPrimary).length <= 1, {
        message: 'at most one anchor can be the primary one',
      }),
  })
  .strict();
export type LingoCardCreateInput = z.infer<typeof lingoCardCreateSchema>;
