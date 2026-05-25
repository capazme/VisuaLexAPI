import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { searchGraph } from '../shared/graphApi';
import type { GraphSearchItem } from '../shared/types';

export interface GraphSearchBoxProps {
  onSelect: (item: GraphSearchItem) => void;
  placeholder?: string;
}

const DEBOUNCE_MS = 300;
const RESULT_LIMIT = 10;

/**
 * Debounced entity-search input for the explorer. Calls the BFF search proxy
 * 300ms after the user stops typing, shows an autocomplete dropdown, and
 * supports arrow/Enter/Esc keyboard navigation. Stale responses are discarded
 * (latest query wins) via a monotonically increasing request id.
 */
export function GraphSearchBox({ onSelect, placeholder }: GraphSearchBoxProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GraphSearchItem[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const term = query.trim();
    // Empty query: no request. We do NOT setState here (that would be a
    // synchronous effect update, gotcha #11) — the dropdown is gated on a
    // non-empty query during render instead.
    if (!term) return;

    const timer = setTimeout(() => {
      const requestId = ++requestIdRef.current;
      searchGraph(term, RESULT_LIMIT)
        .then((items) => {
          if (requestId !== requestIdRef.current) return; // stale
          setResults(items);
          setOpen(true);
          setHighlighted(-1); // no pre-selection; arrow keys move into the list
        })
        .catch(() => {
          if (requestId !== requestIdRef.current) return;
          setResults([]);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

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
      if (open && highlighted >= 0 && results[highlighted]) {
        e.preventDefault();
        choose(results[highlighted]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative w-full max-w-md">
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
          className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
      </div>

      {open && query.trim().length > 0 && results.length > 0 && (
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
    </div>
  );
}
