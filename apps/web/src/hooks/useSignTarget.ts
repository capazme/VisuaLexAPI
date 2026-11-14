import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { Annotation } from '../types';
import { hasAnnotations, type BlockAnnotations } from '../utils/articleAnnotations';
import type { AnnotationMarginHandle } from '../components/features/search/AnnotationMargin';

/** The keys of a block's cards beside the text (`AnnotationMargin`): its notes, discussions and an application's glosses. */
export function cardKeys(group: BlockAnnotations | undefined): string[] {
  if (!group) return [];
  return [
    ...group.notes.map((n) => `note:${n.id}`),
    ...group.threads.map((t) => `thread:${t.id}`),
    ...group.glosses.map((g) => `gloss:${g.id}`),
  ];
}

export interface SignTargetOptions {
  /** The block whose sign was pressed, and whether everything of it was asked for (`useArticleTextInteractions`). */
  openBlock: number | null;
  blockAll: boolean;
  group: BlockAnnotations | undefined;
  /** Whether the column beside the text is shown (`AnnotationMargin`'s `onWideChange`). */
  marginShown: boolean;
  marginRef: RefObject<AnnotationMarginHandle | null>;
  closeBlock: () => void;
  openBlockAt: (index: number, all?: boolean) => void;
}

/**
 * Where a block's sign takes the reader (A4 §6, «nessun riquadro»): the block's first card beside the text, where the
 * column is shown and the block has one there — the block is then closed again, so the next press does the same —;
 * else, or with Shift, or for a passage an application proposed, the block's sheet (`BlockAnnotationsSheet`). Decided
 * as the block opens: a reader widened while its sheet is open (a note half edited in it) keeps the sheet. True while
 * the sheet is to be drawn.
 */
export function useSignTarget({ openBlock, blockAll, group, marginShown, marginRef, closeBlock, openBlockAt }: SignTargetOptions): boolean {
  const [decided, setDecided] = useState<{ block: number | null; all: boolean; sheet: boolean }>({ block: null, all: false, sheet: false });
  // Adjusted during render (gotcha 11): decided once per opening.
  if (decided.block !== openBlock || decided.all !== blockAll) {
    setDecided({ block: openBlock, all: blockAll, sheet: openBlock !== null && (blockAll || !marginShown || cardKeys(group).length === 0) });
  }
  const current = decided.block === openBlock && decided.all === blockAll;
  const toMargin = openBlock !== null && current && !decided.sheet;
  useEffect(() => {
    if (!toMargin || openBlock === null) return;
    // The column took the press: the focus goes to the card (a DOM write), and the block is closed again. A card that
    // could not take it (the reader narrowed meanwhile) leaves the sheet to say it all.
    if (marginRef.current?.focus(cardKeys(group))) closeBlock();
    else openBlockAt(openBlock, true);
  }, [toMargin, openBlock, group, marginRef, closeBlock, openBlockAt]);
  return openBlock !== null && current && decided.sheet && hasAnnotations(group);
}

/**
 * A note's wavy words clicked (`useInlineNoteAnchors`): its card beside the text, where the column is shown; else the
 * sheet of the block its words are in, everything of it (a text drawn with no sign has none: nothing opens).
 */
export function useNoteOpener(
  marginRef: RefObject<AnnotationMarginHandle | null>,
  openBlockAt: (index: number, all?: boolean) => void,
): (note: Annotation, anchorEl: HTMLElement) => void {
  return useCallback((note: Annotation, anchorEl: HTMLElement) => {
    if (marginRef.current?.focus([`note:${note.id}`])) return;
    const sign = anchorEl.closest('.vlx-b, .vlx-dec-para')?.querySelector<HTMLElement>(':scope > .vlx-sign');
    const index = Number(sign?.dataset.block);
    if (sign?.dataset.block !== undefined && Number.isInteger(index) && index >= 0) openBlockAt(index, true);
  }, [marginRef, openBlockAt]);
}
