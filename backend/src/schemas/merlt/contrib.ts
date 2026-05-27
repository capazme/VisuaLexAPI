import { z } from 'zod';

/** Zod schemas for the MERL-T contribution routes (Slice 2c). */

/** POST /contrib/candidates/:id/promote — entity OR relation, discriminated. */
export const promoteRequestSchema = z.discriminatedUnion('candidateType', [
  z.object({
    candidateType: z.literal('entity'),
    articleUrn: z.string().min(1),
    nome: z.string().min(1),
    tipo: z.string().min(1),
    /** The user's reformulated description (gated against the verbatim). */
    descrizione: z.string().min(1),
    fonte: z.string().min(1),
    attested: z.boolean(),
  }),
  z.object({
    candidateType: z.literal('relation'),
    articleUrn: z.string().min(1),
    sourceUrn: z.string().min(1),
    targetEntityId: z.string().min(1),
    tipoRelazione: z.string().min(1),
    descrizione: z.string().min(1),
    fonte: z.string().min(1),
    attested: z.boolean(),
  }),
]);
export type PromoteRequest = z.infer<typeof promoteRequestSchema>;

/** POST /validate/entity | /validate/relation — RLCF vote (Slice 2c #8). */
export const voteSchema = z.enum(['approve', 'reject', 'edit']);

export const validateEntityRequestSchema = z.object({
  entityId: z.string().min(1),
  vote: voteSchema,
  reason: z.string().max(1000).optional(),
});
export type ValidateEntityRequest = z.infer<typeof validateEntityRequestSchema>;

export const validateRelationRequestSchema = z.object({
  relationId: z.string().min(1),
  vote: voteSchema,
  reason: z.string().max(1000).optional(),
});
export type ValidateRelationRequest = z.infer<typeof validateRelationRequestSchema>;

/** POST /internal/extraction-callback — worker → BFF (internalAuth). */
export const extractionCallbackSchema = z.object({
  bffJobId: z.string().min(1),
  status: z.enum(['running', 'completed', 'failed', 'timeout']),
  candidatesCreated: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});
export type ExtractionCallback = z.infer<typeof extractionCallbackSchema>;
