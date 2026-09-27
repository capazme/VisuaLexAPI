import { z } from 'zod';

/**
 * Zod schemas for the BFF /api/merlt/experts/* routes (Loop β Phase F).
 * Client-facing camelCase; the route maps to MERL-T's snake_case + injects
 * user_id from the JWT.
 */

/**
 * Graph-context for a question (the "context basket"): the selected nodes the
 * jurist wants the collegio to reason WITH. Norma nodes ride as `normReferences`
 * (their graph urn), concept nodes as `legalConcepts` (their label). The route
 * maps these onto MERL-T's `context.entities.{norm_references,legal_concepts}` —
 * the channel the orchestrator actually consumes (the old `contextUrn` was never
 * read upstream; it is kept below only for backward compatibility). Capped so a
 * runaway selection can't bloat the expert prompt / graph exploration.
 */
export const graphContextSchema = z.object({
  normReferences: z.array(z.string().trim().min(1).max(500)).max(12).optional(),
  legalConcepts: z.array(z.string().trim().min(1).max(200)).max(12).optional(),
});

export const expertQueryRequestSchema = z.object({
  query: z.string().min(5).max(2000),
  mode: z.enum(['convergent', 'divergent']).optional(),
  maxExperts: z.number().int().min(1).max(4).optional(),
  // Structured graph context (the context basket) — the real anchoring channel.
  context: graphContextSchema.optional(),
  // Legacy single anchor (Wave 2). Kept for backward compatibility only: MERL-T
  // never read `context_urn`, so old clients sending it are unaffected, and the
  // new FE sends `context` instead. Deliberately an open string.
  contextUrn: z.string().trim().min(1).max(500).optional(),
});

// POST /api/merlt/experts/query/async — submit path of the async progressive
// Q&A (qa-async-progressive-contract.md §1). `mode` is REQUIRED here (unlike
// the sync /query above): the contract's submit body types it without `?`.
export const expertQueryAsyncRequestSchema = z.object({
  query: z.string().min(5).max(2000),
  mode: z.enum(['convergent', 'divergent']),
  maxExperts: z.number().int().min(1).max(4).optional(),
  context: graphContextSchema.optional(),
});
export type ExpertQueryAsyncRequest = z.infer<typeof expertQueryAsyncRequestSchema>;

// A single completed expert (progressive payload), matching QaPartialExpert
// in qa-async-progressive-contract.md §"Tipi condivisi". `expert` mirrors
// ExpertResponse.expert_type; `weight` = gating weight if available, else = confidence.
export const qaPartialExpertSchema = z.object({
  expert: z.enum(['literal', 'systemic', 'principles', 'precedent']),
  thesis: z.string(),
  confidence: z.number(),
  weight: z.number(),
});
export type QaPartialExpert = z.infer<typeof qaPartialExpertSchema>;

// Same shape as qaPartialExpertSchema, but `expert` is deliberately an open
// string here rather than the 4-value canon enum. This is the schema used
// INSIDE qaCallbackSchema: if MERL-T ever emits a partial with a
// non-canonical `expert_type`, a strict enum would fail the WHOLE callback
// body (Zod rejects the nested field → safeParse fails top-level), 400-ing a
// callback that may also be carrying a legitimate terminal transition. The
// route validates `expert` against the canon list itself and skips-and-warns
// on a mismatch instead of dropping the entire callback (review fix, see
// routes/merlt/experts.ts `isCanonExpert`).
const qaCallbackPartialExpertSchema = z.object({
  expert: z.string().min(1),
  thesis: z.string(),
  confidence: z.number(),
  weight: z.number(),
});
export type QaCallbackPartialExpert = z.infer<typeof qaCallbackPartialExpertSchema>;

// POST /api/merlt/internal/qa-callback — body sent by MERL-T's in-process
// asyncio task (contract §4). camelCase, mirrors jobCallbackSchema in
// schemas/merlt/graph.ts. `result` is a loose passthrough object (the same
// ExpertQueryResponse shape /experts/query already forwards verbatim) —
// validating it strictly here would couple the BFF to MERL-T's DTO shape.
// `.nullish()` throughout: MERL-T serializes absent optional fields to JSON
// `null` rather than omitting them (same gotcha documented on jobCallbackSchema).
export const qaCallbackSchema = z.object({
  bffJobId: z.string().min(1),
  status: z.enum(['running', 'completed', 'failed', 'timeout']),
  partialExpert: qaCallbackPartialExpertSchema.nullish(),
  result: z.record(z.unknown()).nullish(),
  error: z.string().nullish(),
});
export type QaCallback = z.infer<typeof qaCallbackSchema>;

export const inlineFeedbackRequestSchema = z.object({
  traceId: z.string().min(1),
  rating: z.union([z.literal(1), z.literal(5)]),
});

export const sourceFeedbackRequestSchema = z.object({
  traceId: z.string().min(1),
  sourceId: z.string().min(1),
  relevance: z.number().int().min(1).max(5),
});

export const detailedFeedbackRequestSchema = z.object({
  traceId: z.string().min(1),
  retrievalScore: z.number().min(0).max(1),
  reasoningScore: z.number().min(0).max(1),
  synthesisScore: z.number().min(0).max(1),
  comment: z.string().max(2000).optional(),
});

export const preferenceFeedbackRequestSchema = z.object({
  traceId: z.string().min(1),
  preferredExpert: z.enum(['literal', 'systemic', 'principles', 'precedent']),
  comment: z.string().max(2000).optional(),
});

// Slice 4 L3 "privilegia questa relazione": per-relation traversal steer.
// relationType is an open string (the graph vocabulary evolves — MERL-T
// validates against its own vocabulary and accepts unknowns with a warn),
// trimmed, 1..100. Stricter than MERL-T's 180 cap on purpose.
export const relationFeedbackRequestSchema = z.object({
  traceId: z.string().min(1),
  relationType: z.string().trim().min(1).max(100),
  comment: z.string().max(2000).optional(),
});

export const refineRequestSchema = z.object({
  traceId: z.string().min(1),
  followUpQuery: z.string().min(5).max(2000),
});

export const confirmSourceRequestSchema = z
  .object({
    nodeId: z.string().regex(/^live:/, 'must be a provisional node id (live:...)'),
    // entityText is REQUIRED (B3): confirm-source is a graph write, so the
    // provisional node must carry a human-readable name — a raw id must never
    // become an entity name.
    entityText: z.string().trim().min(3).max(500),
    entityType: z.string().max(100).optional(),
    ambito: z.string().max(100).optional(),
  })
  .superRefine((data, ctx) => {
    // Reject a name that IS a raw provisional id: either a bare `live:` prefix
    // or the exact nodeId echoed back as the entity text.
    const name = data.entityText.trim().toLowerCase();
    if (name.startsWith('live:') || name.startsWith(data.nodeId.toLowerCase())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entityText'],
        message: 'entityText must be a human-readable name, not the provisional node id',
      });
    }
  });

export type ExpertQueryRequest = z.infer<typeof expertQueryRequestSchema>;
