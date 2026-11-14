import { useEffect, useRef, type RefObject } from 'react';
import type { Annotation } from '../types';
import { proposedPassageAt } from './useArticleTextInteractions';

/**
 * A tap on a wavy `.note-anchor` underline in the text hands that note to the reader (A4 §6: its card beside the text,
 * else its block's sheet — `useNoteOpener`; no popover); the full notes panel stays for the toolbar button. One
 * delegated click listener on the text container, because the markup comes from `SafeHTML`. Shared by every surface
 * that renders the reader's notes (the article tab, a decision, a dossier's entry). `enabled` waits for the body where it
 * is drawn after a fetch.
 */
export function useInlineNoteAnchors(
  containerRef: RefObject<HTMLElement | null>,
  notes: readonly Annotation[],
  onOpen: (note: Annotation, anchorEl: HTMLElement) => void,
  enabled = true,
): void {
  const latest = useRef(onOpen);
  useEffect(() => { latest.current = onOpen; });

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;
    const handler = (e: MouseEvent) => {
      // A passage an application proposed answers with its block's sheet instead (D7b, `useArticleTextInteractions`).
      if (proposedPassageAt(e.target)) return;
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('.note-anchor');
      if (!target) return;
      const noteId = target.getAttribute('data-note-id');
      if (!noteId) return;
      const note = notes.find((a) => a.id === noteId);
      if (!note) return;
      e.preventDefault();
      e.stopPropagation();
      latest.current(note, target);
    };
    container.addEventListener('click', handler);
    return () => container.removeEventListener('click', handler);
  }, [containerRef, notes, enabled]);
}
