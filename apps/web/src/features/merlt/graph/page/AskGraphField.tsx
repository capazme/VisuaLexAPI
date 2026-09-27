import { useState } from 'react';
import { Loader2, Lock, MessageSquare, Send, X } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { QaMode } from '../../qa/types';

/**
 * Header / column "Chiedi al grafo" field (Slice 4 P1, design §3–4). Distinct
 * from the node-search box: a MESSAGE icon (not a lens), so the jurist ASKS the
 * deliberation engine rather than searching a node. Submits `question + mode`
 * via `onAsk`; the page owns `useQaThread` AND the context basket, so the field
 * is purely presentational.
 *
 * Context basket (nodes-as-context): the page passes the selected nodes as
 * `contextItems`; each renders as a removable chip above the input, and the page
 * sends them as MERL-T `context.entities` at ask time (the field itself carries
 * no context in `onAsk` — the page reads its own basket). Empty basket = an
 * unanchored ask. When `disabled` (below the D2 `basic` consent floor) the input
 * is inert and a compact "serve il consenso base" hint replaces the affordances.
 */

/** One chip in the context basket — a node the jurist selected as context. */
export interface ContextChip {
  /** Graph node id — stable key for dedup + removal. */
  id: string;
  /** Human label shown on the chip. */
  label: string;
}

export interface AskGraphFieldProps {
  /** The context basket (selected nodes). Empty/absent = unanchored ask. */
  contextItems?: ContextChip[];
  /** Remove one node from the basket. Absent → chips render without a remove ×. */
  onRemoveContext?: (id: string) => void;
  /** Asking not unlocked (consent < basic): the field is inert + shows the hint. */
  disabled?: boolean;
  /**
   * P1.10: a deliberation is already in flight — submission is blocked until it
   * settles (one collegial run at a time). The page owns the in-flight state and
   * threads it to BOTH instances (header + column composer) so they stay in sync.
   * Typing stays enabled: the next question can be drafted while waiting.
   */
  busy?: boolean;
  onAsk: (question: string, mode: QaMode) => void;
}

export function AskGraphField({
  contextItems = [],
  onRemoveContext,
  disabled = false,
  busy = false,
  onAsk,
}: AskGraphFieldProps): React.ReactElement {
  const [value, setValue] = useState('');
  const [mode, setMode] = useState<QaMode>('convergent');

  const hasContext = contextItems.length > 0;
  const placeholder = hasContext ? 'Chiedi sul contesto selezionato…' : 'Chiedi al grafo…';

  const submit = (): void => {
    const q = value.trim();
    if (!q || disabled || busy) return;
    onAsk(q, mode);
    setValue('');
  };

  if (disabled) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
        <Lock size={14} className="shrink-0" />
        <span>Per chiedere al grafo serve il consenso base.</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm focus-within:ring-2 focus-within:ring-primary-500 dark:border-slate-700 dark:bg-slate-900">
      {hasContext && (
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 px-2 py-1.5 dark:border-slate-800">
          <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Contesto
          </span>
          {contextItems.map((item) => (
            <span
              key={item.id}
              className="inline-flex max-w-[10rem] items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-700 dark:bg-primary-950/40 dark:text-primary-300"
            >
              <span className="truncate" title={item.label}>
                {item.label}
              </span>
              {onRemoveContext && (
                <button
                  type="button"
                  onClick={() => onRemoveContext(item.id)}
                  aria-label={`Rimuovi ${item.label} dal contesto`}
                  title="Rimuovi dal contesto della domanda"
                  className="shrink-0 rounded-full p-0.5 hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-primary-900/50"
                >
                  <X size={10} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 px-2 py-1.5">
        <MessageSquare size={16} className="shrink-0 text-primary-500" aria-hidden="true" />
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          aria-label="Chiedi al grafo"
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-white"
        />
        <div
          role="radiogroup"
          aria-label="Modalità di risposta"
          className="hidden shrink-0 rounded-md border border-slate-200 p-0.5 text-[11px] dark:border-slate-700 sm:inline-flex"
        >
          {(['convergent', 'divergent'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                'rounded px-2 py-0.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                mode === m
                  ? 'bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
              )}
            >
              {m === 'convergent' ? 'Sintesi' : 'Tesi'}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={!value.trim() || busy}
          aria-label="Chiedi al grafo"
          title={busy ? 'Attendi la deliberazione in corso…' : undefined}
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-primary-700 disabled:bg-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:disabled:bg-slate-700 dark:focus-visible:ring-offset-slate-900"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Chiedi
        </button>
      </div>
    </div>
  );
}
