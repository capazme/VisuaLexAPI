import { AlertTriangle, AlertOctagon } from 'lucide-react';
import type { ConflictReport } from './types';

export interface ConflictReportPanelProps {
  report: ConflictReport;
}

/**
 * Renders the batch's conflict report with two severity tiers: `urn_conflicts`
 * is BLOCKING (promotion needs an explicit `force`), `orphan_edges` is a
 * non-blocking WARNING. Also surfaces the plain node_new/node_updates/
 * duplicates counts for context.
 */
export function ConflictReportPanel({ report }: ConflictReportPanelProps) {
  const hasUrnConflicts = report.urn_conflicts.length > 0;
  const hasOrphanEdges = report.orphan_edges.length > 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatBox label="Nodi nuovi" value={report.stats.nodes_new} />
        <StatBox label="Nodi aggiornati" value={report.stats.nodes_update} />
        <StatBox label="Archi nuovi" value={report.stats.edges_new} />
        <StatBox label="Duplicati" value={report.stats.duplicates} />
      </div>

      {hasUrnConflicts && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20"
        >
          <div className="flex items-center gap-2 mb-2">
            <AlertOctagon size={16} className="text-red-600 dark:text-red-400 shrink-0" />
            <p className="text-sm font-semibold text-red-700 dark:text-red-300">
              {report.urn_conflicts.length} conflitto/i URN — bloccante
            </p>
          </div>
          <ul className="space-y-1.5 text-xs text-red-800 dark:text-red-200">
            {report.urn_conflicts.map((c) => (
              <li key={c.urn} className="rounded bg-white/60 dark:bg-black/20 px-2 py-1.5">
                <p className="font-mono font-medium">{c.urn}</p>
                <p className="mt-0.5 text-red-700/80 dark:text-red-300/80">
                  batch: {c.batch.tipo_documento ?? '—'} {c.batch.estremi ?? ''} vs grafo:{' '}
                  {c.graph.tipo_documento ?? '—'} {c.graph.estremi ?? ''}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasOrphanEdges && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
              {report.orphan_edges.length} arco/i orfano/i — non bloccante
            </p>
          </div>
          <ul className="space-y-1 text-xs text-amber-800 dark:text-amber-200 font-mono">
            {report.orphan_edges.slice(0, 10).map((e, idx) => (
              <li key={`${e.start}-${e.end}-${e.type}-${idx}`}>
                {e.start} —[{e.type}]→ {e.end}
              </li>
            ))}
            {report.orphan_edges.length > 10 && (
              <li className="text-amber-600 dark:text-amber-400">
                +{report.orphan_edges.length - 10} altri
              </li>
            )}
          </ul>
        </div>
      )}

      {!hasUrnConflicts && !hasOrphanEdges && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">
          Nessun conflitto rilevato.
        </p>
      )}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
      <p className="text-lg font-semibold text-slate-900 dark:text-white">{value}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}
