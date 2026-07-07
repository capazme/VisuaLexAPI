import { describe, it, expect } from 'vitest';
import { extractGraphTraversal, extractReactSteps, extractToolUsages, extractTraceDetails, isEmptyTraceDetails } from '../traceDetails';

/**
 * Wave 2 (history completeness, P2.6): the raw PipelineTrace JSON → the three
 * deliberation details the slim history DTO drops. The trace is loose JSON —
 * every branch must degrade to empty details, never throw.
 */

const fullTrace = {
  trace_id: 'trace_abc',
  query_text: 'art 2043?',
  stages: {
    ner: {},
    routing: {},
    expert_executions: [
      {
        expert_type: 'literal',
        confidence: 0.82,
        output: { interpretation_preview: 'Tesi letterale…' },
        retrieval_trace: { top_sources: ['urn:x~art2043', { urn: 'urn:x~art2059' }] },
      },
      {
        expert_type: 'principles',
        confidence: 0.71,
        output: { interpretation_preview: 'Tesi per principî…' },
        // Duplicate urn across canons must be deduped.
        retrieval_trace: { top_sources: ['urn:x~art2043'] },
      },
      {
        // Skipped/degenerate execution: no preview AND zero confidence → not a
        // contribution (would fabricate a "non ha argomentato" row the live
        // answer never showed).
        expert_type: 'precedent',
        confidence: 0,
        output: null,
        retrieval_trace: null,
      },
    ],
    gating: { weights: { literal: 0.42, principles: 0.58 } },
    synthesis: {
      mode: 'divergent',
      confidence: 0.5,
      disagreement_analysis: {
        has_disagreement: true,
        disagreement_type: 'interpretive',
        intensity: 0.7,
        resolvability: 0.3,
        confidence: 0.8,
        conflicts: [
          { expert_a: 'literal', expert_b: 'principles', conflict_score: 0.6, contention_point: 'ambito' },
          { expert_a: null, conflict_score: 0.9 }, // malformed → filtered
          'garbage', // malformed → filtered
        ],
      },
    },
  },
};

describe('extractTraceDetails', () => {
  it('recovers deduped urn-only sources, weighted contributions and the disagreement', () => {
    const d = extractTraceDetails(fullTrace);
    expect(d.retrievedSources).toEqual([{ urn: 'urn:x~art2043' }, { urn: 'urn:x~art2059' }]);
    expect(d.expertContributions).toEqual([
      { expert: 'literal', thesis: 'Tesi letterale…', confidence: 0.82, weight: 0.42 },
      { expert: 'principles', thesis: 'Tesi per principî…', confidence: 0.71, weight: 0.58 },
    ]);
    expect(d.disagreement).not.toBeNull();
    expect(d.disagreement?.has_disagreement).toBe(true);
    expect(d.disagreement?.disagreement_type).toBe('interpretive');
    // Malformed conflict entries are dropped, valid ones kept.
    expect(d.disagreement?.conflicts).toEqual([
      {
        expert_a: 'literal',
        expert_b: 'principles',
        conflict_score: 0.6,
        contention_point: 'ambito',
        excerpt_a: null,
        excerpt_b: null,
      },
    ]);
    expect(isEmptyTraceDetails(d)).toBe(false);
  });

  it('a canon with confidence > 0 but no preview is kept (weight defaults to 0 when ungated)', () => {
    const d = extractTraceDetails({
      stages: {
        expert_executions: [{ expert_type: 'systemic', confidence: 0.4, output: {} }],
        gating: {},
      },
    });
    expect(d.expertContributions).toEqual([
      { expert: 'systemic', thesis: '', confidence: 0.4, weight: 0 },
    ]);
  });

  it.each([null, undefined, 'not-json', 42, [], {}, { stages: 'nope' }, { stages: {} }])(
    'degrades to empty details on malformed trace %#',
    (input) => {
      const d = extractTraceDetails(input);
      expect(d.retrievedSources).toEqual([]);
      expect(d.expertContributions).toEqual([]);
      expect(d.disagreement).toBeNull();
      expect(isEmptyTraceDetails(d)).toBe(true);
    },
  );

  it('ignores a disagreement object without the has_disagreement discriminant', () => {
    const d = extractTraceDetails({
      stages: { synthesis: { disagreement_analysis: { intensity: 0.9 } } },
    });
    expect(d.disagreement).toBeNull();
  });

  it('parses tool_calls per canon into flat toolUsages', () => {
    const d = extractTraceDetails({
      stages: {
        expert_executions: [
          {
            expert_type: 'systemic',
            confidence: 0.5,
            output: { interpretation_preview: 'x' },
            tool_calls: [
              { tool_name: 'graph_search', success: true, result_count: 10, duration_ms: 120 },
              { tool_name: 'semantic_search', success: false, error: 'timeout', duration_ms: 30 },
            ],
          },
        ],
      },
    });
    expect(d.toolUsages).toEqual([
      { expert: 'systemic', toolName: 'graph_search', success: true, resultCount: 10, error: null, durationMs: 120 },
      { expert: 'systemic', toolName: 'semantic_search', success: false, resultCount: null, error: 'timeout', durationMs: 30 },
    ]);
  });

  it('parses graph_traversal per canon into the ordered walk, dropping edges with no target_urn', () => {
    const d = extractTraceDetails({
      stages: {
        expert_executions: [
          {
            expert_type: 'systemic',
            confidence: 0.5,
            output: {},
            graph_traversal: [
              { iteration: 0, source_urn: 'urn:a', relation_type: 'IMPONE', target_urn: 'urn:b', target_type: 'ModalitaGiuridica' },
              { iteration: 1, relation_type: 'X' }, // no target_urn → dropped
            ],
          },
        ],
      },
    });
    expect(d.graphTraversal).toEqual([
      { iteration: 0, source_urn: 'urn:a', relation_type: 'IMPONE', target_urn: 'urn:b', target_type: 'ModalitaGiuridica' },
    ]);
  });

  it('parses react_steps PER CANON (under expert_executions, not a top-level trace field)', () => {
    const d = extractTraceDetails({
      stages: {
        expert_executions: [
          {
            expert_type: 'literal',
            confidence: 0.5,
            output: {},
            react_steps: [
              {
                iteration: 0,
                thought: 'Verifico il tenore letterale.',
                action: { name: 'definitions_lookup', parameters: {}, success: true },
                observation: { results_found: 3, novel_sources: 1, total_sources: 3 },
                timestamp: '2026-07-07T00:00:00Z',
              },
            ],
          },
        ],
      },
    });
    expect(d.reactSteps).toEqual([
      { expert: 'literal', iteration: 0, thought: 'Verifico il tenore letterale.', action: 'definitions_lookup', success: true, resultsFound: 3 },
    ]);
  });

  it('a top-level trace.react_steps (the OLD wrong shape) is never read — regression guard for the fix', () => {
    const d = extractTraceDetails({
      // No expert_executions at all — only the legacy (bogus) top-level field.
      react_steps: [{ thought: 'ghost step' }],
      stages: {},
    });
    expect(d.reactSteps).toEqual([]);
  });
});

describe('extractToolUsages (standalone — parses the LIVE pipeline_trace)', () => {
  it('returns [] for a malformed/absent trace', () => {
    expect(extractToolUsages(undefined)).toEqual([]);
    expect(extractToolUsages('not-json')).toEqual([]);
    expect(extractToolUsages({})).toEqual([]);
  });

  it('collects tool_calls across multiple canons in execution order', () => {
    const out = extractToolUsages({
      stages: {
        expert_executions: [
          { expert_type: 'literal', tool_calls: [{ tool_name: 'definitions_lookup', success: true, result_count: 3 }] },
          { expert_type: 'precedent', tool_calls: [{ tool_name: 'case_law_search', success: true, result_count: 0 }] },
        ],
      },
    });
    expect(out.map((u) => u.expert)).toEqual(['literal', 'precedent']);
    expect(out.map((u) => u.toolName)).toEqual(['definitions_lookup', 'case_law_search']);
  });

  it('skips a tool_calls entry with no tool_name', () => {
    const out = extractToolUsages({
      stages: { expert_executions: [{ expert_type: 'literal', tool_calls: [{ success: true }] }] },
    });
    expect(out).toEqual([]);
  });
});

describe('extractReactSteps (standalone — parses the LIVE pipeline_trace)', () => {
  it('returns [] for a malformed/absent trace', () => {
    expect(extractReactSteps(undefined)).toEqual([]);
    expect(extractReactSteps('not-json')).toEqual([]);
    expect(extractReactSteps({})).toEqual([]);
  });

  it('collects react_steps across multiple canons, each with its OWN iteration count', () => {
    const out = extractReactSteps({
      stages: {
        expert_executions: [
          {
            expert_type: 'literal',
            react_steps: [
              { iteration: 0, thought: 't0', action: { name: 'definitions_lookup', success: true }, observation: { results_found: 3 } },
              { iteration: 1, thought: 't1', action: { name: 'case_law_search', success: false }, observation: {} },
            ],
          },
          {
            expert_type: 'systemic',
            react_steps: [
              { iteration: 0, thought: 't0-sys', action: { name: 'graph_search', success: true }, observation: { results_found: 5 } },
            ],
          },
        ],
      },
    });
    expect(out).toEqual([
      { expert: 'literal', iteration: 0, thought: 't0', action: 'definitions_lookup', success: true, resultsFound: 3 },
      { expert: 'literal', iteration: 1, thought: 't1', action: 'case_law_search', success: false, resultsFound: null },
      { expert: 'systemic', iteration: 0, thought: 't0-sys', action: 'graph_search', success: true, resultsFound: 5 },
    ]);
  });

  it('defaults missing thought/action/observation to empty/false/null (defensive, never throws)', () => {
    const out = extractReactSteps({
      stages: { expert_executions: [{ expert_type: 'literal', react_steps: [{ iteration: 0 }] }] },
    });
    expect(out).toEqual([{ expert: 'literal', iteration: 0, thought: '', action: '', success: false, resultsFound: null }]);
  });

  it('skips an execution with no expert_type', () => {
    const out = extractReactSteps({
      stages: { expert_executions: [{ react_steps: [{ iteration: 0, thought: 'orphan' }] }] },
    });
    expect(out).toEqual([]);
  });
});

describe('extractGraphTraversal (standalone)', () => {
  it('returns [] for a malformed/absent trace', () => {
    expect(extractGraphTraversal(undefined)).toEqual([]);
    expect(extractGraphTraversal(null)).toEqual([]);
    expect(extractGraphTraversal(42)).toEqual([]);
  });

  it('flattens graph_traversal across canons, preserving execution + edge order', () => {
    const out = extractGraphTraversal({
      stages: {
        expert_executions: [
          {
            expert_type: 'systemic',
            graph_traversal: [
              { iteration: 0, source_urn: 'urn:a', relation_type: 'IMPONE', target_urn: 'urn:b', target_type: 'X' },
              { iteration: 1, source_urn: 'urn:b', relation_type: 'PREVEDE', target_urn: 'urn:c', target_type: 'Y' },
            ],
          },
        ],
      },
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ iteration: 0, source_urn: 'urn:a', relation_type: 'IMPONE', target_urn: 'urn:b', target_type: 'X' });
    expect(out[1].target_urn).toBe('urn:c');
  });

  it('defaults missing source_urn/relation_type/target_type to empty strings (defensive, never throws)', () => {
    const out = extractGraphTraversal({
      stages: { expert_executions: [{ expert_type: 'systemic', graph_traversal: [{ target_urn: 'urn:only' }] }] },
    });
    expect(out).toEqual([{ iteration: 0, source_urn: '', relation_type: '', target_urn: 'urn:only', target_type: '' }]);
  });
});
