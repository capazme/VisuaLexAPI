import { useEffect, useState, type RefObject } from 'react';
import type { Annotation } from '../types';

/**
 * A tap on a wavy `.note-anchor` underline in the text opens that single note's compact popover
 * (`InlineNotePopover`); the full notes panel stays for the toolbar button. One delegated click
 * listener on the text container, because the markup comes from `SafeHTML`. Shared by every
 * surface that renders the reader's notes (the article tab, a decision).
 */
export function useInlineNoteAnchors(
  containerRef: RefObject<HTMLElement | null>,
  notes: readonly Annotation[],
): { inlineNote: { note: Annotation; anchorEl: HTMLElement } | null; closeInlineNote: () => void } {
  const [inlineNote, setInlineNote] = useState<{ note: Annotation; anchorEl: HTMLElement } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handler = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('.note-anchor');
      if (!target) return;
      const noteId = target.getAttribute('data-note-id');
      if (!noteId) return;
      const note = notes.find((a) => a.id === noteId);
      if (!note) return;
      e.preventDefault();
      e.stopPropagation();
      setInlineNote({ note, anchorEl: target });
    };
    container.addEventListener('click', handler);
    return () => container.removeEventListener('click', handler);
  }, [containerRef, notes]);

  return { inlineNote, closeInlineNote: () => setInlineNote(null) };
}
