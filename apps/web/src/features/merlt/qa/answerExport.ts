import type { QaAnswer } from './types';

/**
 * Diagnostic bundle for one Q&A answer: EVERYTHING the client holds, most
 * importantly the raw `pipeline_trace` (per-canon tool_calls with params +
 * success + error, react_steps, expert_executions) plus sources, retrieved
 * sources, the graph walk and metrics. This is the exact payload needed to
 * diagnose a bad answer offline — the user downloads it and shares the file.
 */
export function buildAnswerExport(answer: QaAnswer, question: string): Record<string, unknown> {
  return {
    _kind: 'merlt-qa-answer-export',
    _version: 1,
    exportedAt: new Date().toISOString(),
    question,
    answer,
  };
}

/** Trigger a browser download of {@link buildAnswerExport} as a `.json` file. */
export function downloadAnswerJson(answer: QaAnswer, question: string): void {
  const bundle = buildAnswerExport(answer, question);
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const el = document.createElement('a');
  el.href = url;
  el.download = `merlt-answer-${answer.trace_id || 'senza-trace'}.json`;
  document.body.appendChild(el);
  el.click();
  el.remove();
  URL.revokeObjectURL(url);
}
