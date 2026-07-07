import { apiClient } from '../../../services/api';
import { extractReactSteps, extractToolUsages } from './traceDetails';
import type { GraphContext, GraphTraversalEdge, QaAnswer, QaHistoryItem, QaMode } from './types';

/**
 * Typed BFF clients for the MERL-T expert Q&A routes (Loop β Phase F).
 * Mirrors validate/validateApi.ts (direct apiClient). The query/refine calls
 * are long-running (multi-expert) — give them a generous client timeout.
 */

// P1.10: FE timeout = the BFF experts timeout (MERLT_EXPERTS_TIMEOUT_MS,
// default 120s in expertsClient.ts) + 10s of headroom, so the BFF's own
// 502/504 reaches the client with real status copy instead of the FE aborting
// first with a generic "nessuna risposta dal server".
const QA_TIMEOUT_MS = 130000;

/**
 * Ask options. `context` is the "context basket" — the graph nodes the jurist
 * selected to reason WITH (Norma → normReferences, concept → legalConcepts). The
 * BFF maps it onto MERL-T's `context.entities`, the channel the orchestrator
 * actually consumes (it anchors graph exploration + the expert prompts on them).
 * Empty/absent = an unanchored ask.
 */
export interface AskQuestionOptions {
  context?: GraphContext;
  maxExperts?: number;
}

/** Drop a context with no references so no empty `context` key is sent. */
function normalizeContext(context?: GraphContext): GraphContext | undefined {
  if (!context) return undefined;
  const normReferences = context.normReferences?.filter(Boolean) ?? [];
  const legalConcepts = context.legalConcepts?.filter(Boolean) ?? [];
  if (normReferences.length === 0 && legalConcepts.length === 0) return undefined;
  return {
    ...(normReferences.length ? { normReferences } : {}),
    ...(legalConcepts.length ? { legalConcepts } : {}),
  };
}

/** Raw wire shape before normalization — `graph_traversal` arrives snake_case. */
type RawQaAnswer = Omit<QaAnswer, 'graphTraversal' | 'toolUsages' | 'reactSteps'> & {
  graph_traversal?: GraphTraversalEdge[] | null;
};

/**
 * Normalize the raw BFF response into `QaAnswer`: `graph_traversal` (snake_case
 * wire field) → `graphTraversal`, and `toolUsages`/`reactSteps` parsed off
 * `pipeline_trace` (present because every ask/refine now requests
 * `include_trace: true` — the "Strumenti usati" panel needs
 * `expert_executions[*].tool_calls`, and the "Passi ReAct" panel needs
 * `expert_executions[*].react_steps`; NEITHER lives at the trace top level).
 */
function normalizeAnswer(raw: RawQaAnswer): QaAnswer {
  return {
    ...raw,
    graphTraversal: raw.graph_traversal ?? [],
    toolUsages: extractToolUsages(raw.pipeline_trace),
    reactSteps: extractReactSteps(raw.pipeline_trace),
  };
}

export async function askQuestion(
  query: string,
  mode: QaMode,
  opts?: AskQuestionOptions,
  signal?: AbortSignal,
): Promise<QaAnswer> {
  const res = await apiClient.post<RawQaAnswer>(
    '/merlt/experts/query',
    // undefined fields are dropped by JSON serialization — no key is sent
    // for an unanchored ask. The BFF always forwards `include_trace: true` to
    // MERL-T (routes/merlt/experts.ts), so `pipeline_trace.expert_executions`
    // (tool_calls) is already populated for the "Strumenti usati" panel.
    { query, mode, maxExperts: opts?.maxExperts, context: normalizeContext(opts?.context) },
    { timeout: QA_TIMEOUT_MS, signal },
  );
  return normalizeAnswer(res.data);
}

export async function refineQuestion(
  traceId: string,
  followUpQuery: string,
  signal?: AbortSignal,
): Promise<QaAnswer> {
  const res = await apiClient.post<RawQaAnswer>(
    '/merlt/experts/refine',
    { traceId, followUpQuery },
    { timeout: QA_TIMEOUT_MS, signal },
  );
  return normalizeAnswer(res.data);
}

export async function rateAnswer(traceId: string, rating: 1 | 5): Promise<void> {
  await apiClient.post('/merlt/experts/feedback/inline', { traceId, rating });
}

export async function rateSource(traceId: string, sourceId: string, relevant: boolean): Promise<void> {
  await apiClient.post('/merlt/experts/feedback/source', {
    traceId,
    sourceId,
    relevance: relevant ? 5 : 1,
  });
}

export async function preferExpert(traceId: string, preferredExpert: string): Promise<void> {
  await apiClient.post('/merlt/experts/feedback/preference', { traceId, preferredExpert });
}

/**
 * Slice 4 L3 — "privilegia questa relazione". NEW feedback channel: the jurist
 * steers the traversal head toward a graph relation type (the systemic expert's
 * walk), keyed on the deliberation's `trace_id` like every other channel. The
 * BFF contract is `{ traceId, relationType }` → POST /experts/feedback/relation.
 */
export async function sendRelationFeedback(traceId: string, relationType: string): Promise<void> {
  await apiClient.post('/merlt/experts/feedback/relation', { traceId, relationType });
}

export async function rateDetailed(
  traceId: string,
  scores: { retrievalScore: number; reasoningScore: number; synthesisScore: number },
  comment?: string,
): Promise<void> {
  await apiClient.post('/merlt/experts/feedback/detailed', { traceId, ...scores, comment });
}

export async function confirmSource(nodeId: string, entityText?: string): Promise<void> {
  await apiClient.post('/merlt/experts/confirm-source', { nodeId, entityText });
}

export async function fetchHistory(limit = 20): Promise<QaHistoryItem[]> {
  const res = await apiClient.get<QaHistoryItem[]>('/merlt/experts/history', { params: { limit } });
  return res.data;
}

/**
 * Wave 2 (history completeness, review P2.6): fetch the FULL pipeline trace of
 * a past deliberation (BFF GET /experts/trace/:traceId → MERL-T GET
 * /api/v1/experts/trace/{trace_id}). The trace is loose/evolving JSON, so the
 * transport stays `unknown` — `extractTraceDetails` (traceDetails.ts) parses
 * it into the deliberation details. A 404 means the trace expired or was never
 * stored: callers keep the slim history turn (graceful degradation).
 */
export async function fetchQaTrace(traceId: string): Promise<unknown> {
  const res = await apiClient.get<unknown>(`/merlt/experts/trace/${encodeURIComponent(traceId)}`);
  return res.data;
}
