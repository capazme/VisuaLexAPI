// apps/web/src/features/merlt/rassegne/RassegnePanel.tsx
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { RassegnaPassage } from './RassegnaPassage';
import { loadRassegne, useRassegneSummary } from './useRassegne';
import type { ReadingBackEntry } from '../../../utils/readingBackStack';
import type { RassegnePasso } from './types';

type Archivio = 'civile' | 'penale';

const passi = (n: number): string => (n === 1 ? '1 passo' : `${n.toLocaleString('it-IT')} passi`);

function years(anni: { anno: number }[]): string {
  const values = anni.map((a) => a.anno);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? String(max) : `${min}–${max}`;
}

interface YearProps {
  urn: string;
  archivio?: Archivio;
  anno: number;
  count: number;
  initial?: { items: RassegnePasso[]; next: string | null };
  besideTabId?: string;
  backEntry?: ReadingBackEntry;
}

function YearSection({ urn, archivio, anno, count, initial, besideTabId, backEntry }: YearProps) {
  const [open, setOpen] = useState(Boolean(initial));
  const [items, setItems] = useState<RassegnePasso[]>(initial?.items ?? []);
  const [next, setNext] = useState<string | null>(initial?.next ?? null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = (cursor?: string) => {
    setLoading(true);
    setFailed(false);
    const query = { urn, anno, ...(archivio ? { archivio } : {}), ...(cursor ? { cursor } : {}) };
    loadRassegne(query).then(
      (data) => {
        setItems((prev) => (cursor ? [...prev, ...data.items] : data.items));
        setNext(data.next_cursor);
        setLoading(false);
      },
      (err: unknown) => {
        console.error('[rassegne] year load failed', { urn, anno, cursor, err });
        setFailed(true);
        setLoading(false);
      },
    );
  };

  const toggle = () => {
    const opening = !open;
    setOpen(opening);
    if (opening && items.length === 0) load();
  };

  return (
    <section className="border-t border-slate-100 dark:border-slate-800">
      <button type="button" aria-expanded={open} onClick={toggle}
        className="flex min-h-[44px] w-full items-center justify-between py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Rassegna dell'anno {anno}</span>
        <span className="text-xs text-slate-500 dark:text-slate-400">{passi(count)}</span>
      </button>
      {open && (
        <div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((p) => <RassegnaPassage key={p.id} passo={p} besideTabId={besideTabId} backEntry={backEntry} />)}
          </ul>
          {failed && <p className="text-sm text-amber-600 dark:text-amber-400">Rassegne non disponibili ora.</p>}
          {next && !loading && (
            <button type="button" onClick={() => load(next)}
              className="min-h-[44px] text-xs font-medium text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 dark:text-primary-400">
              Altri passi
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export interface RassegnePanelProps {
  articleUrn?: string;
  /** The workspace tab the article is in: a decision chip opens beside it. */
  besideTabId?: string;
  /** The way back to the article, recorded when a decision is opened from here. */
  backEntry?: ReadingBackEntry;
}

/**
 * "Nelle rassegne della Cassazione": the paragraphs of the Massimario's annual reviews whose
 * author cited this article, by year. A closed row under the article text (spec §7; placement
 * per the text-as-at-a-date spec §9). Self-contained: it takes the article's URN and ignores
 * the slot's other props, bar the tab it opens decisions beside.
 */
export function RassegnePanel({ articleUrn, besideTabId, backEntry }: RassegnePanelProps) {
  const [open, setOpen] = useState(false);
  const [archivio, setArchivio] = useState<Archivio | undefined>(undefined);
  // Another article starts closed and unfiltered: the slot does not remount the panel per URN.
  const [shownUrn, setShownUrn] = useState(articleUrn);
  if (shownUrn !== articleUrn) {
    setShownUrn(articleUrn);
    setOpen(false);
    setArchivio(undefined);
  }
  const summary = useRassegneSummary(articleUrn, archivio);

  if (!articleUrn || summary.status === 'idle' || summary.status === 'loading') return null;
  if (summary.status === 'error') {
    return <p className="mt-6 text-sm text-amber-600 dark:text-amber-400">Rassegne non disponibili ora.</p>;
  }
  const { data } = summary;
  const shownArchivio = summary.archivio; // the year sections follow the data on screen
  if (data.total === 0) return null;

  const toggle = () => setOpen((v) => !v);
  const both = data.archivi.includes('civile') && data.archivi.includes('penale');

  return (
    <div className="mt-8 border-t border-slate-200 pt-4 dark:border-slate-800">
      {/* Accordion pattern: the toggle inside the heading, named by its text, state in aria-expanded alone. */}
      <h4>
        <button type="button" aria-expanded={open} onClick={toggle}
          className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0">
          <span className="text-xs font-bold uppercase text-slate-600 dark:text-slate-300">Nelle rassegne della Cassazione</span>
          <span className="flex items-center gap-2 text-xs font-normal text-slate-500 dark:text-slate-400">
            <span>{`${passi(data.total)}, ${years(data.anni)}`}</span>
            <ChevronDown size={16} className={cn('transition-transform duration-200', open && 'rotate-180')} />
          </span>
        </button>
      </h4>
      {open && (
        <div className="mt-3">
          {both && (
            <div className="mb-2 flex gap-2" role="group" aria-label="Filtra per archivio" aria-busy={summary.pending || undefined}>
              {([undefined, 'civile', 'penale'] as const).map((value) => (
                <button key={value ?? 'tutte'} type="button" aria-pressed={archivio === value} onClick={() => setArchivio(value)}
                  className={cn('min-h-[44px] rounded px-2 text-xs md:min-h-0',
                    archivio === value ? 'bg-slate-200 font-semibold dark:bg-slate-700' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800')}>
                  {value === undefined ? 'Tutte' : value === 'civile' ? 'Civile' : 'Penale'}
                </button>
              ))}
            </div>
          )}
          {summary.failed && <p className="mb-2 text-sm text-amber-600 dark:text-amber-400">Rassegne non disponibili ora.</p>}
          {data.anni.map(({ anno, passi: count }) => (
            <YearSection key={`${shownArchivio ?? ''}-${anno}`} urn={articleUrn} archivio={shownArchivio} anno={anno} count={count}
              besideTabId={besideTabId} backEntry={backEntry}
              initial={anno === data.anno ? { items: data.items, next: data.next_cursor } : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}
