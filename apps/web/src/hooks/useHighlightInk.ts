import { useEffect } from 'react';
import { appStore, useAppStore } from '../store/useAppStore';
import { showText } from '../store/textsOnScreen';
import type { Highlight } from '../types';
import { resolveAnchors } from '../utils/articleAnnotations';
import { highlightColorName, type HighlightColor } from '../utils/highlightColors';
import { partsOf, planInk, type Ink, type InkMark } from '../utils/highlighterRules';

/**
 * The user's highlights where they land in `plain`, as the highlighter's rules read them: one from the Forum (it keeps
 * its first author, gotcha 21) or one saved before offsets existed is never cut.
 */
export function inkMarks(plain: string, highlights: readonly Highlight[]): InkMark[] {
  return resolveAnchors(plain, highlights, []).flatMap((anchor) => (anchor.kind === 'highlight'
    ? [{
        id: anchor.highlight.id,
        start: anchor.start,
        end: anchor.end,
        color: anchor.highlight.color,
        whole: Boolean(anchor.highlight.sourceSuggestionId || anchor.highlight.originalAuthor) || typeof anchor.highlight.startOffset !== 'number',
      }]
    : []));
}

export interface HighlightInkOptions {
  /** The text's key and article id: the pair its highlights are stored under. */
  key: string;
  articleId: string;
  /** The projection the anchors count in (an article's text without `\n`, a decision's `decisionProjection`). */
  plain: string;
  /** Where each block after the first starts in `plain` (`blockStarts`), read as a gesture comes: one colour is never
   * joined across one. */
  breaks?: () => readonly number[];
  /** False on a text that takes no highlight (a past text). */
  enabled?: boolean;
  /** Words were highlighted, alone or joined to the highlights they meet (the article's MERL-T event); never for a cut
   * or a colour changed. */
  onCreated?: (text: string, color: HighlightColor, startOffset: number) => void;
}

/**
 * The highlighter over a reader's text (A4): the words selected and the ink, through the rules (`planInk`), into the
 * store — a new highlight (`addHighlight`), or one gesture over existing ones (`editHighlights`). The same with the tool
 * on, with the button pressed over a selection, with H and «Evidenzia» in the selection bar, and with Study Mode's keys.
 * No notification (the owner, 5 November 2026): a gesture is said to a screen reader, and Ctrl+Z (⌘Z) takes the last one
 * back while its text is on screen — this reader counts its text as on screen while it is mounted.
 */
export function useHighlightInk({ key, articleId, plain, breaks, enabled = true, onCreated }: HighlightInkOptions) {
  const addHighlight = useAppStore((s) => s.addHighlight);
  const editHighlights = useAppStore((s) => s.editHighlights);
  // A text that takes no highlight (a past text, whose key is the text in force's) draws none to undo.
  useEffect(() => (enabled ? showText(key) : undefined), [key, enabled]);
  return (text: string, ink: Ink, startOffset: number) => {
    if (!enabled) return;
    // The user's own highlights on this text as the store holds them now, not as the last render drew them: a second
    // gesture before the screen caught up (a key held down) must see the first, or it would make the same highlight
    // again (the owner's duplicates, 5 November). An application's passages are never in it (D7b, D8).
    const highlights = appStore.getState().highlights.filter((h) => h.normaKey === key && h.articleId === articleId);
    const plan = planInk({ start: startOffset, end: startOffset + text.length, ink, marks: inkMarks(plain, highlights), plain, breaks: breaks?.() });
    if (plan.kind === 'nothing') return;
    if (plan.kind === 'create') {
      addHighlight(key, articleId, text, '', plan.color, startOffset);
      onCreated?.(text, plan.color, startOffset);
      return;
    }
    const message = plan.effect === 'created' && plan.color
      ? `Testo evidenziato in ${highlightColorName(plan.color)}`
      : plan.effect === 'recoloured' && plan.color
        ? `Evidenziazione cambiata in ${highlightColorName(plan.color)}`
        : plan.remove.length > 1 ? 'Evidenziazioni rimosse' : 'Evidenziazione rimossa';
    editHighlights({ normaKey: key, articleId, remove: plan.remove, recolor: plan.recolor, add: partsOf(plain, plan.add), message });
    // A highlight made by joining the ones it meets is a new highlight too, for the article's MERL-T event.
    if (plan.effect === 'created' && plan.color) onCreated?.(text, plan.color, startOffset);
  };
}
