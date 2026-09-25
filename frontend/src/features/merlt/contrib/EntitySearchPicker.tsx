import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { searchGraph } from '../graph/shared/graphApi';
import type { GraphSearchItem } from '../graph/shared/types';
import { isResolvedRelationEndpoint } from './relationEndpoints';

export interface EntitySearchPickerProps {
  onSelect: (item: GraphSearchItem) => void;
  /** Accessible name of the input (one picker per relation end). */
  ariaLabel: string;
  /** Pre-filled with the name the extractor wrote, so matches show at once. */
  initialQuery?: string;
}

type SearchState =
  | { phase: 'idle' }
  | { phase: 'searching' }
  | { phase: 'success'; items: GraphSearchItem[]; term: string }
  | { phase: 'error' };

const DEBOUNCE_MS = 300;
const RESULT_LIMIT = 8;

/**
 * Graph-node picker for a relation endpoint (B1). Same behaviour as the
 * explorer's GraphSearchBox: 300ms debounce over GET /api/merlt/graph/search,
 * latest query wins (a monotonically increasing request id discards stale
 * responses), arrow/Enter/Esc keyboard navigation; the pre-filled name is
 * searched on first focus. The results render inline
 * rather than as a floating dropdown, because the picker sits inside a card
 * list, and only identifiers a relation can point at are offered (no
 * provisional `live:` ids, no bare names).
 */
export function EntitySearchPicker({ onSelect, ariaLabel, initialQuery = '' }: EntitySearchPickerProps) {
  const listboxId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [state, setState] = useState<SearchState>({ phase: 'idle' });
  const [highlighted, setHighlighted] = useState(-1);
  // The pre-filled name is only searched once the user reaches the field: a
  // review list can hold many relation cards, two pickers each, and none of
  // them should query the graph just by being rendered.
  const [armed, setArmed] = useState(false);
  const requestIdRef = useRef(0);

  // Query changed: drop stale results during render (gotcha #11), never a
  // synchronous setState inside the effect below.
  const [trackedQuery, setTrackedQuery] = useState(query);
  if (query !== trackedQuery) {
    setTrackedQuery(query);
    setHighlighted(-1);
    setState(query.trim() ? { phase: 'searching' } : { phase: 'idle' });
  }

  useEffect(() => {
    requestIdRef.current += 1;
    const term = query.trim();
    if (!armed || !term) return;
    const requestId = requestIdRef.current;
    const timer = setTimeout(() => {
      searchGraph(term, RESULT_LIMIT)
        .then((items) => {
          if (requestId !== requestIdRef.current) return; // a newer query won
          const usable = (Array.isArray(items) ? items : []).filter((item) =>
            isResolvedRelationEndpoint(item.id) && !item.id.toLowerCase().startsWith('live:'),
          );
          setState({ phase: 'success', items: usable, term });
        })
        .catch(() => {
          if (requestId !== requestIdRef.current) return;
          setState({ phase: 'error' });
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, armed]);

  const arm = (): void => {
    if (armed) return;
    setArmed(true);
    if (query.trim()) setState({ phase: 'searching' });
  };

  const results = state.phase === 'success' ? state.items : [];

  const choose = (item: GraphSearchItem): void => {
    onSelect(item);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      if (results.length > 0) {
        e.preventDefault();
        choose(results[highlighted >= 0 ? highlighted : 0]);
      }
    } else if (e.key === 'Escape') {
      setHighlighted(-1);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        <input
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={results.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={highlighted >= 0 ? `${listboxId}-${highlighted}` : undefined}
          value={query}
          onFocus={arm}
          onChange={(e) => {
            setArmed(true);
            setQuery(e.target.value);
          }}
          onKeyDown={onKeyDown}
          placeholder="Cerca un concetto o una norma nel grafo"
          className="w-full rounded-lg border border-slate-300 py-2 pl-8 pr-8 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-700 dark:bg-slate-950"
        />
        {state.phase === 'searching' && (
          <span role="status" aria-label="Ricerca in corso" className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
          </span>
        )}
      </div>

      {results.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={`Risultati: ${ariaLabel}`}
          className="max-h-48 overflow-auto rounded-lg border border-slate-200 bg-white py-1 dark:border-slate-700 dark:bg-slate-900"
        >
          {results.map((item, i) => (
            <li
              key={item.id}
              id={`${listboxId}-${i}`}
              role="option"
              aria-selected={i === highlighted}
              onMouseEnter={() => setHighlighted(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(item);
              }}
              className={`flex min-h-[44px] cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm md:min-h-0 ${
                i === highlighted ? 'bg-primary-50 dark:bg-slate-700' : ''
              }`}
            >
              <span className="truncate text-slate-800 dark:text-slate-100">{item.nome ?? item.id}</span>
              {item.tipo && <span className="shrink-0 text-xs text-slate-400">{item.tipo}</span>}
            </li>
          ))}
        </ul>
      )}

      {state.phase === 'success' && results.length === 0 && (
        <p role="status" className="text-xs text-slate-500 dark:text-slate-400">
          Nessun nodo del grafo per «{state.term}». Prova un altro termine o scegli una norma.
        </p>
      )}
      {state.phase === 'error' && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          Ricerca nel grafo non disponibile. Riprova.
        </p>
      )}
    </div>
  );
}
