/**
 * «Scrivania»: the search page when no practice is open (spec 2026-10-18-redesign-inchiostro §5.3.2).
 * A greeting with the day, the ways to start (the field above, ⌘K, three examples, the two Corpus tools), then «Riprendi»
 * — the dossiers touched last — and the frequent searches, as typographic lists, not cards.
 * `#tour-main-content` and `#tour-quick-norms` are the tours' targets (config/tourConfig.ts).
 */
import { Link, useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { ArrowUpRight, Plus } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { focusSearchFieldOrPalette } from '../../../utils/searchFieldControl';
import { dossierRecency } from '../dossier/dossierUtils';
import { kindLabel } from '../dossier/dossierKinds';
import { greeting } from './scrivaniaGreeting';
import { HIDDEN_SCROLLBAR, TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import { cn } from '../../../lib/utils';
import { Button } from '../../ui/Button';
import { buttonClassName } from '../../ui/buttonStyles';
import { useOpenSettings } from '../settings/settingsRoute';

const EXAMPLES = ['Art. 2043 c.c.', 'Art. 5 GDPR', 'Art. 1 Costituzione'];


// LC21: no cascade (it was 40 ms a block): the desk is opened tens of times a day, its blocks are there at once.

/** The Corpus tools: `Button`'s link look, in the desk's serif from md (links, not pills, on a phone too). */
const CORPUS_LINK = cn(buttonClassName('link', 'lg'), 'whitespace-nowrap font-serif text-lg font-normal max-md:font-sans max-md:text-[15px] max-md:font-medium');

const ROW =
  'group flex w-full min-h-[44px] items-center gap-4 border-t border-slate-200 py-3.5 max-md:py-2.5 text-left transition-colors hover:bg-slate-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-800 dark:hover:bg-slate-900/60';

export function Scrivania() {
  const navigate = useNavigate();
  const { dossiers, quickNorms, selectQuickNorm, triggerSearch } = useAppStore(useShallow((s) => ({
    dossiers: s.dossiers,
    quickNorms: s.quickNorms,
    selectQuickNorm: s.selectQuickNorm,
    triggerSearch: s.triggerSearch,
  })));
  const openSettings = useOpenSettings();

  const now = new Date();
  const day = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome' }).format(now);
  const hour = Number(new Intl.DateTimeFormat('it-IT', { hour: 'numeric', hour12: false, timeZone: 'Europe/Rome' }).format(now));
  const recent = [...dossiers].sort((a, b) => dossierRecency(b) - dossierRecency(a)).slice(0, 4);

  return (
    <div
      id="tour-main-content"
      className={cn(
        'w-full min-h-full bg-slate-50 px-6 pb-24 pt-14 dark:bg-slate-950 md:pt-20',
        // On a phone (M1): the page's 16 px margin (the layout's: the reader's column has none of its own below md since R3b, and
        // the Scrivania none either), and the
        // block centred in the window under the search bar when it is shorter than it (the layout's padding taken off:
        // 1rem above and below; in full screen no search bar is drawn and `--search-bar-height` is unset).
        // LC38 (Luca, 16 Nov: «tutto sproporzionato»): on a phone the desk starts under the field, at a phone's scale.
        'max-md:w-auto max-md:px-0 max-md:pb-16 max-md:pt-6',
      )}
    >
      <div className="mx-auto w-full max-w-[760px]">
        <p className="text-sm font-medium first-letter:uppercase text-slate-500 dark:text-slate-400">{day}</p>
        <h1 data-page-title="" className="mt-1 font-serif text-[34px] font-medium leading-tight tracking-tight text-slate-900 dark:text-slate-50 md:mt-2 md:text-6xl">
          {greeting(hour)}
        </h1>

        {/* On a phone the field is right above: no second way to it. */}
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3 max-md:hidden">
          <Button type="button" size="lg" onClick={() => focusSearchFieldOrPalette()} className="text-sm font-semibold">
            Inizia una ricerca
          </Button>
          {/* A keyboard's shortcut: not on a touch screen. */}
          <span className="text-sm text-slate-500 [@media(pointer:coarse)]:hidden dark:text-slate-400">
            o premi <kbd className="rounded border border-slate-300 px-1.5 py-0.5 font-mono text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">⌘K</kbd> da qualsiasi pagina
          </span>
        </div>

        {/* On a phone three pills in a row that scrolls sideways, «Prova» first, never one left alone on a line (M1), with
            room above and below for their focus ring (the row clips); from md the links in a line. */}
        <div
          className={cn(
            'mt-5 flex items-center gap-2 overflow-x-auto max-md:mt-4 max-md:-mx-4 max-md:px-4 max-md:py-1 md:flex-wrap md:items-baseline md:gap-x-5 md:gap-y-2 md:overflow-visible',
            HIDDEN_SCROLLBAR,
          )}
          role="group"
          aria-label="Esempi di ricerca"
        >
          <span className="shrink-0 text-sm text-slate-500 dark:text-slate-400">Prova</span>
          {EXAMPLES.map((example) => (
            // bare-button: an example, a word in the interface's type from md and a stone chip on a phone (LC21, M1).
            <button
              key={example}
              // The example goes into the field, ready to search with Enter or to be changed.
              onClick={() => focusSearchFieldOrPalette(example)}
              className={cn(
                TOUCH_TARGET_RESPONSIVE,
                // The prototype's: a word in the interface's type, bold and quiet, with a tint under the pointer (LC21).
                'shrink-0 whitespace-nowrap rounded-md px-2 text-[15px] font-semibold text-slate-700 transition-colors hover:bg-slate-200/70 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-50',
                // On a phone a quiet stone chip, the interface's size: no frame, no white.
                'max-md:rounded-full max-md:bg-ink-200/70 max-md:px-3.5 max-md:text-sm max-md:font-medium dark:max-md:bg-ink-800',
              )}
            >
              {example}
            </button>
          ))}
        </div>

        {/* The Corpus tools beside the search (LC8: Work's bar no longer lists them). */}
        <nav aria-label="Altri strumenti della Ricerca" className="mt-3 flex flex-wrap gap-x-5 gap-y-2 max-md:mt-2 max-md:gap-x-4">
          {[['/documents', 'Analizza un documento'], ['/rassegne', 'Rassegne']].map(([to, label]) => (
            <Link key={to} to={to} className={CORPUS_LINK}>{label}</Link>
          ))}
        </nav>

        {recent.length > 0 && (
          <section className="mt-16 max-md:mt-10" aria-labelledby="scrivania-riprendi">
            <h2 id="scrivania-riprendi" className="mb-3 font-serif text-2xl font-medium text-slate-900 max-md:mb-2 max-md:text-xl dark:text-slate-50">Riprendi</h2>
            <ul className="border-b border-slate-200 dark:border-slate-800">
              {recent.map((d) => (
                <li key={d.id}>
                  {/* bare-button: a row of the list that is a whole option, the dossier's name and its count. */}
                  <button className={ROW} onClick={() => navigate(`/pratiche?dossier=${d.id}`)}>
                    <span className="hidden w-36 shrink-0 text-sm text-slate-500 sm:block dark:text-slate-400">{kindLabel(d.kind)}</span>
                    <span className="min-w-0 flex-1">
                      <span title={d.title} className="block truncate font-serif text-[19px] text-slate-900 max-md:text-[17px] dark:text-slate-50">{d.title}</span>
                      <span className="block text-sm text-slate-500 dark:text-slate-400">
                        {d.items.length === 1 ? '1 voce' : `${d.items.length} voci`}
                      </span>
                    </span>
                    <ArrowUpRight aria-hidden="true" size={16} className="shrink-0 text-slate-400 transition-colors group-hover:text-primary-600" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section id="tour-quick-norms" className="mt-14 max-md:mt-10" aria-labelledby="scrivania-frequenti">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 id="scrivania-frequenti" className="font-serif text-2xl font-medium text-slate-900 max-md:text-xl dark:text-slate-50">Ricerche frequenti</h2>
            <Button type="button" variant="quiet" size="sm" onClick={() => openSettings('norme-rapide')} icon={<Plus aria-hidden="true" size={14} />} className="gap-1.5 px-2 text-sm">
              Gestisci
            </Button>
          </div>
          {quickNorms.length === 0 ? (
            <p className="border-t border-slate-200 pt-4 text-[15px] leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
              Le norme che consulti spesso, a un clic: aggiungile da «Gestisci».
            </p>
          ) : (
            <ul className="border-b border-slate-200 dark:border-slate-800">
              {quickNorms.slice(0, 6).map((qn) => (
                <li key={qn.id}>
                  {/* bare-button: a row of the list that is a whole option, the norm's name and its act. */}
                  <button
                    className={ROW}
                    onClick={() => {
                      selectQuickNorm(qn.id);
                      triggerSearch(qn.searchParams);
                    }}
                  >
                    <span title={qn.label} className="min-w-0 flex-1 truncate font-serif text-[19px] text-slate-900 max-md:text-[17px] dark:text-slate-50">{qn.label}</span>
                    <span className="hidden shrink-0 text-sm text-slate-500 sm:block dark:text-slate-400">{qn.searchParams.act_type}</span>
                    <ArrowUpRight aria-hidden="true" size={16} className="shrink-0 text-slate-400 transition-colors group-hover:text-primary-600" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
