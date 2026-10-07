import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { Highlight } from '../types';

export type SelectionRect = { x: number; y: number; width: number; height: number };
export type NoteAnchor = { anchorText: string; startOffset: number; scopedArticleId: string };

export interface AnnotationActionsOptions {
  /** The text's key and article id: the pair every highlight and note of this text is stored under. */
  key: string;
  articleId: string;
  /** The highlights already on this text, for the «già evidenziata» guard. */
  highlights: readonly Highlight[];
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
  /** False on a text that takes no marks (a past text): the selection popup's actions do nothing. */
  enabled?: boolean;
  /** Side effects only an article has (MERL-T events); a decision passes none. */
  onHighlightAdded?: (text: string, color: string, startOffset: number) => void;
  onNoteSelection?: (text: string, startOffset: number) => void;
  onNoteAdded?: (info: { targetArticleId: string; anchor: NoteAnchor | null; text: string }) => void;
}

/**
 * What the selection popup's «Evidenzia» and «Nota» do, and the tooltip composer's state, for any
 * surface that renders the reader's marks: the same guard, the same store calls, the same toasts.
 * The anchor's `scopedArticleId` lets a sub-section (Brocardi) target its own scope.
 */
export function useAnnotationActions({
  key, articleId, highlights, showToast, enabled = true, onHighlightAdded, onNoteSelection, onNoteAdded,
}: AnnotationActionsOptions) {
  const addHighlight = useAppStore((s) => s.addHighlight);
  const addAnnotation = useAppStore((s) => s.addAnnotation);
  // The selected span becomes the note's anchor; the composer sits on the span itself, at the rect
  // the popup captured before the selection cleared (gotcha 16).
  const [noteAnchor, setNoteAnchor] = useState<NoteAnchor | null>(null);
  const [composerRect, setComposerRect] = useState<SelectionRect | null>(null);

  const handlePopupHighlight = (text: string, color: 'yellow' | 'green' | 'red' | 'blue', startOffset: number) => {
    if (!enabled) return;
    const already = highlights.some((h) => h.text.toLowerCase() === text.toLowerCase() && h.startOffset === startOffset);
    if (already) {
      showToast('Questa occorrenza è già evidenziata', 'info');
      return;
    }
    addHighlight(key, articleId, text, '', color, startOffset);
    onHighlightAdded?.(text, color, startOffset);
    showToast(`Testo evidenziato in ${color}`, 'success');
  };

  const openComposer = (anchor: NoteAnchor, rect: SelectionRect) => {
    setNoteAnchor(anchor);
    setComposerRect(rect);
  };

  const handlePopupAddNote = (text: string, startOffset: number, rect: SelectionRect) => {
    if (!enabled) return;
    onNoteSelection?.(text, startOffset);
    openComposer({ anchorText: text, startOffset, scopedArticleId: articleId }, rect);
  };

  const handleAddNote = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const anchor = noteAnchor;
    const targetArticleId = anchor?.scopedArticleId ?? articleId;
    addAnnotation(key, targetArticleId, trimmed, anchor ? { anchorText: anchor.anchorText, startOffset: anchor.startOffset } : undefined);
    onNoteAdded?.({ targetArticleId, anchor, text: trimmed });
    setNoteAnchor(null);
    showToast(anchor ? 'Nota ancorata al testo' : 'Nota aggiunta', 'success');
  };

  const closeComposer = () => {
    setNoteAnchor(null);
    setComposerRect(null);
  };

  const commitComposer = (text: string) => {
    handleAddNote(text);
    setComposerRect(null);
  };

  return {
    noteAnchor, composerRect, clearAnchor: () => setNoteAnchor(null),
    openComposer, handlePopupHighlight, handlePopupAddNote, handleAddNote, closeComposer, commitComposer,
  };
}
