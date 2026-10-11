import { X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import { DecisionSearchTabView } from '../decisions/DecisionSearchTabView';
import type { BesideRef } from '../../../utils/practice';

type TopicRef = Extract<BesideRef, { kind: 'decision-search' }>;

/**
 * The practice's topic searches as a band at the top of its column (spec T8, P3): a topic search is
 * a question, not a source, so it never enters «Giurisprudenza»; a decision opened from its list does
 * (its links name the window's id, which the store reads as this practice). Drawn by the desktop
 * table until P4 makes it a window, and by the phone's table until P5 opens it full screen.
 */
export function PracticeTopicSearches({ practiceId }: { practiceId: string }) {
  const searches = useAppStore(useShallow((s) =>
    (s.practices.find((p) => p.id === practiceId)?.beside ?? []).filter((b): b is TopicRef => b.kind === 'decision-search')));
  const closeBeside = useAppStore((s) => s.closeBeside);

  if (searches.length === 0) return null;

  return (
    <div data-testid="practice-topic-searches" className="space-y-3">
      {searches.map((ref) => {
        const topic = ref.query.tema ?? ref.label;
        return (
          <section
            key={ref.id}
            aria-label={`Ricerca per tema: ${topic}`}
            className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
          >
            <header className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5 dark:border-slate-800">
              <p className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Ricerca per tema: <span className="normal-case">{topic}</span>
              </p>
              <button
                type="button"
                onClick={() => closeBeside(practiceId, ref.id)}
                aria-label={`Chiudi la ricerca per tema «${topic}»`}
                title="Chiudi la ricerca"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 md:min-h-0 md:min-w-0 md:p-1 dark:hover:bg-slate-800 dark:hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <X size={16} aria-hidden />
              </button>
            </header>
            <div className="p-3">
              <DecisionSearchTabView tabId={ref.id} query={ref.query} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
