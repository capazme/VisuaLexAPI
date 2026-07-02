import { useState } from 'react';
import { Lock, MessageSquare, Send } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { QaMode } from '../../qa/types';

/**
 * Header "Chiedi al grafo" field (Slice 4 P1, design §3–4). Distinct from the
 * node-search box: a MESSAGE icon (not a lens) and a placeholder prefilled with
 * the centered article ("Chiedi su {centerLabel}…"), so the jurist ASKS the
 * deliberation engine rather than searching a node. Submits `question + mode`
 * via `onAsk`; the page owns `useQaThread` and turns the submission into a turn.
 *
 * Presentational — no thread state here. When `disabled` (asking not unlocked,
 * i.e. below the D2 `basic` consent floor) the input is inert and a compact
 * "serve il consenso base" hint replaces the affordances.
 */
export interface AskGraphFieldProps {
  /** URN of the current graph center (unused for submission — the page reads it — but kept for parity/telemetry). */
  centerUrn?: string;
  /** Human label of the current center; drives the prefilled placeholder. */
  centerLabel?: string;
  /** Asking not unlocked (consent < basic): the field is inert + shows the hint. */
  disabled?: boolean;
  onAsk: (question: string, mode: QaMode) => void;
}

export function AskGraphField({
  centerUrn,
  centerLabel,
  disabled = false,
  onAsk,
}: AskGraphFieldProps): React.ReactElement {
  void centerUrn; // reserved: the page centers/threads the urn; kept in the contract.
  const [value, setValue] = useState('');
  const [mode, setMode] = useState<QaMode>('convergent');

  const placeholder = centerLabel ? `Chiedi su ${centerLabel}…` : 'Chiedi al grafo…';

  const submit = (): void => {
    const q = value.trim();
    if (!q || disabled) return;
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
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 shadow-sm focus-within:ring-2 focus-within:ring-primary-500 dark:border-slate-700 dark:bg-slate-900">
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
        disabled={!value.trim()}
        aria-label="Chiedi al grafo"
        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-primary-700 disabled:bg-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:disabled:bg-slate-700"
      >
        <Send size={13} /> Chiedi
      </button>
    </div>
  );
}
