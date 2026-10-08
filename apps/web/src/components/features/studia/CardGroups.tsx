import { ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../../../lib/utils';
import { ClaudeMark } from '../../ui/ClaudeMark';
import type { Scheda } from '../../../types/studia';
import { StateChip } from './StateChip';
import { MATERIA_LABEL, TIPO_LABEL, anchorCitation } from './studiaLabels';
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
  return (
    <li>
      <Link
        to={`/studia/schede/${encodeURIComponent(card.id)}`}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'flex min-h-[44px] flex-col gap-1 rounded-lg px-3 py-2 transition-colors md:min-h-0',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
          selected ? 'bg-primary-50 dark:bg-primary-900/20' : 'hover:bg-slate-100 dark:hover:bg-slate-800/60',
        )}
      >
        <span className="line-clamp-2 break-words text-sm text-slate-900 md:text-[15px] dark:text-slate-100">{card.domanda}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span>{citation ? `${TIPO_LABEL[card.tipo]} · ${citation}` : TIPO_LABEL[card.tipo]}</span>
          <StateChip stato={card.stato} />
          <ClaudeMark createdBy={card.origine} compact />
        </span>
      </Link>
    </li>
  );
}

/**
 * The cards as rows under headings: a subject, then its institutes (the accordion pattern of
 * `DossierActBlock`: the heading holds the toggle), then one row per card.
 */
export function CardGroups({ groups, selectedId, folded, onToggleFold }: CardGroupsProps) {
  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const total = group.istituti.reduce((sum, institute) => sum + institute.cards.length, 0);
        return (
          <section key={group.materia} aria-label={MATERIA_LABEL[group.materia]}>
            <h3 className="flex items-baseline gap-2 px-1 text-base font-semibold text-slate-900 dark:text-white">
              {MATERIA_LABEL[group.materia]}
              <span className="text-xs font-normal text-slate-500 dark:text-slate-400">{count(total)}</span>
            </h3>
            <div className="mt-1 space-y-1">
              {group.istituti.map((institute) => {
                const key = foldKey(group.materia, institute.istituto);
                const isFolded = folded.has(key);
                return (
                  <div key={key}>
                    <h4>
                      <button
                        type="button"
                        aria-expanded={!isFolded}
                        onClick={() => onToggleFold(key)}
                        className="flex min-h-[44px] w-full items-center gap-2 rounded-md px-1 text-left text-sm font-medium text-slate-700 md:min-h-0 md:py-1.5 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      >
                        <ChevronDown size={16} aria-hidden className={cn('shrink-0 text-slate-400 transition-transform motion-reduce:transition-none', isFolded && '-rotate-90')} />
                        <span className="min-w-0 break-words">{institute.istituto}</span>
                        <span className="shrink-0 text-xs font-normal text-slate-500 dark:text-slate-400">{count(institute.cards.length)}</span>
                      </button>
                    </h4>
                    {!isFolded && (
                      <ul className="ml-3 border-l border-slate-200 pl-1 dark:border-slate-800">
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
