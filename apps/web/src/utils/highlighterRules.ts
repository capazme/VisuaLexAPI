/**
 * What the highlighter does with a selection (A4, spec `2026-11-03-a4-highlighter-and-notes-design` §3 and §7): the word
 * processor's rules over the user's own highlights, as they land in the projection (`resolveAnchors`; root rule 23).
 * Pure: the reader turns a plan into the store's calls (`useHighlightInk`).
 *
 * The owner's rules (5 November 2026: «sovrascrive altri colori se presenti e non cancella il resto, se ripassa sopra lo
 * stesso colore soltanto, cancella»):
 *
 * | the selection passes over…                       | ink X                                                 |
 * | the colour X alone (spaces aside)                | X taken away where it passes, the rest kept           |
 * | anything else: plain words, other colours, mixed | X over the whole selection: other colours give way    |
 * |                                                  | where it passes, the rest of them kept as they were   |
 * | nothing                                          | a new highlight X                                     |
 * «Nessun colore» takes every highlight away where it passes, and over plain words does nothing. The colour a selection
 * passes over is the one seen, the innermost highlight's in the renderer's own nesting (`articleRender.ts`, `byNesting`:
 * the one that starts last, then the one that ends first, then the later one): yellow passed over a green highlight
 * lying on a yellow one is passed over green.
 *
 * Two highlights of one colour never overlap: what a gesture lays down in a colour — a new highlight, a piece recoloured,
 * the parts a cut leaves — is one with the highlights of that colour it overlaps or meets, across nothing but spaces;
 * so highlighting the words beside a highlight lengthens it, and the parts several highlights of one colour leave are
 * one each side (the duplicates the old rules made, the owner's local test, 5 November). A highlight that is never cut
 * (`whole`) is never joined either: recoloured, it keeps its place and its id.
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
      /** What the gesture did: highlights taken away, the words given another colour, or highlighted (`color`). */
      effect: 'removed' | 'recoloured' | 'created';
      color?: HighlightColor;
      remove: string[];
      recolor: { id: string; color: HighlightColor }[];
      add: InkPart[];
    };

const NOTHING: InkPlan = { kind: 'nothing' };

/**
 * The highlight drawn on top among `holders`, as the renderer nests them (`byNesting`): the one that starts last, then
 * the one that ends first, then the later in the list. Undefined for none.
 */
function innermost(holders: readonly InkMark[], order: ReadonlyMap<InkMark, number>): InkMark | undefined {
  return holders.reduce<InkMark | undefined>((top, m) => {
    if (!top) return m;
    const deeper = m.start - top.start || top.end - m.end || (order.get(m) ?? 0) - (order.get(top) ?? 0);
    return deeper > 0 ? m : top;
  }, undefined);
}

/** Spaces and punctuation: what a selection passes over without passing over a colour («danno,» over «danno» alone). */
const ASIDE = /[\s\p{P}]/u;

/** Whether `plain.slice(from, to)` has a character that is neither a space nor punctuation. */
const hasWords = (plain: string, from: number, to: number) => {
  for (let i = from; i < to; i += 1) if (!ASIDE.test(plain[i] ?? '')) return true;
  return false;
};

/**
 * The colours seen over `[start, end)`, spaces and punctuation aside: on each stretch between two highlights' edges, the
 * innermost highlight's colour, null where none.
 */
function coloursSeen(plain: string, marks: readonly InkMark[], start: number, end: number): Set<HighlightColor | null> {
  const order = new Map(marks.map((m, i) => [m, i]));
  const edges = [...new Set([start, end, ...marks.flatMap((m) => [m.start, m.end]).filter((e) => e > start && e < end)])].sort((a, b) => a - b);
  const seen = new Set<HighlightColor | null>();
  for (let k = 0; k + 1 < edges.length; k += 1) {
    const [from, to] = [edges[k], edges[k + 1]];
    if (!hasWords(plain, from, to)) continue;
    seen.add(innermost(marks.filter((m) => m.start <= from && to <= m.end), order)?.color ?? null);
  }
  return seen;
}

/**
 * Whether `[a, b)` and `[c, d)` are to be one in a colour: they overlap, or touch or are apart by spaces alone in
 * `plain` with no block's start between them (`breaks`: a comma, a paragraph — two highlights there stay two, each under
 * its own block's sign).
 */
export function meet(plain: string, breaks: readonly number[], a: number, b: number, c: number, d: number): boolean {
  if (a < d && c < b) return true;
  const [from, to] = b <= c ? [b, c] : [d, a];
  if (to < from || breaks.some((k) => k >= from && k <= to)) return false;
  return from === to || /^\s+$/.test(plain.slice(from, to));
}

/** `part` with the stretches `holes` cover taken out: what is left of it, in order. */
function without(part: InkPart, holes: readonly { start: number; end: number }[]): InkPart[] {
  let left = [part];
  for (const hole of holes) {
    left = left.flatMap((p) => (hole.end <= p.start || hole.start >= p.end
      ? [p]
      : [
          ...(p.start < hole.start ? [{ ...p, end: hole.start }] : []),
          ...(hole.end < p.end ? [{ ...p, start: hole.end }] : []),
        ]));
  }
  return left;
}

/**
 * The plan's new highlights made one with what they meet in their colour: the parts that meet are joined, and each
 * highlight of the user's that a part meets, of its colour, not taken away already and not `whole`, is taken away (into
 * `removed`) and joined to it, until nothing more meets. A `whole` highlight of the colour (one from the Forum, never
 * cut nor joined) keeps its words: the parts leave them to it, so one colour never lies twice on a word.
 */
function joinSameColour(
  plain: string,
  breaks: readonly number[],
  marks: readonly InkMark[],
  removed: Set<string>,
  recolored: ReadonlyMap<string, HighlightColor>,
  add: readonly InkPart[],
): InkPart[] {
  const byStart = [...marks].sort((x, y) => x.start - y.start);
  let parts = add.map((part) => ({ ...part }));
  for (let changed = true; changed;) {
    changed = false;
    for (const part of parts) {
      // Both ways along the text, so a row of highlights that meet is taken in one pass.
      for (const m of [...byStart, ...[...byStart].reverse()]) {
        if (m.whole || m.color !== part.color || removed.has(m.id) || !meet(plain, breaks, part.start, part.end, m.start, m.end)) continue;
        removed.add(m.id);
        part.start = Math.min(part.start, m.start);
        part.end = Math.max(part.end, m.end);
        // What the server holds of it beyond the words (its `note`) goes with the joined part.
        part.from ??= m.id;
        changed = true;
      }
    }
    const joined: InkPart[] = [];
    for (const part of [...parts].sort((x, y) => x.start - y.start)) {
      const into = joined.find((p) => p.color === part.color && meet(plain, breaks, p.start, p.end, part.start, part.end));
      if (into) {
        into.start = Math.min(into.start, part.start);
        into.end = Math.max(into.end, part.end);
        changed = true;
      } else {
        joined.push(part);
      }
    }
    parts = joined;
  }
  return parts.flatMap((part) => without(part, marks.filter((m) => m.whole && !removed.has(m.id) && (recolored.get(m.id) ?? m.color) === part.color)));
}

/** Whether every character of `[start, end)` but spaces and punctuation lies under one of `marks`. */
function coveredBy(plain: string, marks: readonly InkMark[], start: number, end: number): boolean {
  for (let i = start; i < end; i += 1) {
    if (ASIDE.test(plain[i] ?? '')) continue;
    if (!marks.some((m) => m.start <= i && i < m.end)) return false;
  }
  return true;
}

export function planInk({ start, end, ink, marks, plain, breaks = [] }: {
  start: number;
  end: number;
  ink: Ink;
  marks: readonly InkMark[];
  /** The projection the offsets count in: spaces and punctuation decide what a selection passes over, and what meets. */
  plain: string;
  /** Where each block after the first starts in `plain` (a comma, a paragraph): one colour is never joined across one. */
  breaks?: readonly number[];
}): InkPlan {
  if (end <= start) return NOTHING;
  const touching = marks.filter((m) => m.start < end && m.end > start);
  if (touching.length === 0 && ink === 'none') return NOTHING;

  const removed = new Set<string>();
  const recolor: { id: string; color: HighlightColor }[] = [];
  const add: InkPart[] = [];
  // The selection taken out of a highlight: the parts outside it stay, in its colour; one that cannot be cut goes whole.
  const cut = (m: InkMark) => {
    if (removed.has(m.id)) return;
    removed.add(m.id);
    if (m.whole) return;
    if (start > m.start) add.push({ start: m.start, end: start, color: m.color, from: m.id });
    if (end < m.end) add.push({ start: end, end: m.end, color: m.color, from: m.id });
  };
  const plan = (effect: 'removed' | 'recoloured' | 'created'): InkPlan => {
    const parts = joinSameColour(plain, breaks, marks, removed, new Map(recolor.map((r) => [r.id, r.color])), add);
    const remove = [...removed];
    // A new highlight alone, joined to nothing: the plain creation (the article's MERL-T event goes with it).
    if (effect === 'created' && remove.length === 0 && recolor.length === 0 && parts.length === 1 && parts[0].start === start && parts[0].end === end) {
      return { kind: 'create', color: parts[0].color };
    }
    return { kind: 'edit', effect, ...(effect !== 'removed' && ink !== 'none' ? { color: ink } : {}), remove, recolor, add: parts };
  };

  if (ink === 'none') {
    touching.forEach(cut);
    return plan('removed');
  }
  const same = touching.filter((m) => m.color === ink);
  const others = touching.filter((m) => m.color !== ink);
  // Over its own colour alone: taken away where the selection passes, from every highlight of it there (one under
  // another of its colour too), so the words no longer show it.
  const seen = coloursSeen(plain, touching, start, end);
  if (seen.size === 1 && seen.has(ink)) {
    same.forEach(cut);
    return plan('removed');
  }
  // One highlight of another colour, selected whole, meeting nothing of the ink: recoloured in place, its id kept. So is
  // one that is never cut and holds the selection (one from the Forum keeps its first author, gotcha 21).
  if (same.length === 0 && others.length === 1) {
    const [only] = others;
    const meetsInk = marks.some((m) => !m.whole && m.color === ink && meet(plain, breaks, only.start, only.end, m.start, m.end));
    if ((only.whole && only.start <= start && end <= only.end) || (!only.whole && only.start === start && only.end === end && !meetsInk)) {
      recolor.push({ id: only.id, color: ink });
      return plan('recoloured');
    }
  }
  // The ink over the whole selection: other colours give way where it passes (one that is never cut is recoloured
  // whole), and its own colour is one with it — or, lying under them all along, shows once they give way. Over plain
  // words too, it is words highlighted.
  for (const m of others) {
    if (m.whole) recolor.push({ id: m.id, color: ink });
    else cut(m);
  }
  if (!coveredBy(plain, same, start, end)) add.push({ start, end, color: ink });
  return plan(others.length > 0 && !seen.has(null) ? 'recoloured' : 'created');
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
