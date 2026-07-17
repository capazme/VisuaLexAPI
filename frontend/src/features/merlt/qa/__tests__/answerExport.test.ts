import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildAnswerExport, downloadAnswerJson } from '../answerExport';
import type { QaAnswer } from '../types';

function answer(): QaAnswer {
  return {
    trace_id: 'trace-xyz',
    synthesis: 'La ratio è il neminem laedere.',
    mode: 'convergent',
    alternatives: null,
    sources: [{ article_urn: 'source_1', expert: 'combined', relevance: 0, excerpt: 'x', citation: 'Art. 2043 c.c.' }],
    retrieved_sources: [],
    experts_used: ['literal'],
    confidence: 0.8,
    execution_time_ms: 100,
    // the diagnostic goldmine — must survive the export verbatim
    pipeline_trace: { stages: { expert_executions: [{ tool_calls: [{ tool_name: 'cite_law', success: false, error: 'boom' }] }] } },
  };
}

describe('buildAnswerExport', () => {
  it('bundles the question + the WHOLE answer, keeping pipeline_trace verbatim', () => {
    const bundle = buildAnswerExport(answer(), 'Qual è la ratio dell’art. 2043?');
    expect(bundle._kind).toBe('merlt-qa-answer-export');
    expect(bundle.question).toBe('Qual è la ratio dell’art. 2043?');
    const a = bundle.answer as QaAnswer;
    expect(a.trace_id).toBe('trace-xyz');
    // the trace (tool_calls + error) is what makes the export diagnosable
    const trace = a.pipeline_trace as Record<string, unknown>;
    const execs = (trace.stages as Record<string, unknown>).expert_executions as unknown[];
    expect(execs).toHaveLength(1);
    expect(typeof bundle.exportedAt).toBe('string');
  });
});

describe('downloadAnswerJson', () => {
  beforeEach(() => {
    // jsdom lacks URL.createObjectURL — stub the blob-download plumbing.
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:mock');
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it('creates a blob URL and clicks a download anchor with a trace-id filename', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadAnswerJson(answer(), 'domanda');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });
});
