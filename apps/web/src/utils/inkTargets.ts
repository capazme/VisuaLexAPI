import type { Ink } from './highlighterRules';

/** Words selected in a text that takes the highlighter, read as that text stores them, ready for an ink. */
export interface InkSelection {
  apply: (ink: Ink) => void;
}

/**
 * A text the highlighter's button can apply its ink to (A4): each reader's selection bar (`SelectionPopup`) and a
 * lesson's text (`LessonText`) register while they are mounted and take highlights.
 */
export interface InkTarget {
  /** Whether the selected range lies in this text. */
  holds: (range: Range) => boolean;
  /** The selection as this text stores it (its own offsets); null when it cannot take it. */
  read: (selection: Selection) => InkSelection | null;
}

const targets = new Set<InkTarget>();

export function registerInkTarget(target: InkTarget): () => void {
  targets.add(target);
  return () => { targets.delete(target); };
}

/**
 * The words selected now, read by the text that holds them; null when nothing is selected in a text that takes the
 * ink. The button reads it as its press starts, before the press or its menu can take the selection away.
 */
export function readInkSelection(): InkSelection | null {
  const selection = typeof window === 'undefined' ? null : window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !selection.toString().trim()) return null;
  const range = selection.getRangeAt(0);
  for (const target of targets) {
    if (target.holds(range)) return target.read(selection);
  }
  return null;
}
