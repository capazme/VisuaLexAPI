/**
 * What the highlighter does with a selection (A4, spec `2026-11-03-a4-highlighter-and-notes-design` §3): the word
 * processor's rules over the user's own highlights, as they land in the projection (`resolveAnchors`; root rule 23).
 * Pure: the reader turns a plan into the store's calls (`useHighlightInk`).
 *
 * | the selection…                         | ink X                                   | «Nessun colore»                 |
 * | touches no highlight                   | a new highlight X                       | nothing                         |
 * | lies inside, the innermost being X     | the piece out of every X that holds it  | the piece out of all it touches |
 * | lies inside, the innermost another     | the piece recoloured X                  | the piece out of all it touches |
 * | reaches out of what it touches         | a new highlight X (overlapping, as ever)| the piece out of all it touches |
 *
 * The colour seen at a point is the innermost highlight's, in the renderer's own nesting (`articleRender.ts`, `byNesting`):
 * the one that starts last, then the one that ends first, then the later one.
 */
import type { HighlightColor } from './highlightColors';

/** What the highlighter lays down: a colour, or «Nessun colore», which takes highlights away. */
export type Ink = HighlightColor | 'none';

/**
 * A highlight of the user's where it lands, `[start, end)` in the projection. `whole`: it is never cut, only removed or
 * recoloured in place — one taken from the Forum keeps its first author, which a new highlight cannot carry (gotcha 21);
 * one saved before offsets existed has none to cut at.
 */
export interface InkMark {
  id: string;
  start: number;
  end: number;
  color: HighlightColor;
  whole: boolean;
}

/** A highlight to create: a part left outside the selection by a cut (`from` its highlight), or a piece recoloured. */
export interface InkPart {
  start: number;
  end: number;
  color: HighlightColor;
  from?: string;
}

export type InkPlan =
  | { kind: 'nothing' }
  | { kind: 'create'; color: HighlightColor }
  | {
      kind: 'edit';
      /** What the user is told: highlights taken away, or the words given another colour (`color`). */
      effect: 'removed' | 'recoloured';
      color?: HighlightColor;
      remove: string[];
      recolor: { id: string; color: HighlightColor }[];
      add: InkPart[];
    };

const NOTHING: InkPlan = { kind: 'nothing' };

/**
 * The highlight drawn on top among those holding the selection, as the renderer nests them (`byNesting`): the one that
 * starts last, then the one that ends first, then the later in the list. Undefined for none.
 */
function innermost(holders: readonly InkMark[], order: ReadonlyMap<InkMark, number>): InkMark | undefined {
  return holders.reduce<InkMark | undefined>((top, m) => {
    if (!top) return m;
    const deeper = m.start - top.start || top.end - m.end || (order.get(m) ?? 0) - (order.get(top) ?? 0);
    return deeper > 0 ? m : top;
  }, undefined);
}

export function planInk({ start, end, ink, marks }: { start: number; end: number; ink: Ink; marks: readonly InkMark[] }): InkPlan {
  if (end <= start) return NOTHING;
  const touching = marks.filter((m) => m.start < end && m.end > start);
  if (touching.length === 0) return ink === 'none' ? NOTHING : { kind: 'create', color: ink };

  const remove: string[] = [];
  const recolor: { id: string; color: HighlightColor }[] = [];
  const add: InkPart[] = [];
  // The selection taken out of a highlight: the parts outside it stay, in its colour; one that cannot be cut goes whole.
  const cut = (m: InkMark) => {
    if (remove.includes(m.id)) return;
    remove.push(m.id);
    if (m.whole) return;
    if (start > m.start) add.push({ start: m.start, end: start, color: m.color, from: m.id });
    if (end < m.end) add.push({ start: end, end: m.end, color: m.color, from: m.id });
  };

  if (ink === 'none') {
    touching.forEach(cut);
    return { kind: 'edit', effect: 'removed', remove, recolor, add };
  }
  const holders = touching.filter((m) => m.start <= start && end <= m.end);
  // Reaching out of what it touches: a new highlight, as before.
  if (holders.length === 0) return { kind: 'create', color: ink };
  const order = new Map(marks.map((m, i) => [m, i]));
  const seen = innermost(holders, order)!;
  if (seen.color === ink) {
    holders.filter((m) => m.color === ink).forEach(cut);
    return { kind: 'edit', effect: 'removed', remove, recolor, add };
  }
  // Another colour seen: the piece takes the ink. The whole highlight selected, or one that cannot be cut, keeps its
  // id and is recoloured in place.
  if (seen.whole || (seen.start === start && seen.end === end)) {
    recolor.push({ id: seen.id, color: ink });
  } else {
    cut(seen);
    // The highlight drawn under it once it is cut shows the piece: when that one is already of the ink, no new one.
    if (innermost(holders.filter((m) => m !== seen), order)?.color !== ink) add.push({ start, end, color: ink });
  }
  return { kind: 'edit', effect: 'recoloured', color: ink, remove, recolor, add };
}

/**
 * The highlights a plan creates, as the store takes them: the projection's own words at each part, trimmed of
 * whitespace at their edges (the offset moved with them), a part of whitespace alone dropped.
 */
export function partsOf(plain: string, parts: readonly InkPart[]): { text: string; startOffset: number; color: HighlightColor; from?: string }[] {
  return parts.flatMap((part) => {
    const raw = plain.slice(part.start, part.end);
    const text = raw.trim();
    if (!text) return [];
    return [{ text, startOffset: part.start + (raw.length - raw.trimStart().length), color: part.color, ...(part.from ? { from: part.from } : {}) }];
  });
}
