import { cn } from '../../../lib/utils';
import type { AncoraScheda, SchedaDiRipasso } from '../../../types/studia';
import { anchorCitation, anchorLabel } from './studiaLabels';

export interface ReviewCardProps {
  card: SchedaDiRipasso;
  revealed: boolean;
  /** Opens the anchor's article beside the card (or over it on a phone). */
  onOpenAnchor: (anchor: AncoraScheda) => void;
}

const MEASURE = 'max-w-[60ch]';
const TEXT = 'whitespace-pre-line break-words text-left font-serif leading-[1.7]';

/**
 * A card in review, set like the law it rests on: the article as a small source line in the
 * interface's sans, the question in the reader's serif one step above the answer, no shadow or
 * gradient. Showing the answer is the one motion: a hairline draws across, then the answer
 * unfolds beneath it (`motion-safe:` only, so none with reduced motion). Question, answer and
 * explanation are plain text, left to React as text nodes.
 */
export function ReviewCard({ card, revealed, onOpenAnchor }: ReviewCardProps) {
  const citation = anchorCitation(card);
  // The primary anchor first; one whose address names no article cannot be opened.
  const anchors = [...card.ancore].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).filter((a) => anchorLabel(a));

  return (
    <article aria-label="Scheda in ripasso">
      {citation && <p className="mb-2 text-sm text-slate-500 dark:text-slate-400">{citation}</p>}
      <h2 className={cn(MEASURE, TEXT, 'text-xl text-slate-900 md:text-2xl dark:text-slate-50')}>{card.domanda}</h2>
      {revealed && (
        <>
          <hr className={cn(MEASURE, 'my-4 origin-left border-slate-200 motion-safe:animate-vlx-rule dark:border-slate-700')} />
          <div className="motion-safe:animate-vlx-unfold">
            <p className={cn(MEASURE, TEXT, 'text-lg text-slate-800 md:text-xl dark:text-slate-200')}>{card.risposta}</p>
            {card.spiegazione && (
              <section className="mt-5">
                <h3 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">Spiegazione</h3>
                <p className={cn(MEASURE, TEXT, 'text-base text-slate-600 dark:text-slate-400')}>{card.spiegazione}</p>
              </section>
            )}
            {anchors.length > 0 && (
              <section className="mt-5" aria-label="Articoli">
                <ul>
                  {anchors.map((anchor) => (
                    <li key={`${anchor.normaKey}|${anchor.articleId}`}>
                      <button
                        type="button"
                        onClick={() => onOpenAnchor(anchor)}
                        title="Apri l’articolo"
                        className="min-h-[44px] rounded text-left text-sm text-slate-600 hover:text-primary-700 hover:underline md:min-h-0 md:py-1 dark:text-slate-300 dark:hover:text-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      >
                        {anchorLabel(anchor)}
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
