import type { Ref } from 'react';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { NotesHighlightsButtons } from '../search/NotesHighlightsButtons';
import { DiscussionButton } from '../search/DiscussionButton';

export interface DecisionReadingToolbarProps {
  notesCount: number;
  highlightsCount: number;
  isNotesOpen: boolean;
  isHighlightsOpen: boolean;
  notesButtonRef?: Ref<HTMLButtonElement | null>;
  highlightsButtonRef?: Ref<HTMLButtonElement | null>;
  onToggleNotes: () => void;
  onToggleHighlights: () => void;
  /** The discussion button is drawn only with its toggle: a decision whose identity was found passes it. */
  onToggleDiscussion?: () => void;
  isDiscussionOpen?: boolean;
}

/**
 * The decision's reading toolbar: the article's own notes and highlights buttons
 * (`NotesHighlightsButtons`) in the same glass bar. `ReadingToolbar` as a whole needs an article's
 * props (quick norm, dossier, copy, export, version, compare), so only these two are drawn, with
 * the article's discussion button (`DiscussionButton`) when the decision takes discussions.
 */
export function DecisionReadingToolbar({
  notesCount, highlightsCount, isNotesOpen, isHighlightsOpen, notesButtonRef, highlightsButtonRef, onToggleNotes, onToggleHighlights, onToggleDiscussion, isDiscussionOpen = false,
}: DecisionReadingToolbarProps) {
  return (
    <div className={cn('glass-toolbar sticky top-0 mb-4 flex items-center justify-end gap-1 rounded-t-xl border border-b-2 border-slate-200/50 bg-white/80 p-2 backdrop-blur-md dark:border-slate-800/50 dark:bg-slate-900/80', Z_INDEX.sticky)}>
      <NotesHighlightsButtons
        notesCount={notesCount}
        highlightsCount={highlightsCount}
        isNotesOpen={isNotesOpen}
        isHighlightsOpen={isHighlightsOpen}
        notesButtonRef={notesButtonRef}
        highlightsButtonRef={highlightsButtonRef}
        onToggleNotes={onToggleNotes}
        onToggleHighlights={onToggleHighlights}
      />
      {onToggleDiscussion && (
        <DiscussionButton isOpen={isDiscussionOpen} onToggle={onToggleDiscussion} name="Discussioni sulla decisione" />
      )}
    </div>
  );
}
