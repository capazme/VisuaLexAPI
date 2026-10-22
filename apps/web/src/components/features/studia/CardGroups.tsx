import { ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../../../lib/utils';
import { ClaudeMark } from '../../ui/ClaudeMark';
import type { Scheda } from '../../../types/studia';
import { StateChip } from './StateChip';
import { FOCUS_RING, INK_BORDER, MUTED_TEXT, subjectHue } from './progress/tokens';
import { MATERIA_LABEL, TIPO_LABEL, anchorCitation, nextReviewLabel } from './studiaLabels';
import type { SubjectGroup } from './useMyCards';

export interface CardGroupsProps {
  groups: SubjectGroup[];
  selectedId: string | undefined;
  /** Institutes folded shut, by their key in `CardGroups` (subject and institute). */
  folded: ReadonlySet<string>;
  onToggleFold: (key: string) => void;
  /** The cards in a grid (G8): two columns from `lg`, three from `2xl`; one column beside a selected card. */
  grid?: boolean;
}

const foldKey = (materia: string, istituto: string) => `${materia}|${istituto}`;

const count = (n: number) => (n === 1 ? '1 scheda' : `${n} schede`);

/**
 * A card as a tile (G8): its front in the reader's serif, then its kind and citation, its subject with the hue's dot,
 * its state and its next review. The selected one takes an ink edge and a tint, so it is not told by colour alone; a
 * card takes a colour on hover, never a lift.
 */
function CardTile({ card, selected }: { card: Scheda; selected: boolean }) {
  const citation = anchorCitation(card);
  const nextReview = nextReviewLabel(card.prossimoRipasso);
  return (
    <li className="min-w-0">
      <Link
        to={`/studia/schede/${encodeURIComponent(card.id)}`}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'flex h-full min-h-[44px] flex-col gap-2 rounded-xl border p-3.5 transition-colors',
          FOCUS_RING,
          selected
            ? cn('border-2 bg-primary-50 dark:bg-primary-900/30', INK_BORDER)
            : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800/60',
        )}
      >
        <span className="line-clamp-3 break-words font-serif text-base leading-snug text-slate-900 dark:text-slate-50">{card.domanda}</span>
        {/* Slate 600 on the selected card's tint: 500 falls under AA there. */}
        <span className={cn('mt-auto grid gap-1.5 text-xs', selected ? 'text-slate-600 dark:text-slate-300' : MUTED_TEXT)}>
          <span className="min-w-0 break-words">{citation ? `${TIPO_LABEL[card.tipo]} · ${citation}` : TIPO_LABEL[card.tipo]}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: subjectHue(card.materia) }} />
              {MATERIA_LABEL[card.materia]}
            </span>
            <StateChip stato={card.stato} />
            <ClaudeMark createdBy={card.origine} compact />
            {nextReview && <span>{nextReview}</span>}
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * The cards under headings: a subject, named with its hue, then its institutes (the accordion pattern of
 * `DossierActBlock`: the heading holds the toggle), then the cards as tiles — in a grid of two columns from `lg` and three
 * from `2xl` across the page's width (G8), in one column beside a selected card.
 */
export function CardGroups({ groups, selectedId, folded, onToggleFold, grid = false }: CardGroupsProps) {
  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const total = group.istituti.reduce((sum, institute) => sum + institute.cards.length, 0);
        return (
          <section key={group.materia} aria-label={MATERIA_LABEL[group.materia]} className="min-w-0">
            <h3 className="flex flex-wrap items-baseline gap-x-2 pb-1 font-serif text-lg font-medium tracking-tight text-slate-900 dark:text-slate-50">
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 self-center rounded-full" style={{ backgroundColor: subjectHue(group.materia) }} />
              {MATERIA_LABEL[group.materia]}
              <span className={cn('font-sans text-xs font-normal', MUTED_TEXT)}>{count(total)}</span>
            </h3>
            {/* On the page's paper, not in a tile: the cards are the tiles. */}
            <div className="border-b border-slate-200 dark:border-slate-800">
              {group.istituti.map((institute) => {
                const key = foldKey(group.materia, institute.istituto);
                const isFolded = folded.has(key);
                return (
                  <div key={key} className="border-t border-slate-200 dark:border-slate-800">
                    <h4>
                      <button
                        type="button"
                        aria-expanded={!isFolded}
                        onClick={() => onToggleFold(key)}
                        className={cn(
                          'flex min-h-[44px] w-full items-center gap-2 rounded-lg px-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/60',
                          FOCUS_RING,
                          'focus-visible:ring-inset focus-visible:ring-offset-0',
                        )}
                      >
                        <ChevronDown size={16} aria-hidden className={cn('shrink-0 text-slate-500 transition-transform motion-reduce:transition-none dark:text-slate-400', isFolded && '-rotate-90')} />
                        <span className="min-w-0 flex-1 break-words">{institute.istituto}</span>
                        <span className={cn('shrink-0 text-xs font-normal', MUTED_TEXT)}>{count(institute.cards.length)}</span>
                      </button>
                    </h4>
                    {!isFolded && (
                      <ul className={cn('grid gap-2 pb-4 pt-1', grid && 'lg:grid-cols-2 2xl:grid-cols-3')}>
                        {institute.cards.map((card) => (
                          <CardTile key={card.id} card={card} selected={card.id === selectedId} />
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
