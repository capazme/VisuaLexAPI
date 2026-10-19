import { useEffect, useRef } from 'react';
import { BookOpen } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { AncoraScheda, SchedaDiRipasso } from '../../../types/studia';
import { FOCUS_RING, TILE } from './progress/tokens';
import { anchorCitation, anchorLabel } from './studiaLabels';

export interface ReviewCardProps {
  card: SchedaDiRipasso;
  revealed: boolean;
  /** Changes whenever the screen moves on to a card (or back to the same one): focus goes to the question. */
  focusKey: number;
  /** Opens the anchor's article beside the card (or over it on a phone). */
  onOpenAnchor: (anchor: AncoraScheda) => void;
}

const MEASURE = 'max-w-[60ch]';
const TEXT = 'whitespace-pre-line break-words text-left font-serif leading-[1.7]';

/**
 * A card in the lesson (Gymnasium spec §5.4, over the Studia screens spec §6 as rewritten for G2): a sheet of
 * paper on the page — the area's tile, no shadow or gradient — that comes in with each card (opacity and a few
 * pixels, 180 ms, `motion-safe:` only; the session keys it by step). The article as a small source line in the
 * interface's sans above, the question in the reader's serif one step above the answer, at a 60ch measure.
 * Showing the answer is the card's own motion: a hairline draws across, then the answer unfolds beneath it
 * (`motion-safe:` only). Under it the explanation and the articles, each a 44 px button that opens the article
 * beside the card (in a sheet on a phone). Question, answer and explanation are plain text, left to React as
 * text nodes.
 *
 * Focus follows the screen: to the question when a card is shown, to the answer when it is revealed, which is
 * how a screen reader hears it.
 */
export function ReviewCard({ card, revealed, focusKey, onOpenAnchor }: ReviewCardProps) {
  const question = useRef<HTMLHeadingElement>(null);
  const answer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    question.current?.focus({ preventScroll: true });
  }, [focusKey]);
  useEffect(() => {
    if (revealed) answer.current?.focus({ preventScroll: true });
  }, [revealed]);
  const citation = anchorCitation(card);
  // The primary anchor first; one whose address names no article cannot be opened.
  const anchors = [...card.ancore].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).filter((a) => anchorLabel(a));

  return (
    <article
      aria-label="Scheda in ripasso"
      className={cn(TILE, 'p-5 md:px-10 md:py-9', 'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2')}
    >
      {citation && <p className="mb-3 break-words text-sm font-medium text-slate-500 dark:text-slate-400">{citation}</p>}
      <h2 ref={question} tabIndex={-1} className={cn(MEASURE, TEXT, 'text-xl text-slate-900 focus:outline-none md:text-2xl dark:text-slate-50')}>{card.domanda}</h2>
      {revealed && (
        <>
          <hr className={cn(MEASURE, 'my-5 origin-left border-slate-200 motion-safe:animate-vlx-rule dark:border-slate-700')} />
          <div ref={answer} tabIndex={-1} aria-label="Risposta" role="group" className="focus:outline-none motion-safe:animate-vlx-unfold">
            <p className={cn(MEASURE, TEXT, 'text-lg text-slate-800 md:text-xl dark:text-slate-200')}>{card.risposta}</p>
            {card.spiegazione && (
              <section className="mt-6">
                <h3 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">Spiegazione</h3>
                <p className={cn(MEASURE, TEXT, 'text-base text-slate-600 dark:text-slate-400')}>{card.spiegazione}</p>
              </section>
            )}
            {anchors.length > 0 && (
              <section className="mt-6" aria-label="Articoli">
                <ul className="flex flex-wrap gap-2">
                  {anchors.map((anchor) => (
                    <li key={`${anchor.normaKey}|${anchor.articleId}`} className="min-w-0 max-w-full">
                      <button
                        type="button"
                        onClick={() => onOpenAnchor(anchor)}
                        title="Apri l’articolo"
                        className={cn(
                          'inline-flex min-h-[44px] max-w-full items-center gap-2 rounded-lg border border-slate-200 px-3 text-left text-sm font-medium text-slate-700 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-900',
                          'dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-700 dark:hover:bg-primary-900/30 dark:hover:text-primary-200',
                          FOCUS_RING,
                        )}
                      >
                        <BookOpen size={16} aria-hidden className="shrink-0" />
                        <span className="min-w-0 break-words">{anchorLabel(anchor)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </>
      )}
    </article>
  );
}
