import { z } from 'zod';

/**
 * Zod schemas for the MERL-T graph layer (Slice 2a).
 *
 * Mirrors schemas/merlt/events.ts style: `export const xSchema = z.object({...})`
 * plus `export type X = z.infer<...>`.
 *
 * The subgraph / entity-search response shapes are intentionally loose
 * passthrough objects — the BFF proxies MERL-T's shape verbatim and the
 * frontend owns the rendering. Validating them strictly here would couple the
 * BFF to MERL-T's internal node/edge property layout.
 */

// POST /api/merlt/graph/ingest — body sent by the frontend.
export const ingestRequestSchema = z.object({
  urn: z.string().min(1, 'urn is required'),
});
export type IngestRequest = z.infer<typeof ingestRequestSchema>;

// POST /api/merlt/internal/job-callback — body sent by the RQ worker.
// camelCase, matches the worker payload: { bffJobId, status, nodesCreated, edgesCreated, error }.
// `status` accepts the full transitional/terminal set (running|completed|failed|timeout)
// so a future reconciler or worker state transition isn't rejected with 400. `pending`
// is excluded because the BFF, not the worker, owns the initial pending state.
export const jobCallbackSchema = z.object({
  bffJobId: z.string().min(1),
  status: z.enum(['running', 'completed', 'failed', 'timeout']),
  nodesCreated: z.number().int().nonnegative().optional(),
  edgesCreated: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});
export type JobCallback = z.infer<typeof jobCallbackSchema>;

// --- Subgraph response (proxied verbatim from MERL-T) ---

export const subgraphNodeSchema = z
  .object({
    id: z.string(),
    urn: z.string().nullable().optional(),
    type: z.string(),
    label: z.string(),
    properties: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .passthrough();
export type SubgraphNode = z.infer<typeof subgraphNodeSchema>;

export const subgraphEdgeSchema = z
  .object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    type: z.string(),
    properties: z.record(z.unknown()).optional(),
  })
  .passthrough();
export type SubgraphEdge = z.infer<typeof subgraphEdgeSchema>;

export const subgraphResponseSchema = z
  .object({
    nodes: z.array(subgraphNodeSchema),
    edges: z.array(subgraphEdgeSchema),
    metadata: z.record(z.unknown()).optional(),
  })
  .passthrough();
export type SubgraphResponse = z.infer<typeof subgraphResponseSchema>;

// --- Entity search response (proxied verbatim from MERL-T) ---
// MERL-T returns a bare array of entity objects.

export const entitySearchItemSchema = z
  .object({
    id: z.string(),
    nome: z.string().optional(),
    tipo: z.string().optional(),
  })
  .passthrough();
export type EntitySearchItem = z.infer<typeof entitySearchItemSchema>;

export const entitySearchResponseSchema = z.array(entitySearchItemSchema);
export type EntitySearchResponse = z.infer<typeof entitySearchResponseSchema>;
