import { useEffect, useRef, useState } from 'react';
import { Loader2, X, CheckCircle2, Ban } from 'lucide-react';
import { Button } from '../../../../components/ui/Button';
import { BatchStatusBadge } from './BatchStatusBadge';
import { ConflictReportPanel } from './ConflictReportPanel';
import { SampleTable } from './SampleTable';
import { PromoteBatchDialog } from './PromoteBatchDialog';
import { RejectBatchDialog } from './RejectBatchDialog';
import { useBatchPoll } from './useBatchPoll';

const SAMPLE_PAGE_SIZE = 20;

export interface BatchDetailPanelProps {
  batchId: string;
  onClose: () => void;
  /** Fired on every genuine status transition (not just the terminal one) —
   *  e.g. parsing→promoting moves the batch into "In elaborazione",
   *  promoting→promoted moves it into "Storico" — so the caller refetches the
   *  queue/history lists and their badges stay in sync throughout. */
  onQueueRefreshNeeded: () => void;
}

/**
 * Detail panel for a single ingestion batch: conflict report, paginated
 * node/edge samples, and the promote/reject actions. Owns its own
 * `useBatchPoll` so it both fetches the initial detail and keeps polling
 * while the batch is transiently parsing/promoting.
 */
export function BatchDetailPanel({ batchId, onClose, onQueueRefreshNeeded }: BatchDetailPanelProps) {
  const [nodeLimit, setNodeLimit] = useState(SAMPLE_PAGE_SIZE);
  const [edgeLimit, setEdgeLimit] = useState(SAMPLE_PAGE_SIZE);
  const [restartToken, setRestartToken] = useState(0);
  const [showPromote, setShowPromote] = useState(false);
  const [showReject, setShowReject] = useState(false);

  const poll = useBatchPoll(batchId, { nodeLimit, edgeLimit, restartToken });

  // Notify the parent once the batch leaves a transient status (so the
  // background queue/history tables refresh their badges). Guarded by a ref
  // so it fires only on a genuine transition, not on every render.
  const prevStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevStatusRef.current;
    const cur = poll.status;
    if (cur === prev) return;
    prevStatusRef.current = cur;
    if (prev === null || cur === null) return;
    if (cur !== 'timeout') onQueueRefreshNeeded();
  }, [poll.status, onQueueRefreshNeeded]);

  const batch = poll.batch;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
            {batch?.scope_label ?? 'Dettaglio batch'}
          </h3>
          {batch && (
            <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-gray-500 dark:text-gray-400">
              <BatchStatusBadge status={batch.status} size="sm" />
              <span>creato da {batch.created_by ?? '—'}</span>
              {batch.error && <span className="text-red-600 dark:text-red-400">{batch.error}</span>}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Chiudi dettaglio"
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shrink-0"
        >
          <X size={18} />
        </button>
      </div>

      <div className="p-6 space-y-5">
        {!batch && poll.status === null && (
          <p className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 className="animate-spin" size={16} /> Caricamento dettaglio…
          </p>
        )}

        {poll.status === 'timeout' && !batch && (
          <p role="alert" className="text-sm text-amber-600 dark:text-amber-400">
            Dettaglio non disponibile al momento (timeout).
          </p>
        )}

        {batch && (
          <>
            {batch.conflict_report && <ConflictReportPanel report={batch.conflict_report} />}

            <SampleTable
              title="Nodi"
              items={batch.nodes_sample}
              total={batch.nodes_total}
              onLoadMore={
                batch.nodes_sample.length < batch.nodes_total
                  ? () => setNodeLimit((n) => n + SAMPLE_PAGE_SIZE)
                  : undefined
              }
            />
            <SampleTable
              title="Archi"
              items={batch.edges_sample}
              total={batch.edges_total}
              onLoadMore={
                batch.edges_sample.length < batch.edges_total
                  ? () => setEdgeLimit((n) => n + SAMPLE_PAGE_SIZE)
                  : undefined
              }
            />

            {batch.status === 'pending_review' && (
              <div className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                <Button
                  variant="danger"
                  size="sm"
                  icon={<CheckCircle2 size={16} />}
                  onClick={() => setShowPromote(true)}
                >
                  Promuovi
                </Button>
                <Button variant="secondary" size="sm" icon={<Ban size={16} />} onClick={() => setShowReject(true)}>
                  Rifiuta
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {showPromote && batch && (
        <PromoteBatchDialog
          batch={batch}
          onClose={() => setShowPromote(false)}
          onPromoted={() => {
            setShowPromote(false);
            setRestartToken((t) => t + 1);
          }}
        />
      )}
      {showReject && batch && (
        <RejectBatchDialog
          batch={batch}
          onClose={() => setShowReject(false)}
          onRejected={() => {
            setShowReject(false);
            setRestartToken((t) => t + 1);
          }}
        />
      )}
    </div>
  );
}
