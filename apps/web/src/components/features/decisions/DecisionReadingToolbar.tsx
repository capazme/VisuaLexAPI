import type { ReactNode, Ref } from 'react';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { NotesHighlightsButtons } from '../search/NotesHighlightsButtons';
import { DiscussionButton } from '../search/DiscussionButton';
import { FindInTextButton } from '../search/FindInTextButton';

export interface DecisionReadingToolbarProps {
  notesCount: number;
  highlightsCount: number;
  isNotesOpen: boolean;
  isHighlightsOpen: boolean;
  notesButtonRef?: Ref<HTMLButtonElement | null>;
  highlightsButtonRef?: Ref<HTMLButtonElement | null>;
  onToggleNotes: () => void;
  onToggleHighlights: () => void;
  /** The discussion button's toggle: the toolbar is drawn for a found decision, which always takes discussions. */
  onToggleDiscussion: () => void;
  isDiscussionOpen?: boolean;
  /** «Cerca nel testo»: the toolbar is drawn over a decision with text, so the button is always there. `isFindOpen`: the
   *  floating find window is open and scoped to this tab. */
  isFindOpen: boolean;
  onToggleFind: (wasPressed: boolean) => void;
  findButtonRef?: Ref<HTMLButtonElement>;
  /** «Passaggi chiave» (`KeyPassagesMenu`), first in the bar when the decision has any. */
  keyPassages?: ReactNode;
}

/**
 * The decision's reading toolbar: the article's own notes and highlights buttons
 * (`NotesHighlightsButtons`) in the same glass bar. `ReadingToolbar` as a whole needs an article's
 * props (quick norm, dossier, copy, export, version, compare), so only these two are drawn, with
 * the article's discussion button (`DiscussionButton`), and the decision's own «Passaggi chiave».
 */
export function DecisionReadingToolbar({
  notesCount, highlightsCount, isNotesOpen, isHighlightsOpen, notesButtonRef, highlightsButtonRef, onToggleNotes, onToggleHighlights, onToggleDiscussion, isDiscussionOpen = false,
  isFindOpen, onToggleFind, findButtonRef, keyPassages,
}: DecisionReadingToolbarProps) {
  return (
    <div data-pinned-head className={cn('glass-toolbar sticky top-0 mb-4 flex flex-wrap items-center justify-end gap-1 rounded-t-xl border border-b-2 border-slate-200/50 bg-white/80 p-2 backdrop-blur-md dark:border-slate-800/50 dark:bg-slate-900/80', Z_INDEX.sticky)}>
      {keyPassages}
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
      <DiscussionButton isOpen={isDiscussionOpen} onToggle={onToggleDiscussion} name="Discussioni sulla decisione" />
      <FindInTextButton ref={findButtonRef} isOpen={isFindOpen} onToggle={onToggleFind} />
    </div>
  );
}
