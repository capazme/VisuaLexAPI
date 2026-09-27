import { useEffect, useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import { fetchHistory } from './qaApi';
import type { QaHistoryItem } from './types';

/**
 * Server-backed Q&A history (Loop β #1 option B). Fetches the user's recent
 * traces on mount; selecting one loads it into the thread. setState lives in
 * the async callback (never synchronously in the effect body).
 */
export interface QaHistoryPanelProps {
  onSelect: (item: QaHistoryItem) => void;
}

type State =
  | { status: 'loading' }
  | { status: 'success'; items: QaHistoryItem[] }
  | { status: 'error' };

export function QaHistoryPanel({ onSelect }: QaHistoryPanelProps) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchHistory(30)
      .then((items) => {
        if (!cancelled) setState({ status: 'success', items });
      })
      .catch((err) => {
        console.error('fetchHistory failed:', err);
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
        <History size={13} /> Cronologia
      </p>
      {state.status === 'loading' && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="animate-spin" size={14} /> Caricamento…
        </p>
      )}
      {state.status === 'error' && (
        <p className="text-sm text-amber-600 dark:text-amber-400">Cronologia non disponibile al momento.</p>
      )}
      {state.status === 'success' && (
        state.items.length === 0 ? (
          <p className="text-sm text-slate-400">Nessuna conversazione precedente.</p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {state.items.map((item) => (
              <li key={item.trace_id}>
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  <span className="block truncate text-sm text-slate-800 dark:text-slate-200">{item.query}</span>
                  {item.created_at && (
                    <span className="text-xs text-slate-400">
                      {new Date(item.created_at).toLocaleString('it-IT')}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
