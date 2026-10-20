import { memo } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { formatCitationLabel, type CitationMatch } from '../../../utils/citationMatcher';
import { FOCUS_RING, TRANSITION } from '../../../constants/interactions';
import { cn } from '../../../lib/utils';
import { RECOGNISED_EXAMPLES, type ActGroup } from './citationGroups';

/** The first rows enter one after the other, 40 ms apart; the rest are simply there (brief D2 §4). */
const CASCADE = 8;

interface CitationListProps {
  groups: readonly ActGroup[];
  selected: number | null;
  onSelect: (index: number) => void;
  onOpen: (citation: CitationMatch) => void;
}

export const CitationList = memo(function CitationList({ groups, selected, onSelect, onOpen }: CitationListProps) {
  if (groups.length === 0) {
    return (
      <div className="px-5 py-6">
        <p className="font-serif text-lg text-slate-800 dark:text-slate-100">Non ho trovato citazioni di norme in questo documento.</p>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
          Riconosco, per esempio, {RECOGNISED_EXAMPLES.map((example, i) => (
            <span key={example}>{i > 0 && (i === RECOGNISED_EXAMPLES.length - 1 ? ' e ' : ', ')}«{example}»</span>
          ))}.
        </p>
      </div>
    );
  }

  let row = 0;
  return (
    <div className="pb-2">
      {groups.map((group, g) => (
        // Not a <section>: one landmark per act would crowd a screen reader's list of landmarks.
        <div key={group.key}>
          <h3 id={`doc-act-${g}`} className="flex items-baseline gap-1.5 px-4 pb-1.5 pt-4 font-serif text-[1.0625rem] font-medium text-slate-900 dark:text-slate-50">
            <span className="min-w-0 [overflow-wrap:anywhere]">{group.heading}</span>{' '}
            <span aria-hidden="true" className="text-slate-400 dark:text-slate-500">·</span>{' '}
            <span className="font-sans text-sm tabular-nums text-slate-600 dark:text-slate-400">
              {group.entries.length}<span className="sr-only">{group.entries.length === 1 ? ' citazione' : ' citazioni'}</span>
            </span>
          </h3>
          <ul aria-labelledby={`doc-act-${g}`}>
            {group.entries.map(entry => {
              const isSelected = entry.index === selected;
              const order = row++;
              const label = formatCitationLabel(entry.citation.parsed);
              const { before, match, after, cutBefore, cutAfter } = entry.passage;
              return (
                <li
                  key={entry.index}
                  data-cite-row={entry.index}
                  className={cn(
                    'relative flex items-stretch border-t border-slate-100 dark:border-slate-800/80',
                    order < CASCADE && 'motion-safe:animate-in fade-in slide-in-from-bottom-1 duration-200'
                  )}
                  style={order < CASCADE ? { animationDelay: `${order * 40}ms` } : undefined}
                >
                  {isSelected && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-primary-600 dark:bg-primary-400" />}
                  <button
                    type="button"
                    aria-current={isSelected || undefined}
                    onClick={() => onSelect(entry.index)}
                    className={cn(
                      'min-h-[44px] min-w-0 flex-1 py-2.5 pl-4 pr-2 text-left',
                      TRANSITION, FOCUS_RING, 'focus-visible:ring-inset focus-visible:ring-offset-0',
                      isSelected ? 'bg-primary-50 dark:bg-primary-950/50' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    )}
                  >
                    <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">{entry.article}</span>
                    <span className="mt-0.5 block truncate font-serif text-sm text-slate-600 dark:text-slate-400">
                      {cutBefore && '…'}{before}<span className="text-slate-900 dark:text-slate-100">{match}</span>{after}{cutAfter && '…'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpen(entry.citation)}
                    aria-label={`Apri ${label}`}
                    className={cn(
                      'inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1 px-3 text-sm font-medium',
                      'text-primary-700 hover:bg-primary-50 hover:text-primary-800 dark:text-primary-300 dark:hover:bg-primary-950/50 dark:hover:text-primary-200',
                      TRANSITION, FOCUS_RING, 'focus-visible:ring-inset focus-visible:ring-offset-0'
                    )}
                  >
                    Apri <ArrowUpRight aria-hidden="true" size={15} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
});
