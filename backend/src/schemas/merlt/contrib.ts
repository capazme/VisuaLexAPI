import { z } from 'zod';

/** Zod schemas for the MERL-T contribution routes (Slice 2c). */

/** POST /contrib/candidates/:id/promote — entity OR relation, discriminated. */
export const promoteRequestSchema = z.discriminatedUnion('candidateType', [
  z.object({
    candidateType: z.literal('entity'),
    // Optional for free-text notes that don't link to a specific norma; the
    // BFF route falls back to the `user_document` placeholder so the proposal
    // is created stand-alone (community can later attach a real URN).
    articleUrn: z.string().min(1).optional(),
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
  // .nullish() (not .optional()): the worker serializes absent fields as
  // explicit `null` (candidatesCreated/error), which .optional() rejects → the
  // completion callback 400s and the job is stuck 'pending' forever. Same fix
  // as the graph job-callback schema.
  candidatesCreated: z.number().int().nonnegative().nullish(),
  error: z.string().nullish(),
});
export type ExtractionCallback = z.infer<typeof extractionCallbackSchema>;
