// apps/web/src/components/features/decisions/DecisionResultList.tsx
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { DECISION_PAGE_SIZE } from '../../../services/decisionSearchService';
import { searchDecisionsCached } from '../../../utils/decisionSearchCache';
import { decisionPath, formatDecisionDeposit, formatDecisionShort } from '../../../utils/decisionLinks';
import { codePointRangesToUtf16 } from '../../../utils/decisionText';
import { formatDateItalianLong, withPreposition } from '../../../utils/dateUtils';
import { TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import type { ReadingBackEntry } from '../../../utils/readingBackStack';
import type { DecisionArchive, DecisionSearchHit, DecisionSearchQuery, SearchDecisionsAnswer } from '../../../types/decisions';
import { Button } from '../../ui/Button';
import { CaseLawRow } from '../search/caseLaw/CaseLawRow';
import { useCaseLawFilters, useReportCaseLawYears } from '../search/caseLaw/caseLawFiltersContext';
import { applyCaseLawFilters } from '../search/caseLaw/caseLawFilter';
import { normalizeRange, rowYear, yearCounts, type YearCount, type YearRange, type YearsOf } from '../search/caseLaw/caseLawYears';

/** The server pages by 20 and stops at the tenth page. */
const MAX_PAGE = 10;

type Page = Extract<SearchDecisionsAnswer, { esito: 'risultati' }>;
type Problem = Exclude<SearchDecisionsAnswer, { esito: 'risultati' }>;

interface DecisionResultListProps {
  query: DecisionSearchQuery;
  /** The place the list sits in (a practice or one of its windows): a decision opens beside it. */
  besideId?: string;
  /** Where the reader stands in the article: the way back from an opened decision. */
  backEntry?: ReadingBackEntry;
  /**
   * The deposit years to keep, from the section's control by default. The archive does the filtering
   * (`anno_dal`/`anno_al`): a new range starts the search again from the first page.
   */
  yearRange?: YearRange;
}

const INDEX_REFUSED = 'L’indice della Cassazione non esprime questo atto';

const KIND_LABEL: Record<DecisionSearchHit['trovata'], string> = {
  indice: 'norma citata (indice della Cassazione)',
  testo: 'menzionato nel testo',
};

const problemMessage = (problem: Problem): string => {
  switch (problem.esito) {
    case 'non_supportata':
      return 'La ricerca nelle sentenze non è disponibile per questo atto.';
    case 'richiesta_non_valida':
      // the route keeps the years from 1900 to the current one
      return problem.errori.anno_dal || problem.errori.anno_al
        ? 'Gli anni indicati non sono validi: vanno dal 1900 all’anno in corso.'
        : 'La ricerca non è valida: controllala e riprova.';
    case 'errore_interno':
      return 'La ricerca non è riuscita per un errore dell’applicazione.';
    case 'fonte_non_raggiungibile':
      return problem.fonte === 'quota'
        ? 'Hai fatto troppe ricerche in poco tempo: riprova tra qualche minuto.'
        : 'L’archivio della Cassazione non risponde in questo momento.';
  }
};

/** The matched words as `<mark>` text nodes: the fragment is the source's text, never HTML. */
function Fragment({ testo, evidenziati }: NonNullable<DecisionSearchHit['frammento']>) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [s, e] of codePointRangesToUtf16(testo, evidenziati)) {
    if (s > at) parts.push(testo.slice(at, s));
    parts.push(<mark key={s} className="bg-amber-100 dark:bg-amber-900/40">{testo.slice(s, e)}</mark>);
    at = e;
  }
  parts.push(testo.slice(at));
  return <>…{parts}…</>;
}

/** A hit's year is the deposit's (the archive's date), else the year of its number. */
const yearsOfHit: YearsOf<DecisionSearchHit> = (hit) => {
  const dated = rowYear({ date: hit.attributi.data_deposito });
  return dated.length > 0 ? dated : rowYear({ year: hit.identita.anno });
};
const labelOfHit = (hit: DecisionSearchHit): string => formatDecisionShort({ ...hit.identita, sezione: hit.attributi.sezione });
const textOfHit = (hit: DecisionSearchHit): string =>
  [labelOfHit(hit), formatDecisionDeposit(hit.attributi) ?? '', hit.frammento?.testo ?? ''].join(' ');

function Row({ hit, besideId, backEntry }: { hit: DecisionSearchHit; besideId?: string; backEntry?: ReadingBackEntry }) {
  const { identita, attributi } = hit;
  return (
    <CaseLawRow
      decision={{ ...identita, sezione: attributi.sezione }}
      authority="Cass."
      date={attributi.data_deposito}
      year={identita.anno}
      whenLabel={formatDecisionDeposit(attributi)}
      source="Archivio della Cassazione"
      badges={[KIND_LABEL[hit.trovata]]}
      besideId={besideId}
      backEntry={backEntry}
    >
      {hit.frammento && <Fragment {...hit.frammento} />}
    </CaseLawRow>
  );
}

function Segmented<T extends string>({ label, options, pressed, disabled, onPick }: {
  label: string;
  options: Array<{ value: T; text: string; title?: string; disabled?: boolean; describedBy?: string }>;
  pressed: T | null;
  disabled?: boolean;
  onPick: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={pressed === o.value}
          disabled={disabled || o.disabled}
          title={o.title}
          aria-describedby={o.describedBy}
          onClick={() => onPick(o.value)}
          className={`px-3 py-1.5 text-sm ${TOUCH_TARGET_RESPONSIVE} disabled:cursor-not-allowed disabled:opacity-50 ${
            pressed === o.value
              ? 'bg-primary-600 text-white'
              : 'bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
          }`}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

type ArchiveChoice = DecisionArchive | 'entrambi';

/**
 * The decisions that cite an article or match a topic (design 2026-10-05 §5): page one on mount,
 * «Altri risultati» appends the next up to the tenth, and the reader can change the archive and,
 * for an article, ask the Cassazione's index or the text. It says what the answer says: the
 * count of the public archive (last five years), never of "all" decisions. The archive is the
 * list's own state: it starts from what the route chooses and is not kept in the tab's query.
 */
export function DecisionResultList({ query, besideId, backEntry, yearRange }: DecisionResultListProps) {
  const refusedNoteId = useId();
  const sectionFilters = useCaseLawFilters();
  const filters = useMemo(
    () => (yearRange ? { ...sectionFilters, range: yearRange } : sectionFilters),
    [sectionFilters, yearRange],
  );
  // the years go to the archive; a range typed the wrong way round is read the right way round
  const { from: dal, to: al } = normalizeRange(filters.range);
  const [archivio, setArchivio] = useState<DecisionArchive | undefined>(undefined);
  const [modo, setModo] = useState<'indice' | 'testo'>('indice');
  const [hits, setHits] = useState<DecisionSearchHit[]>([]);
  const [last, setLast] = useState<Page | null>(null);
  // the archive's counts per year, kept while a new range loads so the chips do not flicker
  const [archiveYears, setArchiveYears] = useState<YearCount[] | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [loading, setLoading] = useState(true);
  // what the route said about this query, each tied to the query it was learned for:
  // the archive it applies on its own (null: it searches both) and whether it refused the index
  const [learned, setLearned] = useState<Record<string, { defaultArchive?: DecisionArchive | null; indexRefused?: boolean }>>({});
  // only the latest request writes: a slower earlier one is dropped
  const token = useRef(0);
  const dropPending = useCallback(() => { token.current++; }, []);

  const hasNorma = Boolean(query.norma);
  const queryKey = JSON.stringify({ norma: query.norma, tema: query.tema });
  const known = learned[queryKey] ?? null;
  // a refusal is kept for the query, so later pages and reloads ask for the text straight away; a ref, not
  // state, because `load` reads it when it runs and must not be re-created (nor re-run) when it is learned
  const refusedRef = useRef(false);
  refusedRef.current = Boolean(known?.indexRefused);

  const load = useCallback((pagina: number) => {
    const mine = ++token.current;
    setLoading(true);
    setProblem(null);
    const asked = { norma: query.norma, tema: query.tema, archivio };
    const sentModo = hasNorma ? (refusedRef.current ? 'testo' : modo) : undefined;
    searchDecisionsCached(asked, pagina, sentModo, dal === undefined && al === undefined ? undefined : { dal, al })
      .catch((error): SearchDecisionsAnswer => {
        console.error('search_decisions: no answer', error);
        return { esito: 'fonte_non_raggiungibile', fonte: 'rete' };
      })
      .then((answer) => {
        if (mine !== token.current) return;
        setLoading(false);
        if (answer.esito === 'risultati') {
          setLast(answer);
          // in index mode the counts are those of the index, before the citation re-check: approximate
          setArchiveYears(answer.anni ? answer.anni.map(({ anno, n }) => ({ year: anno, n, ...(answer.modo === 'indice' ? { approx: true } : {}) })) : null);
          // new deposits shift the pages: a decision seen already is not listed twice
          setHits((previous) => {
            if (pagina === 1) return answer.decisioni;
            const seen = new Set(previous.map((h) => decisionPath(h.identita)));
            return [...previous, ...answer.decisioni.filter((h) => !seen.has(decisionPath(h.identita)))];
          });
          const refused = sentModo === 'indice' && answer.modo === 'testo';
          if (!asked.archivio || refused) {
            setLearned((previous) => ({
              ...previous,
              [queryKey]: {
                ...previous[queryKey],
                ...(asked.archivio ? {} : { defaultArchive: answer.archivio }),
                ...(refused ? { indexRefused: true } : {}),
              },
            }));
          }
        } else {
          setProblem(answer);
        }
      });
    // query.norma and query.tema are tracked through queryKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, archivio, modo, hasNorma, dal, al]);

  // a new query, archive, mode or range of years starts again from the first page
  useEffect(() => {
    setHits([]);
    setLast(null);
    load(1);
    return dropPending;
  }, [load, dropPending]);

  // The chips: the archive's own counts per year when it sent them (all years, whatever the range),
  // else the years of the hits loaded
  const years = useMemo<YearCount[]>(() => archiveYears ?? yearCounts(hits, yearsOfHit), [archiveYears, hits]);
  useReportCaseLawYears('cassazione', years);
  // the text and the order narrow the hits loaded; the years are the archive's
  // The archive pages newest first, so the oldest first is the pages loaded reversed, not the archive's:
  // the order the reader asks for applies once every decision is loaded, and until then the archive's stands.
  const complete = last !== null && last.pagina * DECISION_PAGE_SIZE >= last.totale;
  const orderHeld = filters.order === 'asc' && !complete;
  const shownHits = useMemo(
    () => applyCaseLawFilters(hits, { yearsOf: yearsOfHit, textOf: textOfHit }, { ...filters, range: {}, order: orderHeld ? 'desc' : filters.order }),
    [hits, filters, orderHeld],
  );

  const shownModo = last?.modo ?? modo;
  const indexRefused = hasNorma && Boolean(known?.indexRefused);
  // «Entrambi» exists where the route can search both: a topic, or an article it answered with no
  // archive of its own (the Constitution, the preleggi, a numbered act), never a code's
  const canSearchBoth = !hasNorma || known?.defaultArchive === null;
  const archiveShown: ArchiveChoice | null = last
    ? (last.archivio ?? 'entrambi')
    : archivio ?? (hasNorma ? null : 'entrambi');
  const pickArchive = (choice: ArchiveChoice) => {
    if (choice === archiveShown) return; // the same query again
    const next = choice === 'entrambi' ? undefined : choice;
    setArchivio(next);
  };


  const total = last?.totale ?? 0;
  const since = last?.archivio_dal ? ` (${withPreposition('dal', formatDateItalianLong(last.archivio_dal))})` : '';
  const ranged = dal !== undefined || al !== undefined;
  const yearsPhrase = dal === undefined ? `fino al ${al}` : al === undefined ? `dal ${dal}` : dal === al ? `nel ${dal}` : `dal ${dal} al ${al}`;
  const countLine = last
    ? total === 0
      ? ranged
        ? `Nessuna decisione ${yearsPhrase} nell’archivio pubblico della Cassazione.`
        : 'Nessuna decisione negli ultimi cinque anni dell’archivio pubblico della Cassazione.'
      : `${total.toLocaleString('it-IT', { useGrouping: 'always' } as unknown as Intl.NumberFormatOptions)} ${total === 1 ? 'decisione' : 'decisioni'}${ranged ? ` ${yearsPhrase}` : ''} nell’archivio pubblico della Cassazione${since}`
    : null;
  // the text filter works on the hits loaded; the years were the archive's
  const textFiltered = filters.text.trim() !== '';
  // the route may return fewer records than `totale` counts, so the end is the count, not the rows
  const atEnd = last !== null && (last.pagina >= MAX_PAGE || last.pagina * DECISION_PAGE_SIZE >= total);
  const capped = last !== null && last.pagina >= MAX_PAGE && total > MAX_PAGE * DECISION_PAGE_SIZE;

  return (
    <section aria-label="Sentenze" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<ArchiveChoice>
          label="Archivio"
          pressed={archiveShown}
          onPick={pickArchive}
          options={[
            { value: 'civile', text: 'Civile' },
            { value: 'penale', text: 'Penale' },
            ...(canSearchBoth ? [{ value: 'entrambi' as const, text: 'Entrambi' }] : []),
          ]}
        />
        {hasNorma && (
          <Segmented<'indice' | 'testo'>
            label="Modo di ricerca"
            pressed={shownModo}
            onPick={(value) => { if (value !== shownModo) setModo(value); }}
            options={[
              {
                value: 'indice',
                text: 'Indice della Cassazione',
                disabled: indexRefused,
                title: indexRefused ? INDEX_REFUSED : undefined,
                describedBy: indexRefused ? refusedNoteId : undefined,
              },
              { value: 'testo', text: 'Nel testo' },
            ]}
          />
        )}
      </div>
      {indexRefused && (
        <p id={refusedNoteId} className="text-xs text-slate-500 dark:text-slate-400">{INDEX_REFUSED}</p>
      )}

      {countLine && <p className="text-sm text-slate-700 dark:text-slate-200">{countLine}</p>}
      {textFiltered && hits.length > 0 && (
        <p className="text-sm text-slate-700 dark:text-slate-200">
          {shownHits.length === 0
            ? `Nessuna delle ${hits.length} decisioni caricate corrisponde ai filtri.`
            : `${shownHits.length} di ${hits.length} decisioni caricate`}
        </p>
      )}

      {orderHeld && hits.length > 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Ordinate dalla più recente: l’ordine inverso vale quando tutte le decisioni sono caricate
        </p>
      )}

      {shownHits.length > 0 && (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {shownHits.map((hit) => (
            <Row key={`${hit.identita.archivio ?? ''}:${hit.identita.numero}:${hit.identita.anno}`} hit={hit} besideId={besideId} backEntry={backEntry} />
          ))}
        </ul>
      )}

      {loading && <p role="status" className="text-sm text-slate-500 dark:text-slate-400">Ricerca in corso…</p>}

      {problem && (
        <div role="alert" className="text-sm text-slate-700 dark:text-slate-200">
          <p>{problemMessage(problem)}</p>
          {problem.esito !== 'non_supportata' && problem.esito !== 'richiesta_non_valida' && (
            <div className="mt-2">
              <Button variant="secondary" size="sm" icon={<RotateCw size={16} />} className={TOUCH_TARGET_RESPONSIVE} onClick={() => load(last ? last.pagina + 1 : 1)}>
                Riprova
              </Button>
            </div>
          )}
        </div>
      )}

      {!loading && !problem && last && !atEnd && (
        <Button variant="secondary" size="sm" className={TOUCH_TARGET_RESPONSIVE} onClick={() => load(last.pagina + 1)}>
          Altri risultati
        </Button>
      )}
      {capped && !loading && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Mostrate le prime {MAX_PAGE * DECISION_PAGE_SIZE}: restringi la ricerca con {query.tema ? 'altre parole' : 'un tema'}.
        </p>
      )}
    </section>
  );
}
