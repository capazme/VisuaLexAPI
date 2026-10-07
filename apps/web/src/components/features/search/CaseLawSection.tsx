import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { MassimaStructured, NormaVisitata } from '../../../types';
import type { DecisionSearchNorma } from '../../../types/decisions';
import { cn } from '../../../lib/utils';
import { TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import { DOCTRINE_ATTRIBUTION, DOCTRINE_SOURCE_NAME } from '../../../utils/doctrineLabel';
import { httpsUrl } from '../../../utils/decisionLinks';
import { citeNorm } from '../../../utils/sources';
import type { ReadingBackEntry } from '../../../utils/readingBackStack';
import { PluginSlot } from '../../../plugins/PluginSlot';
import { getSlotComponents } from '../../../plugins/registry';
import { DecisionResultList } from '../decisions/DecisionResultList';
import { MassimeSection } from './MassimeSection';
import type { MassimeState } from './massimeState';

interface CaseLawSectionProps {
  norma: NormaVisitata;
  /** Brocardi's massime; `null` when the source gave none. */
  massime: (string | MassimaStructured)[] | null;
  /**
   * What Brocardi did: `answered` (its massime, or a line saying it has none), `failed` (a line
   * saying it did not answer: a failure is never shown as an absence), `hidden` (a past text, gotcha 32,
   * or Brocardi was not asked): no subsection.
   */
  massimeState?: MassimeState;
  /** The article's page on Brocardi, credited beside the massime. */
  brocardiLink?: string | null;
  articleUrn?: string;
  /** The workspace tab the article is in: a decision opens beside it. */
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

/** The four fields `/search_decisions` reads; the others of an article are ignored there. */
function searchNorma(norma: NormaVisitata): DecisionSearchNorma {
  return {
    tipo_atto: norma.tipo_atto,
    numero_articolo: norma.numero_articolo,
    ...(norma.numero_atto ? { numero_atto: norma.numero_atto } : {}),
    ...(norma.data ? { data: norma.data } : {}),
  };
}

/**
 * «Giurisprudenza» under the article text: Brocardi's massime (their decisions as links), the
 * Massimario's reviews (a plugin panel in the `article_case_law` slot) and, on request, the
 * decisions of the Cassazione that mention the article. Closed by default; its state is kept
 * per tab for the session. Nothing is asked of the Cassazione's archive until the button is pressed.
 *
 * The archive the reader picks in the list is not remembered: the list learns whether the route
 * can search both archives only from a request sent without one (Task 15), so each opening of
 * the section starts from the route's own choice.
 */
export function CaseLawSection({ norma, massime, massimeState = 'answered', brocardiLink, articleUrn, tabId, backEntry, isHistorical = false }: CaseLawSectionProps) {
  const panelId = useId();
  const [open, setOpen] = useState(() => readOpen(tabId));
  const [searched, setSearched] = useState(false);
  // Another article in the same tab: the search starts again from the button
  const [shownKey, setShownKey] = useState(articleUrn);
  if (shownKey !== articleUrn) {
    setShownKey(articleUrn);
    setSearched(false);
  }

  const toggle = () => {
    const next = !open;
    setOpen(next);
    writeOpen(tabId, next);
  };

  const hasMassime = Boolean(massime && massime.length > 0);
  const sourceLink = httpsUrl(brocardiLink);
  const hasMassimario = getSlotComponents('article_case_law').length > 0;

  return (
    <div className="mt-8 border-t border-slate-200 pt-4 dark:border-slate-800">
      <h3 className="text-xs font-bold uppercase text-slate-600 dark:text-slate-300">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          className={cn(
            'flex w-full items-center justify-between gap-3 text-left uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
            TOUCH_TARGET_RESPONSIVE,
          )}
        >
          <span>Giurisprudenza</span>
          <ChevronDown size={16} className={cn('transition-transform duration-200', open && 'rotate-180')} />
        </button>
      </h3>

      <div id={panelId} hidden={!open} className="mt-3 space-y-6">
        {open && (
          <>
            {massimeState !== 'hidden' && (
              <section aria-labelledby={`${panelId}-massime`} className="space-y-2">
                <h4 id={`${panelId}-massime`} className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Massime (Brocardi)
                </h4>
                {massimeState === 'answered' && <p className="text-[11px] text-slate-400">
                  {sourceLink ? (
                    <a href={sourceLink} target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-600 dark:hover:text-slate-200">
                      {DOCTRINE_ATTRIBUTION}
                    </a>
                  ) : DOCTRINE_ATTRIBUTION}
                </p>}
                {massimeState === 'failed' ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">{`${DOCTRINE_SOURCE_NAME} non ha risposto: le massime non sono disponibili ora.`}</p>
                ) : hasMassime ? (
                  <MassimeSection massime={massime} besideTabId={tabId} backEntry={backEntry} />
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400">{`${DOCTRINE_SOURCE_NAME} non riporta massime per questo articolo.`}</p>
                )}
              </section>
            )}

            {/* The Massimario's panel is its own heading ("Nelle rassegne della Cassazione", with the
                count) and renders nothing when there are no reviews, so no wrapper of ours names it. */}
            {hasMassimario && (
              <div>
                <PluginSlot
                  slot="article_case_law"
                  props={{ articleUrn, isHistorical, besideTabId: tabId, backEntry }}
                />
              </div>
            )}

            <section aria-labelledby={`${panelId}-cassazione`} className="space-y-3">
              <h4 id={`${panelId}-cassazione`} className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Cassazione — menzionano l’articolo
              </h4>
              {searched ? (
                <DecisionResultList
                  query={{ norma: searchNorma(norma), normaLabel: citeNorm(norma) }}
                  besideTabId={tabId}
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
            </section>
          </>
        )}
      </div>
    </div>
  );
}
