import { useId, useImperativeHandle, useMemo, useState, type Ref } from 'react';
import { cn } from '../../../lib/utils';
import { Tooltip } from '../../ui/Tooltip';
import type { NormaVisitata } from '../../../types';
import { getRubricText, type ArticleStructure } from '../../../utils/articleStructure';
import { citeNorm } from '../../../utils/sources';
import { ArticleCardsPeek } from './ArticleCardsPeek';
import { CardFormDialog } from './CardFormDialog';
import { cardsUrnOf, offersNewCard } from './articleCardsOffer';
import { useArticleCards } from './useArticleCards';

/** What the reader's selection popup reaches the row's form through. */
export interface ArticleCardsHandle {
  /** Opens the form with the selected words as the answer. */
  createFromPassage: (text: string) => void;
}

export interface ArticleCardsRowProps {
  norma: NormaVisitata;
  articleText: string;
  structure: ArticleStructure;
  /** A past text (asked for by date, or a reading): the cards anchor to the text in force. */
  historical: boolean;
  ref?: Ref<ArticleCardsHandle>;
}

const PAST_REASON = 'Le schede si ancorano al testo vigente';
const ACTION =
  'inline-flex min-h-[44px] items-center rounded px-1 transition-colors md:min-h-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

/**
 * Under the article, outside its text: «Schede su questo articolo (3) · + Nuova scheda». The count
 * opens the Peek with the cards; «+ Nuova scheda» opens the form, which stays mounted here so the
 * selection popup can open it too (`ref`). Absent for an act with no Normattiva address and with
 * the feature off.
 */
export function ArticleCardsRow({ norma, articleText, structure, historical, ref }: ArticleCardsRowProps) {
  const urn = cardsUrnOf(norma);
  const { cards, count, status, refresh } = useArticleCards(urn);
  const canCreate = offersNewCard(norma, historical);
  const reasonId = useId();
  const suggestedIstituto = useMemo(() => getRubricText(articleText, structure) ?? undefined, [articleText, structure]);

  const [peekOpen, setPeekOpen] = useState(false);
  // State, not a ref, so the Peek reads the button once it is mounted (gotcha 13).
  const [countButton, setCountButton] = useState<HTMLButtonElement | null>(null);
  const [form, setForm] = useState<{ open: boolean; passage?: string }>({ open: false });

  useImperativeHandle(ref, () => ({
    createFromPassage: (text) => {
      if (canCreate) setForm({ open: true, passage: text });
    },
  }), [canCreate]);

  if (!urn) return null;

  const newCard = (
    <button
      type="button"
      onClick={() => {
        if (canCreate) setForm({ open: true });
      }}
      // Not `disabled`: a disabled button takes no focus and gives its Tooltip no hover.
      aria-disabled={canCreate ? undefined : true}
      aria-describedby={canCreate ? undefined : reasonId}
      className={cn(
        ACTION,
        'font-medium text-primary-600 hover:underline dark:text-primary-400',
        'aria-disabled:cursor-not-allowed aria-disabled:text-slate-400 aria-disabled:hover:no-underline dark:aria-disabled:text-slate-600',
      )}
    >
      + Nuova scheda
    </button>
  );

  return (
    <div role="group" aria-label="Schede di studio" className="mt-4 flex flex-wrap items-center gap-x-1 text-sm text-slate-500 dark:text-slate-400">
      {status === 'ready' && (
        <>
          {count > 0 ? (
            <button
              type="button"
              ref={setCountButton}
              onClick={() => setPeekOpen((open) => !open)}
              aria-haspopup="dialog"
              aria-expanded={peekOpen}
              className={cn(ACTION, 'text-slate-600 hover:text-slate-900 hover:underline dark:text-slate-300 dark:hover:text-white')}
            >
              Schede su questo articolo ({count})
            </button>
          ) : (
            <span>Nessuna scheda su questo articolo</span>
          )}
          <span aria-hidden="true"> · </span>
        </>
      )}
      {canCreate ? (
        newCard
      ) : (
        <>
          <Tooltip content={PAST_REASON}>{newCard}</Tooltip>
          <span id={reasonId} className="sr-only">{PAST_REASON}</span>
        </>
      )}

      <ArticleCardsPeek isOpen={peekOpen && count > 0} anchorEl={countButton} cards={cards} articleLabel={citeNorm(norma)} onClose={() => setPeekOpen(false)} />
      <CardFormDialog
        open={form.open}
        onClose={() => setForm((before) => ({ ...before, open: false }))}
        mode={{ kind: 'create', norma, passage: form.passage, suggestedIstituto }}
        onSaved={() => void refresh()}
      />
    </div>
  );
}
