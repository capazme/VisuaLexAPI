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

export const refineRequestSchema = z.object({
  traceId: z.string().min(1),
  followUpQuery: z.string().min(5).max(2000),
});

export const confirmSourceRequestSchema = z.object({
  nodeId: z.string().regex(/^live:/, 'must be a provisional node id (live:...)'),
  entityText: z.string().max(500).optional(),
  entityType: z.string().max(100).optional(),
  ambito: z.string().max(100).optional(),
});

export type ExpertQueryRequest = z.infer<typeof expertQueryRequestSchema>;
