import { useEffect, useRef, useState } from 'react';
import { BookOpen, Check, Loader2, X } from 'lucide-react';

/**
 * Natural-language picker for "Norma di riferimento".
 *
 * Replaces the raw URN textarea: the user types "art 1453 cc" (or any phrase
 * the main search bar accepts — preset aliases, ranges, etc.) and the picker
 * resolves it to the canonical URN via `POST /api/parse_query`. This lets the
 * MERL-T contribution flow reuse the parser the rest of the app is built on
 * instead of asking the user to paste NIR URNs by hand.
 */

export interface NormaPickerProps {
  value: string;
  onChange: (urn: string) => void;
  placeholder?: string;
  // Optional aria label so screen readers announce the picker's purpose.
  ariaLabel?: string;
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'recognized'; urn: string; display: string }
  | { status: 'unrecognized' }
  | { status: 'error' };

function isLikelyUrn(text: string): boolean {
  return text.startsWith('urn:') || text.includes('uri-res/N2Ls?urn:');
}

export function NormaPicker({ value, onChange, placeholder, ariaLabel }: NormaPickerProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<State>({ status: 'idle' });
  const debounceRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);

  // Debounced NL → parse_query lookup. Latest-wins: an older response that
  // resolves after a newer keystroke is discarded via the request id counter.
  useEffect(() => {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    // External-sync: this debounced effect maps the live `query` input to a
    // parse state; the synchronous transitions below are intrinsic to debounce.
    // (CLAUDE.md gotcha #11)
    if (trimmed.length < 3) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ status: 'idle' });
      return;
    }
    // Power-user escape hatch: paste a urn directly and we accept it as-is.
    if (isLikelyUrn(trimmed)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ status: 'recognized', urn: trimmed, display: trimmed });
      return;
    }
    const id = ++requestIdRef.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: 'loading' });
    debounceRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch('/parse_query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: trimmed }),
          });
          if (id !== requestIdRef.current) return; // a newer request superseded us
          if (!res.ok) {
            setState({ status: 'error' });
            return;
          }
          const data = (await res.json()) as {
            recognized: boolean;
            urn?: string | null;
            display?: string | null;
          };
          if (data.recognized && data.urn) {
            setState({
              status: 'recognized',
              urn: data.urn,
              display: data.display || data.urn,
            });
          } else {
            setState({ status: 'unrecognized' });
          }
        } catch {
          if (id === requestIdRef.current) setState({ status: 'error' });
        }
      })();
    }, 300);
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Already-selected URN: show a chip with a clear button.
  if (value) {
    return (
      <div
        className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-900 dark:bg-emerald-950/30"
        data-testid="norma-picker-selected"
      >
        <span className="flex min-w-0 items-center gap-2 text-emerald-700 dark:text-emerald-300">
          <BookOpen size={14} className="shrink-0" />
          <span className="truncate font-mono text-xs">{value}</span>
        </span>
        <button
          type="button"
          onClick={() => onChange('')}
          className="shrink-0 rounded p-1 text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
          aria-label="Rimuovi norma"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  const apply = (): void => {
    if (state.status === 'recognized') {
      onChange(state.urn);
      setQuery('');
      setState({ status: 'idle' });
    }
  };

  return (
    <div className="space-y-1.5">
      <input
        aria-label={ariaLabel ?? 'Norma di riferimento'}
        placeholder={placeholder ?? 'Es. art 1453 cc, art 3 cost, gdpr'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            apply();
          }
        }}
        className="w-full rounded-lg border border-slate-300 p-2 text-sm dark:border-slate-700 dark:bg-slate-950"
      />
      {state.status === 'loading' && (
        <p className="flex items-center gap-1.5 text-xs text-slate-500">
          <Loader2 size={12} className="animate-spin" /> Riconosco la norma…
        </p>
      )}
      {state.status === 'unrecognized' && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Non ho riconosciuto la norma. Prova "art 1453 cc", "art 3 cost", o incolla un URN.
        </p>
      )}
      {state.status === 'error' && (
        <p className="text-xs text-red-600 dark:text-red-400">Errore nel riconoscimento — riprova.</p>
      )}
      {state.status === 'recognized' && (
        <button
          type="button"
          onClick={apply}
          data-testid="norma-picker-apply"
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-left text-sm text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-950/50"
        >
          <span className="flex min-w-0 items-center gap-2">
            <BookOpen size={14} className="shrink-0" />
            <span className="truncate">{state.display}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-xs">
            <Check size={12} /> Usa
          </span>
        </button>
      )}
    </div>
  );
}
