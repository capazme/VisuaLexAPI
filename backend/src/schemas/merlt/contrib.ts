import { z } from 'zod';

/** Zod schemas for the MERL-T contribution routes (Slice 2c). */

/**
 * B1: a relation endpoint must be an identifier the graph writer can MATCH,
 * never the concept name the LLM wrote. Accepted shapes, mirroring
 * merlt/storage/graph/relation_endpoints.py (is_norm_reference,
 * looks_like_entity_id) so both sides classify an endpoint the same way:
 *  - a norm: a URN ("urn:nir:...") or a URL wrapping a NIR URN
 *    ("https://www.normattiva.it/uri-res/N2Ls?urn:nir:...");
 *  - a graph node id or a pending entity id: `<tipo>:<slug>` with a lowercase
 *    tipo and no whitespace ("concetto:risoluzione_del_contratto",
 *    "concetto:1a2b3c4d").
 * A bare name ("risoluzione del contratto") fails, and the route answers 400
 * `unresolved_endpoint` instead of letting consensus write a phantom node.
 */
export const RELATION_ENDPOINT_ERROR = 'unresolved_endpoint';
const NORM_URN_RE = /^urn:\S+$/i;
const NORM_URL_RE = /^https?:\/\/\S+$/i;
const ENTITY_ID_RE = /^[a-z][a-z0-9_]*:\S+$/;

export function isResolvedRelationEndpoint(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (NORM_URN_RE.test(v)) return true;
  if (NORM_URL_RE.test(v)) return v.toLowerCase().includes('urn:nir:');
  return ENTITY_ID_RE.test(v);
}

const relationEndpointSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(isResolvedRelationEndpoint, { message: RELATION_ENDPOINT_ERROR });

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
    // Set on the "Invia comunque" retry after MERL-T deferred on a duplicate.
    // They bypass the dedup only, never the copyright gate.
    skipDuplicateCheck: z.boolean().optional(),
    acknowledgedDuplicateOf: z.string().min(1).max(200).optional(),
  }),
  z.object({
    candidateType: z.literal('relation'),
    articleUrn: z.string().min(1),
    // Resolved identifiers only (see isResolvedRelationEndpoint); varchar(300)
    // on the MERL-T side.
    sourceUrn: relationEndpointSchema,
    targetEntityId: relationEndpointSchema,
    tipoRelazione: z.string().min(1),
    descrizione: z.string().min(1),
    fonte: z.string().min(1),
    attested: z.boolean(),
    skipDuplicateCheck: z.boolean().optional(),
    acknowledgedDuplicateOf: z.string().min(1).max(200).optional(),
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
