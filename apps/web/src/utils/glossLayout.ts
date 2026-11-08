/**
 * Where each card of the glosses' column goes (D8), as a word processor places its comments: at the height of its
 * passage, in the order of the text; a card that would overlap the one above is pushed down under it. Pure: the column
 * measures, this decides.
 */

export interface GlossSlot {
  id: string;
  /** The top of its passage's first line, from the column's top (px). */
  want: number;
  /** The card's own height (px); 0 before it was measured. */
  height: number;
}

/** The space between two cards that touch. */
export const GLOSS_GAP = 8;

/** Each card's top, in the slots' order (the caller gives them in the order of the text), and the column's height. */
export function placeGlossCards(slots: readonly GlossSlot[], gap = GLOSS_GAP): { tops: Record<string, number>; height: number } {
  const tops: Record<string, number> = {};
  let floor = 0;
  for (const slot of slots) {
    const top = Math.max(Math.round(Math.max(0, slot.want)), floor);
    tops[slot.id] = top;
    floor = top + slot.height + gap;
  }
  return { tops, height: slots.length ? floor - gap : 0 };
}
