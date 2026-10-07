import type { Ref } from 'react';
import { Highlighter, StickyNote } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';

export interface DecisionReadingToolbarProps {
  notesCount: number;
  highlightsCount: number;
  isNotesOpen: boolean;
  isHighlightsOpen: boolean;
  notesButtonRef?: Ref<HTMLButtonElement | null>;
  highlightsButtonRef?: Ref<HTMLButtonElement | null>;
  onToggleNotes: () => void;
  onToggleHighlights: () => void;
}

/**
 * The reading toolbar's notes and highlights buttons, as the article draws them (same look, same
 * places, same panels behind them). `ReadingToolbar` itself cannot be mounted for a decision: it
 * requires an article's `normaData`, quick norm, dossier, copy modal, export, version and compare
 * handlers, so only these two buttons are drawn here, from the same classes.
 */
export function DecisionReadingToolbar({
  notesCount, highlightsCount, isNotesOpen, isHighlightsOpen, notesButtonRef, highlightsButtonRef, onToggleNotes, onToggleHighlights,
}: DecisionReadingToolbarProps) {
  const size = 'min-h-[44px] min-w-[44px] p-2.5 md:min-h-0 md:min-w-0 md:p-1.5';
  return (
    <div className={cn('glass-toolbar sticky top-0 mb-4 flex items-center justify-end gap-1 rounded-t-xl border border-b-2 border-slate-200/50 bg-white/80 p-2 backdrop-blur-md dark:border-slate-800/50 dark:bg-slate-900/80', Z_INDEX.sticky)}>
      <button
        type="button"
        ref={notesButtonRef}
        onClick={onToggleNotes}
        aria-expanded={isNotesOpen}
        aria-haspopup="dialog"
        aria-label={isNotesOpen ? 'Chiudi note' : 'Apri note'}
        title={isNotesOpen ? 'Chiudi note' : 'Apri note'}
        className={cn('relative inline-flex items-center justify-center rounded-md transition-colors', size,
          isNotesOpen
            ? 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400'
            : notesCount > 0
              ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20'
              : 'text-slate-400 hover:bg-slate-100 hover:text-amber-500 dark:hover:bg-slate-800')}
      >
        <StickyNote size={16} aria-hidden />
        {notesCount > 0 && (
          <span aria-hidden className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white">{notesCount}</span>
        )}
      </button>
      <button
        type="button"
        ref={highlightsButtonRef}
        onClick={onToggleHighlights}
        aria-expanded={isHighlightsOpen}
        aria-haspopup="dialog"
        aria-label={isHighlightsOpen ? 'Chiudi evidenziazioni' : 'Gestisci evidenziazioni'}
        title={isHighlightsOpen ? 'Chiudi evidenziazioni' : 'Gestisci evidenziazioni'}
        className={cn('relative inline-flex items-center justify-center rounded-md transition-colors', size,
          isHighlightsOpen
            ? 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400'
            : highlightsCount > 0
              ? 'text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20'
              : 'text-slate-400 hover:bg-slate-100 hover:text-purple-500 dark:hover:bg-slate-800')}
      >
        <Highlighter size={16} aria-hidden />
        {highlightsCount > 0 && (
          <span aria-hidden className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-purple-500 text-[9px] font-bold text-white">{highlightsCount}</span>
        )}
      </button>
    </div>
  );
}
