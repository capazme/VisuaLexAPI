import type { QaAnswer } from './types';

/**
 * Dev-mode panel: the pipeline trace behind one answer (NER, routing, per-stage
 * timings, metrics) plus the raw JSON. Shape-tolerant — the backend trace varies,
 * so it renders friendly summaries when known keys exist and always offers the
 * raw trace as the reliable fallback. Rendered only when dev mode is on.
 */

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function QaProcessTrace({ answer }: { answer: QaAnswer }) {
  const trace = asRecord(answer.pipeline_trace);
  const metrics = asRecord(answer.pipeline_metrics);
  const stageTimes = trace ? asRecord(trace.stage_times_ms) : null;
  const ner = trace ? asRecord(trace.ner_result) : null;
  const routing = trace ? asRecord(trace.routing) : null;
  const nerEntities = ner && Array.isArray(ner.entities) ? (ner.entities as unknown[]) : [];

  return (
    <details
      className="mt-3 rounded-lg border border-amber-200 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/10"
      data-testid="qa-process-trace"
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-amber-700 dark:text-amber-300">
        Dettagli processo (dev)
      </summary>
      <div className="space-y-3 border-t border-amber-200 p-3 text-xs dark:border-amber-900/40">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-600 dark:text-slate-300">
          <div className="flex justify-between">
            <dt>Tempo totale</dt>
            <dd className="font-medium">{answer.execution_time_ms} ms</dd>
          </div>
          <div className="flex justify-between">
            <dt>Confidenza</dt>
            <dd className="font-medium">{answer.confidence.toFixed(2)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Canoni interpellati</dt>
            <dd className="font-medium">{answer.experts_used.length}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Fonti consultate</dt>
            <dd className="font-medium">{answer.retrieved_sources.length}</dd>
          </div>
          {routing?.method != null && (
            <div className="flex justify-between">
              <dt>Routing</dt>
              <dd className="font-medium">{String(routing.method)}</dd>
            </div>
          )}
          {ner?.query_type != null && (
            <div className="flex justify-between">
              <dt>Tipo query</dt>
              <dd className="font-medium">{String(ner.query_type)}</dd>
            </div>
          )}
        </dl>

        {nerEntities.length > 0 && (
          <div>
            <p className="mb-1 font-semibold uppercase tracking-wide text-slate-400">
              Entità NER ({nerEntities.length})
            </p>
            <div className="flex flex-wrap gap-1">
              {nerEntities.map((e, i) => {
                const ent = asRecord(e);
                const text = ent && typeof ent.text === 'string' ? ent.text : JSON.stringify(e);
                const type = ent && typeof ent.type === 'string' ? ent.type : null;
                return (
                  <span
                    key={i}
                    className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  >
                    {text}
                    {type ? ` · ${type}` : ''}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {stageTimes && Object.keys(stageTimes).length > 0 && (
          <div>
            <p className="mb-1 font-semibold uppercase tracking-wide text-slate-400">Tempi per stage (ms)</p>
            <ul className="space-y-0.5">
              {Object.entries(stageTimes).map(([k, v]) => (
                <li key={k} className="flex justify-between">
                  <span>{k}</span>
                  <span className="font-mono">{typeof v === 'number' ? Math.round(v) : String(v)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {trace || metrics ? (
          <details>
            <summary className="cursor-pointer text-slate-500">Trace grezzo (JSON)</summary>
            <pre className="mt-1 max-h-80 overflow-auto rounded bg-slate-900 p-2 text-[11px] leading-relaxed text-slate-100">
              {JSON.stringify({ pipeline_trace: trace, pipeline_metrics: metrics }, null, 2)}
            </pre>
          </details>
        ) : (
          <p className="text-slate-400">Nessun trace disponibile per questa risposta.</p>
        )}
      </div>
    </details>
  );
}
