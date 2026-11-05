import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { Highlight } from '../types';
import type { Ink } from '../utils/highlighterRules';
import { useHighlightInk } from './useHighlightInk';

export type SelectionRect = { x: number; y: number; width: number; height: number };
export type NoteAnchor = { anchorText: string; startOffset: number; scopedArticleId: string };

export interface AnnotationActionsOptions {
  /** The text's key and article id: the pair every highlight and note of this text is stored under. */
  key: string;
  articleId: string;
  /** The user's own highlights on this text, which the highlighter's rules read (A4). */
  highlights: readonly Highlight[];
  /** The projection the anchors count in: the parts a cut leaves are its own words. */
  plain: string;
  /** A note's toast («Nota ancorata al testo»); a highlight says nothing (A4). */
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
 * surface that renders the reader's marks: the same rules (the highlighter's, A4), the same store calls, the same toasts
 * for notes (none for highlights).
 * The anchor's `scopedArticleId` lets a sub-section of the article target its own scope.
 */
export function useAnnotationActions({
  key, articleId, highlights, plain, showToast, enabled = true, onHighlightAdded, onNoteSelection, onNoteAdded,
}: AnnotationActionsOptions) {
  const applyInk = useHighlightInk({ key, articleId, plain, highlights, enabled, onCreated: onHighlightAdded });
  const addAnnotation = useAppStore((s) => s.addAnnotation);
  // The selected span becomes the note's anchor; the composer sits on the span itself, at the rect
  // the popup captured before the selection cleared (gotcha 16).
  const [noteAnchor, setNoteAnchor] = useState<NoteAnchor | null>(null);
  const [composerRect, setComposerRect] = useState<SelectionRect | null>(null);

  // The words selected and the ink: a new highlight, or the same words taken away or recoloured (A4).
  const handlePopupHighlight = (text: string, ink: Ink, startOffset: number) => applyInk(text, ink, startOffset);

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
