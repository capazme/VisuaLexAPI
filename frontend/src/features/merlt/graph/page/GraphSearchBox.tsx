import { useEffect, useRef, useState } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { searchGraph } from '../shared/graphApi';
import type { GraphSearchItem } from '../shared/types';
import { isOpenableResult } from './graphCenter';

export interface GraphSearchBoxProps {
  onSelect: (item: GraphSearchItem) => void;
  placeholder?: string;
}

type SearchState =
  | { phase: 'idle' }
  | { phase: 'searching' }
  | { phase: 'success'; items: GraphSearchItem[]; term: string }
  | { phase: 'error' };

const DEBOUNCE_MS = 300;
const RESULT_LIMIT = 10;

/**
 * Debounced entity-search input for the explorer. Calls the BFF search proxy
 * 300ms after the user stops typing, shows an autocomplete dropdown, and
 * supports arrow/Enter/Esc keyboard navigation (Enter with no highlight picks
 * the first result). While a lookup is pending a spinner shows in the input;
 * an empty response renders an explicit "nessun risultato" row. Stale
 * responses are discarded (latest query wins) via a monotonically increasing
 * request id, and changing the query clears previous results immediately.
 * The dropdown also closes on outside click.
 */
export function GraphSearchBox({ onSelect, placeholder }: GraphSearchBoxProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ phase: 'idle' });
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const requestIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Query changed: clear stale results and flip to the searching state right
  // away — derived during render (gotcha #11), never a synchronous in-effect
  // setState. The in-flight request invalidation lives in the effect below.
  const [trackedQuery, setTrackedQuery] = useState(query);
  if (query !== trackedQuery) {
    setTrackedQuery(query);
    setHighlighted(-1);
    setState(query.trim() ? { phase: 'searching' } : { phase: 'idle' });
  }

  useEffect(() => {
    // Every query change invalidates any in-flight request for the previous
    // query — otherwise its late response would still pass the id check while
    // the new debounce timer is pending, resurrecting stale results.
    requestIdRef.current += 1;
    const term = query.trim();
    if (!term) return;

    const requestId = requestIdRef.current;
    const timer = setTimeout(() => {
      searchGraph(term, RESULT_LIMIT)
        .then((items) => {
          if (requestId !== requestIdRef.current) return; // stale
          setState({ phase: 'success', items: items.filter(isOpenableResult), term }); // C4: drop unopenable live: ids
          setOpen(true);
          setHighlighted(-1); // no pre-selection; arrow keys move into the list
        })
        .catch(() => {
          if (requestId !== requestIdRef.current) return;
          setState({ phase: 'error' });
          setOpen(true);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const results = state.phase === 'success' ? state.items : [];

  const choose = (item: GraphSearchItem): void => {
    setOpen(false);
    setQuery('');
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
      // Enter picks the highlighted result, or the first one when the user
      // hasn't arrowed into the list yet.
      if (open && results.length > 0) {
        e.preventDefault();
        choose(results[highlighted >= 0 ? highlighted : 0]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const showDropdown = open && query.trim().length > 0;

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls="graph-search-listbox"
          aria-autocomplete="list"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? 'Cerca un articolo o un concetto…'}
          className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-9 text-sm text-slate-800 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
        {state.phase === 'searching' && (
          <span
            role="status"
            aria-label="Ricerca in corso"
            className="absolute right-3 top-1/2 -translate-y-1/2"
          >
            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
          </span>
        )}
      </div>

      {showDropdown && state.phase === 'success' && results.length > 0 && (
        <ul
          id="graph-search-listbox"
          role="listbox"
          className="absolute z-40 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
        >
          {results.map((item, i) => (
            <li
              key={item.id}
              role="option"
              aria-selected={i === highlighted}
              onMouseEnter={() => setHighlighted(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(item);
              }}
              className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm ${
                i === highlighted ? 'bg-primary-50 dark:bg-slate-700' : ''
              }`}
            >
              <span className="truncate text-slate-800 dark:text-slate-100">
                {item.nome ?? item.id}
              </span>
              {item.tipo && (
                <span className="shrink-0 text-xs text-slate-400">{item.tipo}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {showDropdown && state.phase === 'success' && results.length === 0 && (
        <div
          role="status"
          className="absolute z-40 mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
        >
          Nessun risultato per «{state.term}»
        </div>
      )}

      {showDropdown && state.phase === 'error' && (
        <div
          role="alert"
          className="absolute z-40 mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
        >
          Ricerca non disponibile — riprova.
        </div>
      )}
    </div>
  );
}
