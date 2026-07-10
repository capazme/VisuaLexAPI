import { z } from 'zod';

/**
 * Zod schemas for the MERL-T ingestion layer (Phase 2 — wiring VisuaLex user
 * knowledge into the ExternalIngestionPipeline).
 *
 * `user_id` / `user_authority` / `voter_id` / `voter_authority` are NEVER part
 * of the client-facing schema: the route injects them server-side from
 * req.user + authorityCache. Trusting a client-supplied authority would let
 * any user auto-approve their own contributions.
 */

export const suggestedRelationSchema = z.object({
  source_urn: z.string().min(1),
  target_urn: z.string().min(1),
  relation_type: z.string().min(1),
  evidence: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
});
export type SuggestedRelationInput = z.infer<typeof suggestedRelationSchema>;

export const ingestionTriggerSchema = z.enum([
  'annotation',
  'dossier_grouping',
  'manual',
  'search_not_found',
]);
export type IngestionTrigger = z.infer<typeof ingestionTriggerSchema>;

// POST /api/merlt/ingestion/preview and /process — body sent by the frontend
// (BFF-only for now, no FE call-sites yet). `user_id`/`user_authority` are
// deliberately absent: the route injects them.
export const ingestionRequestBodySchema = z.object({
  source: z.string().min(1).default('visualex'),
  tipo_atto: z.string().min(1),
  articolo: z.string().min(1),
  trigger: ingestionTriggerSchema,
  suggested_relations: z.array(suggestedRelationSchema).default([]),
  metadata: z.record(z.unknown()).optional(),
});
export type IngestionRequestBody = z.infer<typeof ingestionRequestBodySchema>;

// POST /api/merlt/ingestion/validate — body sent by the frontend.
// `voter_id`/`voter_authority` are injected by the route.
export const validationVoteBodySchema = z.object({
  pending_id: z.string().min(1),
  vote: z.boolean(),
  reason: z.string().max(1000).optional(),
});
export type ValidationVoteBody = z.infer<typeof validationVoteBodySchema>;
