import { ArrowLeft } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { ClaudeMark } from '../../ui/ClaudeMark';
import type { AncoraScheda, Scheda } from '../../../types/studia';
import { StateChip } from './StateChip';
import { MATERIA_LABEL, TIPO_LABEL, anchorLabel } from './studiaLabels';

export interface CardDetailProps {
  card: Scheda;
  /** A phone shows the detail alone: «Indietro» returns to the list. */
  onBack?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** Opens the anchor's article in the reader. */
  onOpenAnchor: (anchor: AncoraScheda) => void;
}

const BUTTON =
  'inline-flex min-h-[44px] items-center justify-center rounded-lg border px-3 text-sm font-medium transition-colors md:min-h-0 md:py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
const MEASURE = 'max-w-[60ch]';

/**
 * A card, read like the law it rests on: the article it rests on as a source line, then the
 * question and the answer in the reader's serif, set apart by one rule. Question, answer and
 * explanation are plain text, left to React as text nodes.
 *
 * A draft may be edited and deleted, an archived card deleted; a proposed, validated or
 * «da rivedere» card is kept (spec D6).
 */
export function CardDetail({ card, onBack, onEdit, onDelete, onOpenAnchor }: CardDetailProps) {
  const canEdit = card.stato === 'BOZZA_PERSONALE';
  const canDelete = canEdit || card.stato === 'ARCHIVIATA';
  // The primary anchor first; one whose address names no article cannot be opened.
  const anchors = [...card.ancore].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).filter((a) => anchorLabel(a));
  const [source, ...others] = anchors;

  return (
    <article aria-label="Scheda" className="space-y-5">
      <div className="flex items-center gap-2">
        {onBack && (
          <button type="button" onClick={onBack} className={cn(BUTTON, 'border-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800')}>
            <ArrowLeft size={16} aria-hidden className="mr-1.5" />
            Indietro
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {canEdit && (
            <button type="button" onClick={onEdit} className={cn(BUTTON, 'border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800')}>
              Modifica
            </button>
          )}
          {canDelete && (
            <button type="button" onClick={onDelete} className={cn(BUTTON, 'border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-900/20')}>
              Elimina
            </button>
          )}
        </div>
      </div>

      <div>
        {source && (
          <button
            type="button"
            onClick={() => onOpenAnchor(source)}
            title="Apri l’articolo nel lettore"
            className="mb-2 min-h-[44px] rounded text-left text-sm text-slate-500 hover:text-primary-700 hover:underline md:min-h-0 dark:text-slate-400 dark:hover:text-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            {anchorLabel(source)}
          </button>
        )}
        <h3 className={cn(MEASURE, 'whitespace-pre-line break-words text-left font-serif text-xl leading-[1.7] text-slate-900 dark:text-slate-50')}>{card.domanda}</h3>
        <hr className={cn(MEASURE, 'my-4 border-slate-200 dark:border-slate-700')} />
        <p className={cn(MEASURE, 'whitespace-pre-line break-words text-left font-serif text-lg leading-[1.7] text-slate-800 dark:text-slate-200')}>{card.risposta}</p>
      </div>

      {card.spiegazione && (
        <section>
          <h4 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">Spiegazione</h4>
          <p className={cn(MEASURE, 'whitespace-pre-line break-words text-left font-serif text-base leading-[1.7] text-slate-600 dark:text-slate-400')}>{card.spiegazione}</p>
        </section>
      )}

      {others.length > 0 && (
        <section>
          <h4 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">Altre ancore</h4>
          <ul>
            {others.map((anchor) => (
              <li key={`${anchor.normaKey}|${anchor.articleId}`}>
                <button
                  type="button"
                  onClick={() => onOpenAnchor(anchor)}
                  title="Apri l’articolo nel lettore"
                  className="min-h-[44px] rounded text-left text-sm text-slate-600 hover:text-primary-700 hover:underline md:min-h-0 md:py-1 dark:text-slate-300 dark:hover:text-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  {anchorLabel(anchor)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 pt-3 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <span>{MATERIA_LABEL[card.materia]} · {card.istituto} · {TIPO_LABEL[card.tipo]}</span>
        <StateChip stato={card.stato} />
        <ClaudeMark createdBy={card.origine} />
      </div>
    </article>
  );
}
