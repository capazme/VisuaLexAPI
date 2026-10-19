import { ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../../../lib/utils';
import { ClaudeMark } from '../../ui/ClaudeMark';
import type { Scheda } from '../../../types/studia';
import { StateChip } from './StateChip';
import { FOCUS_RING, MUTED_TEXT, TILE, subjectHue } from './progress/tokens';
import { MATERIA_LABEL, TIPO_LABEL, anchorCitation, nextReviewLabel } from './studiaLabels';
import type { SubjectGroup } from './useMyCards';

export interface CardGroupsProps {
  groups: SubjectGroup[];
  selectedId: string | undefined;
  /** Institutes folded shut, by their key in `CardGroups` (subject and institute). */
  folded: ReadonlySet<string>;
  onToggleFold: (key: string) => void;
}

const foldKey = (materia: string, istituto: string) => `${materia}|${istituto}`;

const count = (n: number) => (n === 1 ? '1 scheda' : `${n} schede`);

function CardRow({ card, selected }: { card: Scheda; selected: boolean }) {
  const citation = anchorCitation(card);
  const nextReview = nextReviewLabel(card.prossimoRipasso);
  return (
    <li>
      <Link
        to={`/studia/schede/${encodeURIComponent(card.id)}`}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          // A row takes a colour on hover, never a lift; the selected one an ink edge, so it is not told by colour alone.
          'flex min-h-[44px] flex-col gap-1 border-l-2 py-2.5 pl-3 pr-3 transition-colors',
          FOCUS_RING,
          'focus-visible:ring-inset focus-visible:ring-offset-0',
          selected
            ? 'border-primary-900 bg-primary-50 dark:border-primary-300 dark:bg-primary-900/30'
            : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/60',
        )}
      >
        <span className="line-clamp-2 break-words font-serif text-base leading-snug text-slate-900 dark:text-slate-50">{card.domanda}</span>
        {/* Slate 600 on the selected row's tint: 500 falls under AA there. */}
        <span className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-xs', selected ? 'text-slate-600 dark:text-slate-300' : MUTED_TEXT)}>
          <span className="min-w-0 break-words">{citation ? `${TIPO_LABEL[card.tipo]} · ${citation}` : TIPO_LABEL[card.tipo]}</span>
          <StateChip stato={card.stato} />
          <ClaudeMark createdBy={card.origine} compact />
          {nextReview && <span>{nextReview}</span>}
        </span>
      </Link>
    </li>
  );
}

/**
 * The cards as rows under headings: a subject, in a tile marked with its hue, then its institutes (the
 * accordion pattern of `DossierActBlock`: the heading holds the toggle), then one row per card.
 */
export function CardGroups({ groups, selectedId, folded, onToggleFold }: CardGroupsProps) {
  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const total = group.istituti.reduce((sum, institute) => sum + institute.cards.length, 0);
        return (
          <section key={group.materia} aria-label={MATERIA_LABEL[group.materia]} className={cn(TILE, 'overflow-hidden')}>
            <h3 className="flex flex-wrap items-baseline gap-x-2 px-4 pb-1 pt-4 font-serif text-lg font-medium tracking-tight text-slate-900 dark:text-slate-50">
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 self-center rounded-full" style={{ backgroundColor: subjectHue(group.materia) }} />
              {MATERIA_LABEL[group.materia]}
              <span className={cn('font-sans text-xs font-normal', MUTED_TEXT)}>{count(total)}</span>
            </h3>
            <div className="pb-2">
              {group.istituti.map((institute) => {
                const key = foldKey(group.materia, institute.istituto);
                const isFolded = folded.has(key);
                return (
                  <div key={key} className="border-t border-slate-100 first:border-t-0 dark:border-slate-800">
                    <h4>
                      <button
                        type="button"
                        aria-expanded={!isFolded}
                        onClick={() => onToggleFold(key)}
                        className={cn(
                          'flex min-h-[44px] w-full items-center gap-2 px-3 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/60',
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
                      <ul className="ml-5 border-l border-slate-200 dark:border-slate-700">
                        {institute.cards.map((card) => (
                          <CardRow key={card.id} card={card} selected={card.id === selectedId} />
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
