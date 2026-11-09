import type { Ink } from './highlighterRules';

/** What the note tool writes (A4 §6): a personal note, or a gloss (a discussion with colleagues). */
export type NoteKind = 'note' | 'gloss';

/** Words selected in a text that takes the highlighter, read as that text stores them, ready for an ink, or a note. */
export interface InkSelection {
  apply: (ink: Ink) => void;
  /**
   * The editor of a note on these words, as selected (A4 §6): absent where the text takes no note (a lesson). A gloss
   * where the reader has none is a personal note.
   */
  note?: (kind: NoteKind) => void;
}

/**
 * A text the reading tools' buttons apply to (A4): each reader's selection bar (`SelectionPopup`) and a lesson's text
 * (`LessonText`) register while they are mounted and take highlights.
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
