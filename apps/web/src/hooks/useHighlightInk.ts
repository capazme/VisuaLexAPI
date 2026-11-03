import { useAppStore } from '../store/useAppStore';
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
  /** The user's own highlights on this text: never an application's passages (D7b, D8), which the tool leaves alone. */
  highlights: readonly Highlight[];
  /** False on a text that takes no highlight (a past text). */
  enabled?: boolean;
  /** The reader's toast for a new highlight («Testo evidenziato in giallo»); a change says itself, with «Annulla». */
  showToast?: (message: string, type: 'success' | 'error' | 'info') => void;
  /** A new highlight was made (the article's MERL-T event); never for a cut or a colour changed. */
  onCreated?: (text: string, color: HighlightColor, startOffset: number) => void;
}

/**
 * The highlighter over a reader's text (A4): the words selected and the ink, through the rules (`planInk`), into the
 * store — a new highlight, or one gesture over existing ones behind one «Annulla» (`editHighlights`). The same with
 * the tool on, with the button pressed over a selection, with H and «Evidenzia» in the selection bar, and with Study
 * Mode's keys.
 */
export function useHighlightInk({ key, articleId, plain, highlights, enabled = true, showToast, onCreated }: HighlightInkOptions) {
  const addHighlight = useAppStore((s) => s.addHighlight);
  const editHighlights = useAppStore((s) => s.editHighlights);
  return (text: string, ink: Ink, startOffset: number) => {
    if (!enabled) return;
    const plan = planInk({ start: startOffset, end: startOffset + text.length, ink, marks: inkMarks(plain, highlights) });
    if (plan.kind === 'nothing') return;
    if (plan.kind === 'create') {
      addHighlight(key, articleId, text, '', plan.color, startOffset);
      onCreated?.(text, plan.color, startOffset);
      showToast?.(`Testo evidenziato in ${highlightColorName(plan.color)}`, 'success');
      return;
    }
    const message = plan.effect === 'recoloured' && plan.color
      ? `Evidenziazione cambiata in ${highlightColorName(plan.color)}`
      : plan.remove.length > 1 ? 'Evidenziazioni rimosse' : 'Evidenziazione rimossa';
    editHighlights({ normaKey: key, articleId, remove: plan.remove, recolor: plan.recolor, add: partsOf(plain, plan.add), message });
  };
}
