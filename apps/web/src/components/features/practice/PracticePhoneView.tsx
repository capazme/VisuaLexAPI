import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import type { ArticleData } from '../../../types';
import { cn } from '../../../lib/utils';
import { PracticeColumn } from './PracticeColumn';
import { PracticeTopicSearches } from './PracticeTopicSearches';
import { PracticeEmpty, PracticeNotice, PracticeStreamingBar, type PracticeStreaming } from './PracticeParts';
import { isEmptyPractice } from './practiceView';

export interface PracticePhoneViewProps {
  onViewPdf: (urn: string) => void;
  onCrossReference: (articleNumber: string, normaData: ArticleData['norma_data']) => void;
  streaming: PracticeStreaming | null;
}

const CHEVRON =
  'rounded-xl p-2.5 shadow-sm transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
const CHEVRON_ON =
  'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700';
const CHEVRON_OFF = 'bg-slate-50 text-slate-300 dark:bg-slate-900 dark:text-slate-700';

/**
 * The phone's table (spec §8, P3's part, T18): a header that switches practices — the chevrons, the
 * name, one dot per practice — over the active practice's topic searches (the band, until P5) and
 * its column, rows opening in place. The practice on screen is the active one, so the store's
 * routing, the way back and the find window all name the same practice on both breakpoints.
 */
export function PracticePhoneView({ onViewPdf, onCrossReference, streaming }: PracticePhoneViewProps) {
  const practices = useAppStore(useShallow((s) => s.practices.map((p) => `${p.id}\u0000${p.label}`)));
  const activePracticeId = useAppStore((s) => s.activePracticeId);
  const practice = useAppStore((s) => s.practices.find((p) => p.id === s.activePracticeId));
  const setActivePractice = useAppStore((s) => s.setActivePractice);

  const list = practices.map((pair) => {
    const [id, label] = pair.split('\u0000');
    return { id, label };
  });
  const index = list.findIndex((p) => p.id === activePracticeId);
  const go = (to: number) => {
    const target = list[to];
    if (target) setActivePractice(target.id);
  };

  return (
    <>
      <PracticeNotice />
      {list.length > 0 && (
        <div data-testid="practice-phone-view" className="flex w-full flex-col bg-slate-50 dark:bg-slate-950">
          {/* The layout's fixed menu button (top-left, 16px in, 56px wide) sits over the header's left
              edge: the inset keeps the previous chevron clear of it. */}
          <div className="flex-shrink-0 border-b border-slate-200 bg-white/80 py-4 pl-[4.5rem] pr-4 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/80">
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
                <div className="mt-2.5 flex justify-center gap-1.5">
                  {list.map((p, i) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => go(i)}
                      aria-label={`Pratica ${i + 1}: ${p.label}`}
                      aria-current={i === index ? 'true' : undefined}
                      className={cn(
                        'h-1.5 rounded-full transition-all duration-300',
                        i === index ? 'w-6 bg-primary-500' : 'w-1.5 bg-slate-300 dark:bg-slate-700',
                      )}
                    />
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
