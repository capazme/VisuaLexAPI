/**
 * «Scrivania»: the search page when no practice is open (spec 2026-10-18-redesign-inchiostro §5.3.2).
 * A greeting with the day, the ways to start (the field above, ⌘K, three examples), then «Riprendi»
 * — the dossiers touched last — and the frequent searches, as typographic lists, not cards.
 * `#tour-main-content` and `#tour-quick-norms` are the tours' targets (config/tourConfig.ts).
 */
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { ArrowUpRight, Plus } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { focusSearchFieldOrPalette } from '../../../utils/searchFieldControl';
import { dossierRecency } from '../dossier/dossierUtils';
import { kindLabel } from '../dossier/dossierKinds';
import { greeting } from './scrivaniaGreeting';
import { HIDDEN_SCROLLBAR, TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import { cn } from '../../../lib/utils';

const EXAMPLES = ['Art. 2043 c.c.', 'Art. 5 GDPR', 'Art. 1 Costituzione'];


// A 40 ms cascade, once per mount, never blocking input (spec §6.3.6).
const stagger = (i: number) => ({ animationDelay: `${i * 40}ms` });
const ENTER = 'animate-in fade-in slide-in-from-bottom-2 duration-200';

const ROW =
  'group flex w-full min-h-[44px] items-center gap-4 border-t border-slate-200 py-3.5 text-left transition-colors hover:bg-slate-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-800 dark:hover:bg-slate-900/60';

export function Scrivania() {
  const navigate = useNavigate();
  const { dossiers, quickNorms, selectQuickNorm, triggerSearch, openQuickNormsManager } = useAppStore(useShallow((s) => ({
    dossiers: s.dossiers,
    quickNorms: s.quickNorms,
    selectQuickNorm: s.selectQuickNorm,
    triggerSearch: s.triggerSearch,
    openQuickNormsManager: s.openQuickNormsManager,
  })));

  const now = new Date();
  const day = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome' }).format(now);
  const hour = Number(new Intl.DateTimeFormat('it-IT', { hour: 'numeric', hour12: false, timeZone: 'Europe/Rome' }).format(now));
  const recent = [...dossiers].sort((a, b) => dossierRecency(b) - dossierRecency(a)).slice(0, 4);

  return (
    <div
      id="tour-main-content"
      className={cn(
        'w-full min-h-full bg-slate-50 px-6 pb-24 pt-14 dark:bg-slate-950 md:pt-20',
        // On a phone (M1): the page's 16 px margin (the layout's; the reader's column's 16 taken back, and none of its own), and the
        // block centred in the window under the search bar when it is shorter than it.
        'max-md:-mx-4 max-md:w-auto max-md:flex max-md:min-h-[calc(100dvh-var(--search-bar-height,0px)-2rem)] max-md:flex-col max-md:justify-center max-md:px-0 max-md:py-8',
      )}
    >
      <div className="mx-auto w-full max-w-[760px]">
        <p className={`text-sm font-medium first-letter:uppercase text-slate-500 dark:text-slate-400 ${ENTER}`} style={stagger(0)}>{day}</p>
        <h1 className={`mt-2 font-serif text-5xl font-medium tracking-tight text-slate-900 dark:text-slate-50 md:text-6xl ${ENTER}`} style={stagger(1)}>
          {greeting(hour)}
        </h1>

        <div className={`mt-6 flex flex-wrap items-center gap-x-4 gap-y-3 ${ENTER}`} style={stagger(2)}>
          <button
            onClick={() => focusSearchFieldOrPalette()}
            className="inline-flex h-11 items-center gap-2 rounded-md bg-primary-600 px-4 text-sm font-semibold text-white transition-[background-color,transform] hover:bg-primary-700 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:bg-primary-400 dark:text-slate-950 dark:hover:bg-primary-300"
          >
            Inizia una ricerca
          </button>
          {/* A keyboard's shortcut: not on a touch screen. */}
          <span className="text-sm text-slate-500 [@media(pointer:coarse)]:hidden dark:text-slate-400">
            o premi <kbd className="rounded border border-slate-300 px-1.5 py-0.5 font-mono text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">⌘K</kbd> da qualsiasi pagina
          </span>
        </div>

        {/* On a phone three pills in a row that scrolls sideways, «Prova» first, never one left alone on a line (M1); from
            md the links in a line. */}
        <div
          className={cn(
            'mt-5 flex items-center gap-2 overflow-x-auto max-md:-mx-4 max-md:px-4 md:flex-wrap md:items-baseline md:gap-x-5 md:gap-y-2 md:overflow-visible',
            HIDDEN_SCROLLBAR,
            ENTER,
          )}
          style={stagger(3)}
          role="group"
          aria-label="Esempi di ricerca"
        >
          <span className="shrink-0 text-sm text-slate-500 dark:text-slate-400">Prova</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              // The example goes into the field, ready to search with Enter or to be changed.
              onClick={() => focusSearchFieldOrPalette(example)}
              className={cn(
                TOUCH_TARGET_RESPONSIVE,
                'shrink-0 whitespace-nowrap font-serif text-lg text-primary-700 underline decoration-primary-300 decoration-1 underline-offset-4 transition-colors hover:decoration-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-300 dark:decoration-primary-700',
                'max-md:rounded-full max-md:border max-md:border-slate-300 max-md:bg-white max-md:px-4 max-md:no-underline dark:max-md:border-slate-700 dark:max-md:bg-slate-900',
              )}
            >
              {example}
            </button>
          ))}
        </div>

        {recent.length > 0 && (
          <section className={`mt-16 ${ENTER}`} style={stagger(4)} aria-labelledby="scrivania-riprendi">
            <h2 id="scrivania-riprendi" className="mb-3 font-serif text-2xl font-medium text-slate-900 dark:text-slate-50">Riprendi</h2>
            <ul className="border-b border-slate-200 dark:border-slate-800">
              {recent.map((d) => (
                <li key={d.id}>
                  <button className={ROW} onClick={() => navigate(`/dossier?dossier=${d.id}`)}>
                    <span className="hidden w-36 shrink-0 text-sm text-slate-500 sm:block dark:text-slate-400">{kindLabel(d.kind)}</span>
                    <span className="min-w-0 flex-1">
                      <span title={d.title} className="block truncate font-serif text-[19px] text-slate-900 dark:text-slate-50">{d.title}</span>
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

        <section id="tour-quick-norms" className={`mt-14 ${ENTER}`} style={stagger(5)} aria-labelledby="scrivania-frequenti">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 id="scrivania-frequenti" className="font-serif text-2xl font-medium text-slate-900 dark:text-slate-50">Ricerche frequenti</h2>
            <button
              onClick={openQuickNormsManager}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-2 text-sm font-medium text-primary-700 transition-colors hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 md:py-1 dark:text-primary-300 dark:hover:bg-primary-950"
            >
              <Plus aria-hidden="true" size={14} /> Gestisci
            </button>
          </div>
          {quickNorms.length === 0 ? (
            <p className="border-t border-slate-200 pt-4 text-[15px] leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
              Le norme che consulti spesso, a un clic: aggiungile da «Gestisci».
            </p>
          ) : (
            <ul className="border-b border-slate-200 dark:border-slate-800">
              {quickNorms.slice(0, 6).map((qn) => (
                <li key={qn.id}>
                  <button
                    className={ROW}
                    onClick={() => {
                      selectQuickNorm(qn.id);
                      triggerSearch(qn.searchParams);
                    }}
                  >
                    <span title={qn.label} className="min-w-0 flex-1 truncate font-serif text-[19px] text-slate-900 dark:text-slate-50">{qn.label}</span>
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
