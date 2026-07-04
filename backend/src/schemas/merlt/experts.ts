import { z } from 'zod';

/**
 * Zod schemas for the BFF /api/merlt/experts/* routes (Loop β Phase F).
 * Client-facing camelCase; the route maps to MERL-T's snake_case + injects
 * user_id from the JWT.
 */

export const expertQueryRequestSchema = z.object({
  query: z.string().min(5).max(2000),
  mode: z.enum(['convergent', 'divergent']).optional(),
  maxExperts: z.number().int().min(1).max(4).optional(),
});

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
