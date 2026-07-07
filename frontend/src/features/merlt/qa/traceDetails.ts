import type {
  ExpertContribution,
  GraphTraversalEdge,
  QaDisagreementAnalysis,
  QaExpertPairConflict,
  QaReactStep,
  QaRetrievedSource,
  QaToolUsage,
} from './types';

/**
 * Wave 2 (history completeness, review P2.6): parse the RAW pipeline trace
 * (BFF GET /experts/trace/:traceId → MERL-T's stored `PipelineTrace.to_dict()`)
 * back into the three deliberation details the slim history DTO drops, so a
 * reopened debate recovers its canvas overlay, per-canon theses and sources.
 *
 * Trace shape (merlt/experts/pipeline_types.py PipelineTrace.to_dict):
 *   stages.expert_executions[*] → { expert_type, confidence,
 *     output.interpretation_preview, retrieval_trace.top_sources[] }
 *   stages.gating.weights       → { <expert>: number }
 *   stages.synthesis.disagreement_analysis → DisagreementAnalysis.to_dict()
 *
 * The trace is loose/evolving JSON, so every access is defensively narrowed —
 * a malformed or empty trace degrades to empty details, never a throw. Note
 * the theses recovered here are the trace's `interpretation_preview` (~300
 * chars), not the live answer's full text: enough for the overlay + a readable
 * per-canon summary.
 */

export interface QaTraceDetails {
  retrievedSources: QaRetrievedSource[];
  expertContributions: ExpertContribution[];
  disagreement: QaDisagreementAnalysis | null;
  toolUsages: QaToolUsage[];
  graphTraversal: GraphTraversalEdge[];
  reactSteps: QaReactStep[];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function parseConflicts(v: unknown): QaExpertPairConflict[] {
  const out: QaExpertPairConflict[] = [];
  for (const raw of asArray(v)) {
    const c = asRecord(raw);
    if (!c) continue;
    const expertA = asString(c.expert_a);
    const expertB = asString(c.expert_b);
    if (!expertA || !expertB) continue;
    out.push({
      expert_a: expertA,
      expert_b: expertB,
      conflict_score: asNumber(c.conflict_score),
      contention_point: asString(c.contention_point),
      excerpt_a: asString(c.excerpt_a),
      excerpt_b: asString(c.excerpt_b),
    });
  }
  return out;
}

const DISAGREEMENT_SOURCES = new Set(['heuristic', 'model-untrained', 'model-trained']);

function asDisagreementSource(v: unknown): QaDisagreementAnalysis['source'] {
  return typeof v === 'string' && DISAGREEMENT_SOURCES.has(v)
    ? (v as NonNullable<QaDisagreementAnalysis['source']>)
    : null;
}

function parseDisagreement(v: unknown): QaDisagreementAnalysis | null {
  const d = asRecord(v);
  if (!d || typeof d.has_disagreement !== 'boolean') return null;
  return {
    has_disagreement: d.has_disagreement,
    disagreement_type: asString(d.disagreement_type),
    disagreement_level: asString(d.disagreement_level),
    intensity: asNumber(d.intensity),
    resolvability: asNumber(d.resolvability),
    confidence: asNumber(d.confidence),
    conflicts: parseConflicts(d.conflicts),
    pairwise_matrix: null, // not needed by the FE surfaces; skip re-validation
    source: asDisagreementSource(d.source),
  };
}

/**
 * One canon's `tool_calls[*]` entry: `{tool_name, success, result_count, error,
 * duration_ms, parameters}`. Defensive on every field — the trace is loose,
 * evolving JSON; a malformed entry is skipped rather than fabricating zeros.
 */
function parseToolUsages(expert: string, toolCalls: unknown): QaToolUsage[] {
  const out: QaToolUsage[] = [];
  for (const raw of asArray(toolCalls)) {
    const call = asRecord(raw);
    if (!call) continue;
    const toolName = asString(call.tool_name);
    if (!toolName) continue;
    out.push({
      expert,
      toolName,
      success: call.success === true,
      resultCount: typeof call.result_count === 'number' && Number.isFinite(call.result_count) ? call.result_count : null,
      error: asString(call.error),
      durationMs: asNumber(call.duration_ms),
    });
  }
  return out;
}

/**
 * Extract every canon's `tool_calls` off the RAW trace's `expert_executions`
 * (same stage `extractTraceDetails` reads). Exposed standalone so `qaApi.ts`
 * can parse the LIVE `pipeline_trace` blob (not just the stored trace fetched
 * by `fetchQaTrace`) without duplicating the traversal.
 */
export function extractToolUsages(trace: unknown): QaToolUsage[] {
  const stages = asRecord(asRecord(trace)?.stages);
  const out: QaToolUsage[] = [];
  for (const raw of asArray(stages?.expert_executions)) {
    const exec = asRecord(raw);
    if (!exec) continue;
    const expert = asString(exec.expert_type);
    if (!expert) continue;
    out.push(...parseToolUsages(expert, exec.tool_calls));
  }
  return out;
}

/**
 * One canon's `react_steps[*]` entry: `{iteration, thought, action: {name,
 * parameters, success}, observation: {results_found, novel_sources,
 * total_sources}, timestamp}`. MERL-T runs ReAct PER canon (typically 3
 * iterations each) — this lives UNDER `expert_executions[*]`, never at a
 * top-level `trace.react_steps` (that field never existed on the wire).
 * Defensive on every field — a malformed entry is skipped rather than
 * fabricating zeros.
 */
function parseReactSteps(expert: string, reactSteps: unknown): QaReactStep[] {
  const out: QaReactStep[] = [];
  for (const raw of asArray(reactSteps)) {
    const step = asRecord(raw);
    if (!step) continue;
    const action = asRecord(step.action);
    const observation = asRecord(step.observation);
    out.push({
      expert,
      iteration: asNumber(step.iteration),
      thought: asString(step.thought) ?? '',
      action: asString(action?.name) ?? '',
      success: action?.success === true,
      resultsFound:
        typeof observation?.results_found === 'number' && Number.isFinite(observation.results_found)
          ? observation.results_found
          : null,
    });
  }
  return out;
}

/**
 * Extract every canon's `react_steps` off the RAW trace's `expert_executions`
 * (same stage `extractTraceDetails` reads). Exposed standalone so `qaApi.ts`
 * can parse the LIVE `pipeline_trace` blob (not just the stored trace fetched
 * by `fetchQaTrace`) without duplicating the traversal. Mirrors
 * {@link extractToolUsages} exactly.
 */
export function extractReactSteps(trace: unknown): QaReactStep[] {
  const stages = asRecord(asRecord(trace)?.stages);
  const out: QaReactStep[] = [];
  for (const raw of asArray(stages?.expert_executions)) {
    const exec = asRecord(raw);
    if (!exec) continue;
    const expert = asString(exec.expert_type);
    if (!expert) continue;
    out.push(...parseReactSteps(expert, exec.react_steps));
  }
  return out;
}

/** One raw `graph_traversal[*]` edge → {@link GraphTraversalEdge}, or null when malformed. */
function parseTraversalEdge(raw: unknown): GraphTraversalEdge | null {
  const e = asRecord(raw);
  if (!e) return null;
  const targetUrn = asString(e.target_urn);
  const sourceUrn = asString(e.source_urn);
  const relationType = asString(e.relation_type);
  const targetType = asString(e.target_type);
  // Mirrors the API's own filter (_build_graph_traversal): target_urn is the
  // one field required for the edge to be worth replaying.
  if (!targetUrn) return null;
  return {
    iteration: asNumber(e.iteration),
    source_urn: sourceUrn ?? '',
    relation_type: relationType ?? '',
    target_urn: targetUrn,
    target_type: targetType ?? '',
  };
}

/**
 * Extract the systemic expert's graph walk off the RAW trace's
 * `expert_executions[*].graph_traversal` (mirrors the API's
 * `_build_graph_traversal`, which flattens the same field for the live
 * response). Order preserved: execution order, then per-expert edge order.
 */
export function extractGraphTraversal(trace: unknown): GraphTraversalEdge[] {
  const stages = asRecord(asRecord(trace)?.stages);
  const out: GraphTraversalEdge[] = [];
  for (const raw of asArray(stages?.expert_executions)) {
    const exec = asRecord(raw);
    if (!exec) continue;
    for (const edgeRaw of asArray(exec.graph_traversal)) {
      const edge = parseTraversalEdge(edgeRaw);
      if (edge) out.push(edge);
    }
  }
  return out;
}

export function extractTraceDetails(trace: unknown): QaTraceDetails {
  const stages = asRecord(asRecord(trace)?.stages);
  const weights = asRecord(asRecord(stages?.gating)?.weights);

  const urns: string[] = [];
  const contributions: ExpertContribution[] = [];
  const toolUsages: QaToolUsage[] = [];
  const reactSteps: QaReactStep[] = [];
  for (const raw of asArray(stages?.expert_executions)) {
    const exec = asRecord(raw);
    if (!exec) continue;

    const expert = asString(exec.expert_type);
    if (expert) {
      const thesis = asString(asRecord(exec.output)?.interpretation_preview) ?? '';
      const confidence = asNumber(exec.confidence);
      // Keep only executions that actually argued (a skipped/degenerate entry
      // with no preview AND zero confidence would fabricate "non ha
      // argomentato" rows the live answer never showed).
      if (thesis.length > 0 || confidence > 0) {
        contributions.push({
          expert,
          thesis,
          confidence,
          weight: asNumber(weights?.[expert]),
        });
      }
      toolUsages.push(...parseToolUsages(expert, exec.tool_calls));
      reactSteps.push(...parseReactSteps(expert, exec.react_steps));
    }

    for (const s of asArray(asRecord(exec.retrieval_trace)?.top_sources)) {
      const urn = typeof s === 'string' ? s : asString(asRecord(s)?.urn);
      if (urn && !urns.includes(urn)) urns.push(urn);
    }
  }

  return {
    // Provenance/trust/node_id are live FalkorDB enrichments the trace does not
    // store — the chips render urn-only for reopened debates.
    retrievedSources: urns.map((urn) => ({ urn })),
    expertContributions: contributions,
    disagreement: parseDisagreement(asRecord(stages?.synthesis)?.disagreement_analysis),
    toolUsages,
    graphTraversal: extractGraphTraversal(trace),
    reactSteps,
  };
}

/** True when the trace yielded nothing worth hydrating (treated as expired). */
export function isEmptyTraceDetails(details: QaTraceDetails): boolean {
  return (
    details.retrievedSources.length === 0 &&
    details.expertContributions.length === 0 &&
    details.disagreement === null
  );
}
