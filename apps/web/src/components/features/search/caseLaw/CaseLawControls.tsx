import { useState } from 'react';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Search } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { TOUCH_TARGET_RESPONSIVE } from '../../../../constants/interactions';
import { isNarrowing, NO_FILTERS, type CaseLawFilters } from './caseLawFilter';
import { parseYear, type YearCount } from './caseLawYears';

/** Past this many years the chips fold behind «Tutti gli anni»: the range reaches every other. */
const CHIPS_SHOWN = 8;

interface CaseLawControlsProps {
  filters: CaseLawFilters;
  onChange: (filters: CaseLawFilters) => void;
  /** The years of the rows loaded so far, with how many rows each has. */
  counts: YearCount[];
}

const field =
  'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100';

const show = (year: number | undefined): string => (year === undefined ? '' : String(year));

/**
 * The section's controls (case-law section spec, D4 and D5), the same for every source: a range of
 * years «dal / al», a chip per year with its count, the order, and one text filter. They narrow what
 * is loaded; each block says how many of its rows they keep.
 */
export function CaseLawControls({ filters, onChange, counts }: CaseLawControlsProps) {
  const { range, text, order } = filters;
  // What is typed may not be a year yet («20»): kept as typed until it is, or until a chip sets the range
  const [draft, setDraft] = useState({ from: show(range.from), to: show(range.to) });
  const [seen, setSeen] = useState(range);
  if (seen.from !== range.from || seen.to !== range.to) {
    setSeen(range);
    setDraft({
      from: parseYear(draft.from) === (range.from ?? null) ? draft.from : show(range.from),
      to: parseYear(draft.to) === (range.to ?? null) ? draft.to : show(range.to),
    });
  }
  const [allYears, setAllYears] = useState(false);

  const typeYear = (end: 'from' | 'to', value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 4);
    setDraft((d) => ({ ...d, [end]: digits }));
    onChange({ ...filters, range: { ...range, [end]: parseYear(digits) ?? undefined } });
  };
  const pickYear = (year: number) => {
    const only = range.from === year && range.to === year;
    onChange({ ...filters, range: only ? {} : { from: year, to: year } });
  };

  const shownCounts = allYears ? counts : counts.slice(0, CHIPS_SHOWN);
  const OrderIcon = order === 'desc' ? ArrowDownWideNarrow : ArrowUpNarrowWide;

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Anni" className="flex items-center gap-1.5">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="dal"
            aria-label="Dall’anno"
            value={draft.from}
            onChange={(e) => typeYear('from', e.target.value)}
            className={cn(field, 'w-20', TOUCH_TARGET_RESPONSIVE)}
          />
          <span aria-hidden="true" className="text-xs text-slate-400">–</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="al"
            aria-label="All’anno"
            value={draft.to}
            onChange={(e) => typeYear('to', e.target.value)}
            className={cn(field, 'w-20', TOUCH_TARGET_RESPONSIVE)}
          />
        </div>
        <button
          type="button"
          onClick={() => onChange({ ...filters, order: order === 'desc' ? 'asc' : 'desc' })}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-700 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700',
            TOUCH_TARGET_RESPONSIVE,
          )}
        >
          <OrderIcon size={14} aria-hidden="true" />
          {order === 'desc' ? 'Dal più recente' : 'Dal meno recente'}
        </button>
        <div className="relative min-w-[10rem] flex-1">
          <Search size={14} aria-hidden="true" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Filtra per parola…"
            aria-label="Filtra per parola"
            value={text}
            onChange={(e) => onChange({ ...filters, text: e.target.value })}
            className={cn(field, 'w-full pl-8', TOUCH_TARGET_RESPONSIVE)}
          />
        </div>
      </div>

      {counts.length > 0 && (
        <div role="group" aria-label="Anni delle decisioni" className="flex flex-wrap items-center gap-1.5">
          {shownCounts.map(({ year, n }) => {
            const pressed = range.from === year && range.to === year;
            return (
              <button
                key={year}
                type="button"
                aria-pressed={pressed}
                onClick={() => pickYear(year)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                  TOUCH_TARGET_RESPONSIVE,
                  pressed
                    ? 'border-primary-600 bg-primary-600 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
                )}
              >
                {`${year} (${n})`}
              </button>
            );
          })}
          {counts.length > CHIPS_SHOWN && (
            <button
              type="button"
              aria-expanded={allYears}
              onClick={() => setAllYears((v) => !v)}
              className={cn('px-2 text-xs font-medium text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-400', TOUCH_TARGET_RESPONSIVE)}
            >
              {allYears ? 'Meno anni' : `Tutti gli anni (${counts.length})`}
            </button>
          )}
        </div>
      )}

      {isNarrowing(filters) && (
        <button
          type="button"
          onClick={() => onChange({ ...NO_FILTERS, order })}
          className={cn('text-xs font-medium text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-400', TOUCH_TARGET_RESPONSIVE)}
        >
          Azzera i filtri
        </button>
      )}
    </div>
  );
}
