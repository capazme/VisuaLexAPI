import { useCallback, useId, useMemo, useState } from 'react';
import { ChevronDown, Search, SlidersHorizontal } from 'lucide-react';
import type { NormaVisitata } from '../../../types';
import { cn } from '../../../lib/utils';
import { TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import { citeNorm } from '../../../utils/sources';
import { isEuropeanAct } from '../../../utils/versionDisplay';
import { searchNorma } from '../../../utils/decisionSearchNorma';
import type { ReadingBackEntry } from '../../../utils/readingBackStack';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { useAppStore } from '../../../store/useAppStore';
import { PluginSlot } from '../../../plugins/PluginSlot';
import { getSlotComponents } from '../../../plugins/registry';
import { DecisionResultList } from '../decisions/DecisionResultList';
import { EuCaseLawBlock } from '../decisions/EuCaseLawBlock';
import { CaseLawControls } from './caseLaw/CaseLawControls';
import { CaseLawFiltersContext } from './caseLaw/caseLawFiltersContext';
import { narrowingCount, NO_FILTERS, type CaseLawFilters } from './caseLaw/caseLawFilter';
import { mergeYearCounts, type YearCount } from './caseLaw/caseLawYears';
import { isGenericRubric } from './caseLaw/genericRubrics';

interface CaseLawSectionProps {
  norma: NormaVisitata;
  /**
   * The article's subject, its rubric: «Cerca sentenze sul tema dell'articolo» opens a topic search of
   * the Cassazione with it. No rubric, or a generic one (`GENERIC_RUBRICS`), no link.
   */
  topic?: string | null;
  articleUrn?: string;
  /** The place the article is read in (a practice or one of its windows): a decision opens beside it. */
  tabId?: string;
  /** The way back to the article, recorded when a decision is opened from here. */
  backEntry?: ReadingBackEntry;
  /** A past text: the section stays, and so do the Massimario and the Cassazione's search. */
  isHistorical?: boolean;
}

const storageKey = (tabId: string) => `visualex:case-law-open:${tabId}`;

function readOpen(tabId: string | undefined): boolean {
  if (!tabId) return false;
  try {
    return window.sessionStorage.getItem(storageKey(tabId)) === '1';
  } catch {
    return false;
  }
}

function writeOpen(tabId: string | undefined, open: boolean): void {
  if (!tabId) return;
  try {
    window.sessionStorage.setItem(storageKey(tabId), open ? '1' : '0');
  } catch {
    // storage may be unavailable: the section just does not remember
  }
}

/**
 * «Giurisprudenza» under the article text: the Massimario's reviews (a plugin panel in the
 * `article_case_law` slot), on request the decisions of the Cassazione that mention the article, and
 * a topic search of the Cassazione by the article's rubric (it took the place of the Brocardi
 * glossary's «Sentenze su questo tema», D-078). Closed by default; its state is kept
 * per host for the session. An act of the Union gets the Court of Justice's block (`EuCaseLawBlock`, loaded
 * when the section opens) in place of the Cassazione's. One set of controls at its head (the years, the text) narrows every block. Nothing is asked of the Cassazione's archive until the button is pressed,
 * and an act of the Union is not offered the archive at all (its search cannot read an EU act;
 * case-law section spec, D2).
 *
 * The archive the reader picks in the list is not remembered: the list learns whether the route
 * can search both archives only from a request sent without one (Task 15), so each opening of
 * the section starts from the route's own choice.
 */
export function CaseLawSection({ norma, topic, articleUrn, tabId, backEntry, isHistorical = false }: CaseLawSectionProps) {
  const panelId = useId();
  const [open, setOpen] = useState(() => readOpen(tabId));
  const [searched, setSearched] = useState(false);
  const desktop = useIsDesktop();
  const openTopicSearch = useAppStore((s) => s.openTopicSearch);
  const pushReadingBack = useAppStore((s) => s.pushReadingBack);
  const [filters, setFilters] = useState<CaseLawFilters>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // the years of the rows each block has loaded, for the chips
  const [reported, setReported] = useState<Record<string, YearCount[]>>({});
  // Another article in the same host: the search starts again from the button
  const [shownKey, setShownKey] = useState(articleUrn);
  if (shownKey !== articleUrn) {
    setShownKey(articleUrn);
    setSearched(false);
    setFilters(NO_FILTERS);
  }

  const reportYears = useCallback((source: string, years: YearCount[] | null) => {
    setReported((previous) => {
      if (years === null) {
        if (!(source in previous)) return previous;
        const rest = { ...previous };
        delete rest[source];
        return rest;
      }
      return previous[source] === years ? previous : { ...previous, [source]: years };
    });
  }, []);
  const provided = useMemo(() => ({ filters, reportYears }), [filters, reportYears]);
  const counts = useMemo(() => mergeYearCounts(Object.values(reported), filters.order), [reported, filters.order]);
  const active = narrowingCount(filters);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    writeOpen(tabId, next);
  };

  // A generic rubric («Definizioni», «Oggetto»…) alone would find every act's decisions: no link for it.
  const tema = topic?.trim() && !isGenericRubric(topic) ? topic.trim() : undefined;
  const hasMassimario = getSlotComponents('article_case_law').length > 0;
  const offersCassazione = !isEuropeanAct(norma.tipo_atto);

  return (
    <div className="mt-8 border-t border-slate-200 pt-4 dark:border-slate-800">
      {/* A section's label, as the rest of the app writes it (R3): plain, `text-sm font-semibold`. */}
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          className={cn(
            'flex w-full items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
            TOUCH_TARGET_RESPONSIVE,
          )}
        >
          <span>Giurisprudenza</span>
          <ChevronDown size={16} className={cn('transition-transform duration-200', open && 'rotate-180')} />
        </button>
      </h3>

      <div id={panelId} hidden={!open} className="mt-3 space-y-6">
        {open && (
          <CaseLawFiltersContext.Provider value={provided}>
            {/* One set of controls for every block; on a phone they sit behind «Filtri» */}
            <div>
              {!desktop && (
                <button
                  type="button"
                  aria-expanded={filtersOpen}
                  aria-controls={`${panelId}-filters`}
                  onClick={() => setFiltersOpen((v) => !v)}
                  className={cn(
                    'mb-2 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-600 dark:text-slate-200',
                    TOUCH_TARGET_RESPONSIVE,
                  )}
                >
                  <SlidersHorizontal size={14} aria-hidden="true" />
                  Filtri
                  {active > 0 && <span aria-hidden="true" className="rounded-full bg-primary-600 px-1.5 text-xs text-white">{active}</span>}
                </button>
              )}
              {/* always there, so «Filtri» controls an element; hidden on a phone until it is opened */}
              <div id={`${panelId}-filters`} hidden={!desktop && !filtersOpen}>
                <CaseLawControls filters={filters} onChange={setFilters} counts={counts} />
              </div>
            </div>

            {/* The Massimario's panel is its own heading ("Nelle rassegne della Cassazione", with the
                count) and renders nothing when there are no reviews, so no wrapper of ours names it. */}
            {hasMassimario && (
              <div>
                <PluginSlot
                  slot="article_case_law"
                  props={{ articleUrn, isHistorical, besideId: tabId, backEntry }}
                />
              </div>
            )}

            {offersCassazione && <section aria-labelledby={`${panelId}-cassazione`} className="space-y-3">
              <h4 id={`${panelId}-cassazione`} className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Cassazione — menzionano l’articolo
              </h4>
              {searched ? (
                <DecisionResultList
                  query={{ norma: searchNorma(norma), normaLabel: citeNorm(norma) }}
                  besideId={tabId}
                  backEntry={backEntry}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setSearched(true)}
                  className={cn(
                    'rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800',
                    TOUCH_TARGET_RESPONSIVE,
                  )}
                >
                  Cerca nell’archivio della Cassazione
                </button>
              )}
            </section>}

            {/* The decisions on the article's subject, whether or not they cite it: a topic window beside.
                The Cassazione's archive only, so not for an act of the Union. */}
            {offersCassazione && tema && (
              <button
                type="button"
                onClick={() => {
                  // the way back to the article first, as a decision's link records it (on a phone the
                  // topic search takes the full-screen reader's place)
                  if (backEntry) pushReadingBack(backEntry);
                  openTopicSearch({ tema }, `Tema: ${tema}`, tabId ? { besideId: tabId } : undefined);
                }}
                className="group -mx-1 flex min-h-[44px] items-start gap-2 rounded-lg px-1 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <Search size={14} aria-hidden="true" className="mt-1 shrink-0 text-primary-700 dark:text-primary-300" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-primary-700 underline-offset-4 group-hover:underline dark:text-primary-300">
                    Cerca sentenze sul tema dell’articolo
                  </span>
                  <span className="block break-words text-xs text-slate-600 dark:text-slate-400">«{tema}»</span>
                </span>
              </button>
            )}

            {/* An act of the Union has no Cassazione block; its case law is the Union's courts' */}
            {!offersCassazione && (
              <section aria-labelledby={`${panelId}-eu`} className="space-y-3">
                <h4 id={`${panelId}-eu`} className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Corte di giustizia UE — citano l’articolo
                </h4>
                <EuCaseLawBlock norma={norma} besideId={tabId} backEntry={backEntry} />
              </section>
            )}
          </CaseLawFiltersContext.Provider>
        )}
      </div>
    </div>
  );
}
