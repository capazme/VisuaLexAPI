import { useMemo } from 'react';
import { CheckSquare, ChevronDown, Square, Star, Trash2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { identityOf } from '../../../utils/decisionLinks';
import { ClaudeMark } from '../../ui/ClaudeMark';
import { claudeMarkSentence } from '../../ui/claudeMarkSentence';
import { DossierDecisionReader } from './DossierDecisionReader';
import { decisionCitationOf, formatTimestampLong } from './dossierUtils';
import type { SentenzaItem } from './dossierLayout';
import { FOCUS_RING } from '../studia/progress/tokens';
import { ROW, ROW_ICON, ROW_LINE, ROW_REMOVE, ROW_TITLE } from './dossierStyles';

export interface DossierDecisionRowProps {
  item: SentenzaItem;
  isSelected: boolean;
  showCheckbox: boolean;
  onToggleSelect: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onRemove: () => void;
  onToggleImportant: () => void;
}

/**
 * One decision of «Giurisprudenza», a row as an article's (D7a, `DossierArticleRow`): the checkbox while selecting, the
 * toggle with its arrow, the citation over a grey line («Aggiunta il …»), then the star and the removal, 44 px at every
 * width; the decision read in place (`DossierDecisionReader`), asked for only once the row is opened. The citation is
 * recomputed from the stored identity, never the stored copy (source convention, Q9). The application that filed it, as
 * an article's notes are marked («aggiunta da Claude Code», `createdBy`, which the server records on every item). No
 * note count: a note of the dossier is about an article only, and the notes and highlights on the text would cost a
 * read per decision.
 */
export function DossierDecisionRow({
  item, isSelected, showCheckbox, onToggleSelect, isExpanded, onToggleExpand, onRemove, onToggleImportant,
}: DossierDecisionRowProps) {
  const citation = decisionCitationOf(item.data);
  const added = formatTimestampLong(item.addedAt);
  const isImportant = item.status === 'important';
  const regionId = `dossier-item-content-${item.id}`;
  // One object while the item stays: the reader asks the source again for a new reference, and the page redraws often.
  const identity = useMemo(() => identityOf(item.data), [item.data]);
  const byApp = item.createdBy ?? null;
  // The mark sits inside the toggle, whose name replaces it for a screen reader: the name says it.
  const rowLabel = `${isExpanded ? 'Comprimi' : 'Espandi'} ${citation}` + (byApp ? `, ${claudeMarkSentence(byApp, 'aggiunta')}` : '');

  return (
    <div className={cn(ROW, 'pl-3 transition-colors', isSelected ? 'bg-primary-50 dark:bg-primary-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40')}>
      {isImportant && <span aria-hidden className="absolute bottom-2 left-0 top-2 w-1 rounded bg-amber-400" />}
      <div className="flex items-start gap-1">
        {showCheckbox && (
          <button
            type="button"
            onClick={onToggleSelect}
            aria-label={isSelected ? 'Deseleziona elemento' : 'Seleziona elemento'}
            aria-pressed={isSelected}
            className={cn(ROW_ICON, 'text-slate-500 hover:text-primary-700 dark:text-slate-400 dark:hover:text-primary-300')}
          >
            {isSelected ? <CheckSquare size={18} className="text-primary-600 dark:text-primary-400" /> : <Square size={18} />}
          </button>
        )}
        {/* As an article's: the toggle wraps only text, the star and the removal stay outside it. */}
        <div
          role="button"
          tabIndex={0}
          aria-label={rowLabel}
          aria-expanded={isExpanded}
          aria-controls={isExpanded ? regionId : undefined}
          onClick={onToggleExpand}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggleExpand();
            }
          }}
          className={cn('flex min-h-[44px] min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-md py-2.5', FOCUS_RING)}
        >
          <ChevronDown
            size={16}
            aria-hidden
            className={cn('mt-0.5 flex-shrink-0 text-slate-500 transition-transform motion-reduce:transition-none dark:text-slate-400', !isExpanded && '-rotate-90')}
          />
          <span className="min-w-0 flex-1">
            <span className={cn(ROW_TITLE, 'block font-medium [overflow-wrap:anywhere]')}>{citation}</span>
            {/* The application's mark on the grey line, not at the right as an article's signs: a citation is long, and
                beside a mark it was squeezed into a column of words on a phone. */}
            {(added || byApp) && (
              <span className={cn(ROW_LINE, 'mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1')}>
                {added && <span>Aggiunta il {added}</span>}
                {byApp && <ClaudeMark createdBy={byApp} compact verb="aggiunta" />}
              </span>
            )}
          </span>
        </div>
        <button
          type="button"
          onClick={onToggleImportant}
          aria-pressed={isImportant}
          aria-label={isImportant ? 'Rimuovi da importanti' : 'Segna come importante'}
          title={isImportant ? 'Importante' : 'Segna come importante'}
          className={cn(
            ROW_ICON,
            isImportant
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-slate-500 hover:bg-amber-50 hover:text-amber-600 dark:text-slate-400 dark:hover:bg-amber-900/20',
          )}
        >
          <Star size={16} className={cn(isImportant && 'fill-amber-400')} />
        </button>
        <button type="button" onClick={onRemove} aria-label={`Rimuovi ${citation} dal dossier`} className={ROW_REMOVE}>
          <Trash2 size={16} aria-hidden />
        </button>
      </div>
      {isExpanded && (
        <div id={regionId} className="pb-3 pl-6 pr-2">
          <DossierDecisionReader identity={identity} />
        </div>
      )}
    </div>
  );
}
