import { useState } from 'react';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Search } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { TOUCH_TARGET_RESPONSIVE } from '../../../../constants/interactions';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
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
    <div className="space-y-3 rounded-[8px] border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Anni" className="flex items-center gap-1.5">
          <div className="w-20">
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="dal"
              aria-label="Dall’anno"
              value={draft.from}
              onChange={(e) => typeYear('from', e.target.value)}
              className="px-2"
            />
          </div>
          <span aria-hidden="true" className="text-xs text-slate-400">–</span>
          <div className="w-20">
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="al"
              aria-label="All’anno"
              value={draft.to}
              onChange={(e) => typeYear('to', e.target.value)}
              className="px-2"
            />
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onChange({ ...filters, order: order === 'desc' ? 'asc' : 'desc' })}
          icon={<OrderIcon size={14} aria-hidden="true" />}
          className="gap-1.5 px-2 text-xs"
        >
          {order === 'desc' ? 'Dal più recente' : 'Dal meno recente'}
        </Button>
        <div className="min-w-[10rem] flex-1">
          <Input
            type="search"
            icon={<Search size={14} aria-hidden="true" />}
            placeholder="Filtra per parola…"
            aria-label="Filtra per parola"
            value={text}
            onChange={(e) => onChange({ ...filters, text: e.target.value })}
          />
        </div>
      </div>

      {counts.length > 0 && (
        <div role="group" aria-label="Anni delle decisioni" className="flex flex-wrap items-center gap-1.5">
          {shownCounts.map(({ year, n, approx }) => {
            const pressed = range.from === year && range.to === year;
            return (
              // bare-button: a year's chip, pressed while it narrows the list (the app has no common chip yet).
              <button
                key={year}
                type="button"
                aria-pressed={pressed}
                onClick={() => pickYear(year)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                  TOUCH_TARGET_RESPONSIVE,
                  pressed
                    ? 'border-primary-600 bg-primary-600 dark:bg-toga-400 dark:hover:bg-toga-300 dark:text-ink-950 dark:border-toga-400 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
                )}
              >
                {approx ? `${year} (circa ${n.toLocaleString('it-IT')})` : `${year} (${n})`}
              </button>
            );
          })}
          {counts.length > CHIPS_SHOWN && (
            <Button type="button" variant="link" aria-expanded={allYears} onClick={() => setAllYears((v) => !v)} className="px-2">
              {allYears ? 'Meno anni' : `Tutti gli anni (${counts.length})`}
            </Button>
          )}
        </div>
      )}

      {isNarrowing(filters) && (
        <Button type="button" variant="link" onClick={() => onChange({ ...NO_FILTERS, order })}>
          Azzera i filtri
        </Button>
      )}
    </div>
  );
}
