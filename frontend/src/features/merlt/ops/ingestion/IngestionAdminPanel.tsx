import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { listBatches } from './opsIngestionApi';
import { IngestionRunForm } from './IngestionRunForm';
import { BatchListTable } from './BatchListTable';
import { BatchDetailPanel } from './BatchDetailPanel';
import type { BatchSummary, IngestionBatchStatus } from './types';

type BatchesState =
  | { status: 'loading' }
  | { status: 'success'; batches: BatchSummary[] }
  | { status: 'error' };

// Exhaustive Record (not a couple of hardcoded Sets) so adding a new status
// to the BFF contract breaks the BUILD here instead of silently dropping
// batches from every section.
type BatchSection = 'in_progress' | 'pending_review' | 'history';
const STATUS_SECTION: Record<IngestionBatchStatus, BatchSection> = {
  parsing: 'in_progress',
  promoting: 'in_progress',
  pending_review: 'pending_review',
  promoted: 'history',
  rejected: 'history',
  failed: 'history',
};

const LIST_LIMIT = 100;

/**
 * Admin panel for the governed MECHANICAL ingestion pipeline (piece 4 — the
 * "Ingestione" tab in AdminPage, opsVisible-gated). Fetches the batch list
 * once and splits it client-side into three sections (in-progress /
 * pending_review / history) since the BFF list endpoint filters by a single
 * status at a time.
 */
export function IngestionAdminPanel() {
  const [state, setState] = useState<BatchesState>({ status: 'loading' });
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  // fetchBatches is called from 4 sites (mount effect, manual refresh,
  // run-form onStarted, detail-panel onQueueRefreshNeeded) — without a
  // request sequence guard, an in-flight response from an earlier call can
  // resolve AFTER a later one and overwrite fresher data (e.g. a
  // just-started batch briefly disappearing). `reqSeq` keeps only the latest
  // response; `mountedRef` drops any response that lands after teardown.
  const reqSeq = useRef(0);
  const mountedRef = useRef(true);

  // Fetch WITHOUT flipping to the loading state first — safe to call directly
  // from an effect body (setState only happens inside the resolved-promise
  // callback, the react-hooks/set-state-in-effect-sanctioned pattern) and
  // avoids a flash back to the spinner on background refreshes (run-form
  // start, detail-panel settle notifications).
  const fetchBatches = useCallback((): void => {
    const seq = ++reqSeq.current;
    listBatches({ limit: LIST_LIMIT })
      .then((res) => {
        if (!mountedRef.current || seq !== reqSeq.current) return;
        setState({ status: 'success', batches: res.batches });
      })
      .catch((err) => {
        if (!mountedRef.current || seq !== reqSeq.current) return;
        console.error('IngestionAdminPanel: failed to load batches:', err);
        setState({ status: 'error' });
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchBatches();
    return () => {
      // Cleanup writes a constant (not a read of ref.current), so
      // react-hooks/exhaustive-deps stays quiet — unlike bumping reqSeq here.
      mountedRef.current = false;
    };
  }, [fetchBatches]);

  // Manual refresh (button click, not an effect) — explicit spinner feedback.
  const handleRefresh = useCallback((): void => {
    setState({ status: 'loading' });
    fetchBatches();
  }, [fetchBatches]);

  const inProgress =
    state.status === 'success' ? state.batches.filter((b) => STATUS_SECTION[b.status] === 'in_progress') : [];
  const pendingReview =
    state.status === 'success' ? state.batches.filter((b) => STATUS_SECTION[b.status] === 'pending_review') : [];
  const history =
    state.status === 'success' ? state.batches.filter((b) => STATUS_SECTION[b.status] === 'history') : [];

  return (
    <div className="space-y-6">
      <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Avvia nuovo batch</h3>
          <button
            onClick={handleRefresh}
            disabled={state.status === 'loading'}
            className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
            title="Aggiorna elenco"
          >
            <RefreshCw size={16} className={state.status === 'loading' ? 'animate-spin' : ''} />
          </button>
        </div>
        <IngestionRunForm
          onStarted={(res) => {
            setSelectedBatchId(res.batch_id);
            fetchBatches();
          }}
        />
      </section>

      {state.status === 'loading' && (
        <p className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Loader2 className="animate-spin" size={16} /> Caricamento batch…
        </p>
      )}
      {state.status === 'error' && (
        <p role="alert" className="text-sm text-amber-600 dark:text-amber-400">
          Elenco batch non disponibile al momento.
        </p>
      )}

      {state.status === 'success' && (
        <>
          {inProgress.length > 0 && (
            <BatchListTable
              title="In elaborazione"
              batches={inProgress}
              emptyLabel="Nessun batch in elaborazione."
              onSelect={setSelectedBatchId}
            />
          )}
          <BatchListTable
            title="Da revisionare"
            batches={pendingReview}
            emptyLabel="Nessun batch in attesa di revisione."
            onSelect={setSelectedBatchId}
          />
          <BatchListTable
            title="Storico"
            batches={history}
            emptyLabel="Nessun batch concluso."
            onSelect={setSelectedBatchId}
            showReviewInfo
          />
        </>
      )}

      {selectedBatchId && (
        <BatchDetailPanel
          batchId={selectedBatchId}
          onClose={() => setSelectedBatchId(null)}
          onQueueRefreshNeeded={fetchBatches}
        />
      )}
    </div>
  );
}
