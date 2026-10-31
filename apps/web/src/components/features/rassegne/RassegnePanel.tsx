import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { RassegnaPassage } from './RassegnaPassage';
import { MAX_QUERY_CHARS, MAX_WORDS, searchWords, textOfPassage, yearsOfPassage } from './rassegnaFilters';
import { useCaseLawFilters, useReportCaseLawYears } from '../search/caseLaw/caseLawFiltersContext';
import { applyCaseLawFilters, isNarrowing, type CaseLawFilters } from '../search/caseLaw/caseLawFilter';
import { yearCounts, type YearOrder } from '../search/caseLaw/caseLawYears';
import { failureOf, loadRassegne, useRassegneSummary } from './useRassegne';
import { readArticleReference, type ArticleReference } from '../../../services/rassegneService';
import type { ReadingBackEntry } from '../../../utils/readingBackStack';
import type { RassegnePasso } from './types';

type Archivio = 'civile' | 'penale';

/** Said inside the panel when a year, an archive or a search fails to load: a quiet line, never an alert. */
const UNAVAILABLE = 'Le rassegne non sono disponibili al momento.';
const NOTICE = 'text-sm text-slate-500 dark:text-slate-400';
/** The pause after the last key before the store is asked for the words typed. */
const SEARCH_DELAY_MS = 350;

const passi = (n: number): string => (n === 1 ? '1 passo' : `${n.toLocaleString('it-IT')} passi`);

function years(anni: { anno: number }[]): string {
  const values = anni.map((a) => a.anno);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? String(max) : `${min}–${max}`;
}

/** The words typed, once they have stayed the same for `delay` ms; none at once (a cleared filter waits for nothing). */
function useSettled(value: string, delay: number): string {
  const [settled, setSettled] = useState(value);
  if (value === '' && settled !== '') setSettled(''); // during render (set-state-in-effect rule)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

interface YearProps {
  urn: string;
  archivio?: Archivio;
  /** the words the store searched for: its passages already hold them */
  q?: string;
  anno: number;
  count: number;
  initial?: { items: RassegnePasso[]; next: string | null };
  besideId?: string;
  backEntry?: ReadingBackEntry;
}

function YearSection({ urn, archivio, q, anno, count, initial, besideId, backEntry }: YearProps) {
  const [open, setOpen] = useState(Boolean(initial));
  const [items, setItems] = useState<RassegnePasso[]>(initial?.items ?? []);
  const [next, setNext] = useState<string | null>(initial?.next ?? null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // narrowed by the section's controls: the cited decisions' years over what is loaded; the text
  // only when the store did not search it (the year of the review is this block's own)
  const sectionFilters = useCaseLawFilters();
  const filters: CaseLawFilters = useMemo(
    () => (q ? { ...sectionFilters, text: '' } : sectionFilters),
    [q, sectionFilters],
  );
  const years = useMemo(() => yearCounts(items, yearsOfPassage), [items]);
  useReportCaseLawYears(`rassegne-${archivio ?? 'tutte'}-${anno}`, years);
  const shown = useMemo(
    () => applyCaseLawFilters(items, { yearsOf: yearsOfPassage, textOf: textOfPassage }, filters),
    [items, filters],
  );

  const load = (cursor?: string) => {
    setLoading(true);
    setFailed(false);
    const query = { urn, anno, ...(archivio ? { archivio } : {}), ...(q ? { q } : {}), ...(cursor ? { cursor } : {}) };
    loadRassegne(query).then(
      (data) => {
        setItems((prev) => (cursor ? [...prev, ...data.items] : data.items));
        setNext(data.next_cursor);
        setLoading(false);
      },
      (err: unknown) => {
        console.error('[rassegne] year load failed', { urn, anno, cursor, searched: Boolean(q), error: failureOf(err) });
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
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {isNarrowing(filters) && items.length > 0 ? `${shown.length} di ${items.length} caricati` : passi(count)}
        </span>
      </button>
      {open && (
        <div>
          {isNarrowing(filters) && items.length > 0 && shown.length === 0 && (
            <p className="py-2 text-sm text-slate-500 dark:text-slate-400">Nessun passo caricato con i filtri selezionati.</p>
          )}
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {shown.map((p) => <RassegnaPassage key={p.id} passo={p} besideId={besideId} backEntry={backEntry} />)}
          </ul>
          {failed && <p className={NOTICE}>{UNAVAILABLE}</p>}
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

const REFERENCE_NOTICE: Record<Exclude<ArticleReference['esito'], 'articolo'>, string> = {
  non_riconosciuto: 'Riferimento non riconosciuto: prova, per esempio, «art. 1218 c.c.».',
  non_un_articolo: 'Indica un solo articolo, per esempio «art. 1218 c.c.».',
  non_disponibile: 'Il riferimento non si può leggere al momento.',
};

/** «Rassegne di un altro articolo»: a reference read by the search field's parser, then its passages here. */
function OtherArticleForm({ onFound, inputRef }: { onFound: (urn: string, label: string) => void; inputRef: RefObject<HTMLInputElement | null> }) {
  const inputId = useId();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const reference = text.trim();
    if (!reference || busy) return;
    setBusy(true);
    setNotice(null);
    void readArticleReference(reference).then((answer) => {
      setBusy(false);
      if (answer.esito === 'articolo') {
        setText('');
        onFound(answer.urn, answer.label);
      } else {
        setNotice(REFERENCE_NOTICE[answer.esito]);
      }
    });
  };

  return (
    <form onSubmit={submit} className="mb-3" role="search" aria-label="Rassegne di un altro articolo">
      <label htmlFor={inputId} className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Rassegne di un altro articolo</label>
      <div className="flex gap-2">
        <input ref={inputRef} id={inputId} type="text" value={text} maxLength={MAX_QUERY_CHARS} placeholder="Es. art. 1218 c.c."
          onChange={(e) => setText(e.target.value)}
          aria-describedby={notice ? `${inputId}-notice` : undefined}
          className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-slate-300 px-2 text-sm md:min-h-0 md:py-1 dark:border-slate-600 dark:bg-slate-900" />
        <button type="submit" disabled={busy || !text.trim()}
          className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
          {busy ? 'Cerco…' : 'Cerca'}
        </button>
      </div>
      <p id={`${inputId}-notice`} role="status" className="mt-1 text-xs text-slate-500 dark:text-slate-400">{notice ?? ''}</p>
    </form>
  );
}

export interface RassegnePanelProps {
  articleUrn?: string;
  /** The place the article is read in (a practice or one of its windows): a decision chip opens beside it. */
  besideId?: string;
  /** The way back to the article, recorded when a decision is opened from here. */
  backEntry?: ReadingBackEntry;
}

/**
 * "Nelle rassegne della Cassazione": the paragraphs of the Massimario's annual reviews whose
 * author cited this article, by year, every volume in the store. A closed row in «Giurisprudenza»
 * (a block of the section, read from the Python API's own store: no MERL-T, design
 * `2026-10-30-rassegne-without-merlt` §3 (a)).
 *
 * The section's controls reach it through `useCaseLawFilters`. Its text filter is sent to the
 * store (G-399: the words, each the start of a word, in every passage of the article, not only those
 * loaded); the cited decisions' years narrow what is loaded. Inside, «Rassegne di un altro
 * articolo» shows another article's passages by its reference, until «Torna all'articolo».
 *
 * No store, or no passage citing the article: nothing. A store that cannot answer now (503, the
 * network) leaves the panel's row alone, saying quietly where the count would be that the reviews
 * are not available; no route at all (404, an older API) is nothing too.
 */
export function RassegnePanel({ articleUrn, besideId, backEntry }: RassegnePanelProps) {
  const { order, text } = useCaseLawFilters();
  const [open, setOpen] = useState(false);
  const [archivio, setArchivio] = useState<Archivio | undefined>(undefined);
  const [other, setOther] = useState<{ urn: string; label: string } | null>(null);
  // the control pressed goes away (the form for «Torna all’articolo», and back): the focus follows
  const backRef = useRef<HTMLButtonElement>(null);
  const formInputRef = useRef<HTMLInputElement>(null);
  const focusNext = useRef<'back' | 'form' | null>(null);
  useEffect(() => {
    const target = focusNext.current === 'back' ? backRef.current : focusNext.current === 'form' ? formInputRef.current : null;
    focusNext.current = null;
    target?.focus();
  }, [other]);
  // Another article starts closed and unfiltered: the section does not remount the panel per URN.
  const [shownUrn, setShownUrn] = useState(articleUrn);
  if (shownUrn !== articleUrn) {
    setShownUrn(articleUrn);
    setOpen(false);
    setArchivio(undefined);
    setOther(null);
  }
  const words = searchWords(text);
  const q = useSettled(words.kind === 'words' ? words.q : '', SEARCH_DELAY_MS) || undefined;
  // the article's own passages, unfiltered: whether the panel is there, and its count
  const presence = useRassegneSummary(articleUrn);
  const viewUrn = other?.urn ?? articleUrn;
  const view = useRassegneSummary(viewUrn, archivio, q);

  if (!articleUrn || presence.status === 'idle' || presence.status === 'loading') return null;
  if (presence.status === 'error') {
    if (presence.absent) return null;
    // nothing to open: the row itself says it
    return (
      <div className="mt-8 flex min-h-[44px] flex-wrap items-center justify-between gap-x-3 border-t border-slate-200 pt-4 md:min-h-0 dark:border-slate-800">
        <h4 className="text-xs font-bold uppercase text-slate-600 dark:text-slate-300">Nelle rassegne della Cassazione</h4>
        <p className="text-xs text-slate-500 dark:text-slate-400">Non disponibili al momento</p>
      </div>
    );
  }
  if (presence.data.total === 0) return null;

  const toggle = () => setOpen((v) => !v);
  const showOther = (urn: string, label: string) => {
    focusNext.current = 'back';
    setArchivio(undefined);
    setOther({ urn, label });
  };
  const backToArticle = () => {
    focusNext.current = 'form';
    setArchivio(undefined);
    setOther(null);
  };

  return (
    <div className="mt-8 border-t border-slate-200 pt-4 dark:border-slate-800">
      {/* Accordion pattern: the toggle inside the heading, named by its text, state in aria-expanded alone. */}
      <h4>
        <button type="button" aria-expanded={open} onClick={toggle}
          className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0">
          <span className="text-xs font-bold uppercase text-slate-600 dark:text-slate-300">Nelle rassegne della Cassazione</span>
          <span className="flex items-center gap-2 text-xs font-normal text-slate-500 dark:text-slate-400">
            <span>{`${passi(presence.data.total)}, ${years(presence.data.anni)}`}</span>
            <ChevronDown size={16} className={cn('transition-transform duration-200', open && 'rotate-180')} />
          </span>
        </button>
      </h4>
      {open && (
        <div className="mt-3">
          {other ? (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-700 dark:text-slate-200">Rassegne su <span className="font-semibold">{other.label}</span></p>
              <button ref={backRef} type="button" onClick={backToArticle}
                className="min-h-[44px] text-xs font-medium text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 dark:text-primary-400">
                Torna all’articolo
              </button>
            </div>
          ) : (
            <OtherArticleForm onFound={showOther} inputRef={formInputRef} />
          )}
          {words.kind === 'too_many' && (
            <p className={cn('mb-2', NOTICE)}>
              {`Nelle rassegne si cercano al massimo ${MAX_WORDS} parole: il filtro vale sui passi caricati.`}
            </p>
          )}
          <PanelBody view={view} urn={viewUrn!} otherLabel={other?.label} order={order} archivio={archivio}
            onArchivio={setArchivio} besideId={besideId} backEntry={backEntry} />
        </div>
      )}
    </div>
  );
}

interface BodyProps {
  view: ReturnType<typeof useRassegneSummary>;
  urn: string;
  otherLabel?: string;
  order: YearOrder;
  archivio?: Archivio;
  onArchivio: (value: Archivio | undefined) => void;
  besideId?: string;
  backEntry?: ReadingBackEntry;
}

/** What the panel shows for the norm on screen (the article, or another one), with the words searched. */
function PanelBody({ view, urn, otherLabel, order, archivio, onArchivio, besideId, backEntry }: BodyProps) {
  if (view.status === 'idle' || view.status === 'loading') return <p className={NOTICE}>Carico le rassegne…</p>;
  if (view.status === 'error') return <p className={NOTICE}>{UNAVAILABLE}</p>;
  const { data } = view;
  const shownArchivio = view.archivio; // the year sections follow the data on screen
  const both = data.archivi.includes('civile') && data.archivi.includes('penale');

  return (
    <div aria-busy={view.pending || undefined}>
      {view.q && (
        <p role="status" className={cn('mb-2', NOTICE)}>
          {data.total === 0 ? 'Nessun passo con le parole cercate.' : `${passi(data.total)} con le parole cercate.`}
        </p>
      )}
      {!view.q && data.total === 0 && otherLabel && (
        <p className={NOTICE}>{`Nessun passo delle rassegne cita ${otherLabel}.`}</p>
      )}
      {both && (
        <div className="mb-2 flex gap-2" role="group" aria-label="Filtra per archivio">
          {([undefined, 'civile', 'penale'] as const).map((value) => (
            <button key={value ?? 'tutte'} type="button" aria-pressed={archivio === value} onClick={() => onArchivio(value)}
              className={cn('min-h-[44px] rounded px-2 text-xs md:min-h-0',
                archivio === value ? 'bg-slate-200 font-semibold dark:bg-slate-700' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800')}>
              {value === undefined ? 'Tutte' : value === 'civile' ? 'Civile' : 'Penale'}
            </button>
          ))}
        </div>
      )}
      {view.failed && <p className={cn('mb-2', NOTICE)}>{UNAVAILABLE}</p>}
      {[...data.anni].sort((a, b) => (order === 'desc' ? b.anno - a.anno : a.anno - b.anno)).map(({ anno, passi: count }) => (
        <YearSection key={`${urn}-${shownArchivio ?? ''}-${view.q ?? ''}-${anno}`} urn={urn} archivio={shownArchivio} q={view.q}
          anno={anno} count={count} besideId={besideId} backEntry={backEntry}
          initial={anno === data.anno ? { items: data.items, next: data.next_cursor } : undefined} />
      ))}
    </div>
  );
}
