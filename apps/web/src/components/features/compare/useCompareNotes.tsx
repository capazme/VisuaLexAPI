import { useEffect, type ReactNode, type RefObject } from 'react';
import { getUpdateNoteParagraphs } from '../../../utils/articleStructure';
import type { CompareSide } from '../../../utils/articleCompare';
import { useArticleTextInteractions } from '../../../hooks/useArticleTextInteractions';
import { UpdateNotePopover } from '../search/UpdateNotePopover';
import type { SideText } from './compareLayout';

/**
 * The update notes: a «(119)» opens its AGGIORNAMENTO note and the folded tail of each column
 * opens with its toggle, through the reader's own hook. One container holds both columns, so
 * the fold is shared; the note is looked up in the article of the column the chip sits in.
 */
export function useCompareNotes(
  rootRef: RefObject<HTMLElement | null>,
  resetKey: string,
  contentKey: string,
  texts: Partial<Record<CompareSide, SideText>>,
): { updatesOpen: boolean; notePopover: ReactNode } {
  const { updatesOpen, openNote, closeNote } = useArticleTextInteractions(rootRef, resetKey, { contentKey });

  // Every tail has a toggle; the hook keeps the first one's aria-expanded in step.
  useEffect(() => {
    rootRef.current
      ?.querySelectorAll<HTMLElement>('.vlx-updates-toggle')
      .forEach((toggle) => toggle.setAttribute('aria-expanded', updatesOpen ? 'true' : 'false'));
  }, [rootRef, updatesOpen, contentKey]);

  const side = openNote?.anchorEl.closest<HTMLElement>('[data-side]')?.dataset.side;
  const text = side === 'left' || side === 'right' ? texts[side] : undefined;
  const note = openNote && text ? text.structure.notes[openNote.id] : undefined;
  const notePopover =
    openNote && text && note ? (
      <UpdateNotePopover
        noteId={openNote.id}
        paragraphs={getUpdateNoteParagraphs(text.raw, note)}
        anchorEl={openNote.anchorEl}
        onClose={closeNote}
      />
    ) : null;
  return { updatesOpen, notePopover };
}
