import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import type { ArticleData } from '../../../types';
import { cn } from '../../../lib/utils';
import { PracticeColumn } from './PracticeColumn';
import { PracticeTopicSearches } from './PracticeTopicSearches';
import { PracticeEmpty, PracticeStreamingBar, type PracticeStreaming } from './PracticeParts';
import { fromPracticePair, isEmptyPractice, practicePair } from './practiceView';

export interface PracticePhoneViewProps {
  onViewPdf: (urn: string) => void;
  onCrossReference: (articleNumber: string, normaData: ArticleData['norma_data']) => void;
  streaming: PracticeStreaming | null;
}

// 44 px touch targets (apps/web/CLAUDE.md, «Mobile-first»).
const CHEVRON =
  'flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl shadow-sm transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
const CHEVRON_ON =
  'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700';
const CHEVRON_OFF = 'bg-slate-50 text-slate-300 dark:bg-slate-900 dark:text-slate-700';

/**
 * The phone's table (spec §8, P3's part, T18): a header that switches practices — the chevrons, the
 * name, one dot per practice — over the active practice's topic searches (the band, until P5) and
 * its column, rows opening in place. The practice on screen is the active one, so the store's
 * routing, the way back and the find window all name the same practice on both breakpoints. The
 * migration's notice is `SearchPanel`'s, over both layouts.
 */
export function PracticePhoneView({ onViewPdf, onCrossReference, streaming }: PracticePhoneViewProps) {
  const practices = useAppStore(useShallow((s) => s.practices.map(practicePair)));
  const activePracticeId = useAppStore((s) => s.activePracticeId);
  const practice = useAppStore((s) => s.practices.find((p) => p.id === s.activePracticeId));
  const setActivePractice = useAppStore((s) => s.setActivePractice);

  const list = practices.map(fromPracticePair);
  const index = list.findIndex((p) => p.id === activePracticeId);
  const go = (to: number) => {
    const target = list[to];
    if (target) setActivePractice(target.id);
  };

  return (
    <>
      {list.length > 0 && (
        <div data-testid="practice-phone-view" className="flex w-full flex-col bg-slate-50 dark:bg-slate-950">
          {/* The layout's fixed menu button (top-left, 16px in, 56px wide) sits over the header's left
              edge: the inset keeps the previous chevron clear of it. */}
          <div className="flex-shrink-0 border-b border-slate-200 bg-white/80 py-2 pl-[4.5rem] pr-4 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/80">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => go(index - 1)}
                disabled={index <= 0}
                aria-label="Pratica precedente"
                className={cn(CHEVRON, index <= 0 ? CHEVRON_OFF : CHEVRON_ON)}
              >
                <ChevronLeft size={20} aria-hidden />
              </button>
              <div className="min-w-0 flex-1 px-4 text-center">
                <h2 className="truncate text-base font-bold text-slate-900 dark:text-white">{practice?.label ?? ''}</h2>
                {/* Each dot is a 44 px button around a small visual dot; many practices wrap. */}
                <div className="flex flex-wrap justify-center">
                  {list.map((p, i) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => go(i)}
                      aria-label={`Pratica ${i + 1}: ${p.label}`}
                      aria-current={i === index ? 'true' : undefined}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'block h-1.5 rounded-full transition-all duration-300',
                          i === index ? 'w-6 bg-primary-500' : 'w-1.5 bg-slate-300 dark:bg-slate-700',
                        )}
                      />
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => go(index + 1)}
                disabled={index < 0 || index >= list.length - 1}
                aria-label="Pratica successiva"
                className={cn(CHEVRON, index < 0 || index >= list.length - 1 ? CHEVRON_OFF : CHEVRON_ON)}
              >
                <ChevronRight size={20} aria-hidden />
              </button>
            </div>
          </div>
          {practice && (
            <div className="space-y-4 p-4">
              <PracticeStreamingBar streaming={streaming} practiceId={practice.id} />
              {isEmptyPractice(practice) ? (
                <PracticeEmpty />
              ) : (
                <>
                  <PracticeTopicSearches practiceId={practice.id} />
                  <PracticeColumn practiceId={practice.id} onViewPdf={onViewPdf} onCrossReference={onCrossReference} />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
