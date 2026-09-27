import { formatDistanceToNow } from 'date-fns';
import { it } from 'date-fns/locale';
import { BatchStatusBadge } from './BatchStatusBadge';
import type { BatchSummary, IngestionSource } from './types';

const SOURCE_LABELS: Record<IngestionSource, string> = {
  visualex_tree: 'Albero VisuaLex',
  italia_corpus: 'italia-corpus',
};

function formatStats(batch: BatchSummary): string {
  const s = batch.stats;
  if (!s) return '—';
  const parts: string[] = [];
  if (s.nodes_new !== undefined) parts.push(`${s.nodes_new} nodi nuovi`);
  if (s.nodes_update !== undefined) parts.push(`${s.nodes_update} agg.`);
  if (s.edges_new !== undefined) parts.push(`${s.edges_new} archi nuovi`);
  if (s.duplicates !== undefined && s.duplicates > 0) parts.push(`${s.duplicates} duplicati`);
  if (s.coverage_pct !== null && s.coverage_pct !== undefined) parts.push(`${s.coverage_pct}% coverage`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export interface BatchListTableProps {
  title: string;
  batches: BatchSummary[];
  emptyLabel: string;
  onSelect: (batchId: string) => void;
  /** When true, shows the reviewed_by/promoted_at/rejected_at columns instead of created_by (history variant). */
  showReviewInfo?: boolean;
}

/**
 * Batch list table, reused for the active queue (pending_review + transient
 * statuses) and the history (promoted/rejected/failed) — the two sections
 * IngestionAdminPanel renders from a single list fetch. Age uses date-fns +
 * `it` locale with an absolute-timestamp tooltip, same pattern as
 * SharedEnvironmentCard.
 */
export function BatchListTable({
  title,
  batches,
  emptyLabel,
  onSelect,
  showReviewInfo = false,
}: BatchListTableProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          {title} ({batches.length})
        </h3>
      </div>
      {batches.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">{emptyLabel}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="px-6 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Ambito
                </th>
                <th className="px-6 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Sorgente
                </th>
                <th className="px-6 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Statistiche
                </th>
                <th className="px-6 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Stato
                </th>
                <th className="px-6 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {showReviewInfo ? 'Revisionato da' : 'Età'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {batches.map((batch) => (
                <BatchRow key={batch.id} batch={batch} onSelect={onSelect} showReviewInfo={showReviewInfo} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BatchRow({
  batch,
  onSelect,
  showReviewInfo,
}: {
  batch: BatchSummary;
  onSelect: (batchId: string) => void;
  showReviewInfo: boolean;
}) {
  const createdMs = new Date(batch.created_at).getTime();
  const ageRelative = !Number.isNaN(createdMs)
    ? formatDistanceToNow(new Date(createdMs), { addSuffix: true, locale: it })
    : null;
  const createdAbsolute = !Number.isNaN(createdMs)
    ? new Date(batch.created_at).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' })
    : undefined;

  const reviewMs = batch.promoted_at
    ? new Date(batch.promoted_at).getTime()
    : batch.rejected_at
      ? new Date(batch.rejected_at).getTime()
      : null;
  const reviewedAgo =
    reviewMs !== null && !Number.isNaN(reviewMs)
      ? formatDistanceToNow(new Date(reviewMs), { addSuffix: true, locale: it })
      : null;

  return (
    <tr
      onClick={() => onSelect(batch.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(batch.id);
        }
      }}
      className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
    >
      <td className="px-6 py-4">
        <p className="font-medium text-gray-900 dark:text-white">{batch.scope_label}</p>
        {batch.error && (
          <p className="mt-0.5 text-xs text-red-600 dark:text-red-400 line-clamp-1">{batch.error}</p>
        )}
      </td>
      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{SOURCE_LABELS[batch.source]}</td>
      <td className="px-6 py-4 text-xs text-gray-500 dark:text-gray-400">{formatStats(batch)}</td>
      <td className="px-6 py-4">
        <BatchStatusBadge status={batch.status} size="sm" />
      </td>
      <td className="px-6 py-4 text-xs text-gray-500 dark:text-gray-400">
        {showReviewInfo ? (
          <div className="space-y-0.5">
            <p>{batch.reviewed_by ?? '—'}</p>
            {reviewedAgo && <p className="text-gray-400">{reviewedAgo}</p>}
          </div>
        ) : (
          <span title={createdAbsolute}>{ageRelative ?? '—'}</span>
        )}
      </td>
    </tr>
  );
}
