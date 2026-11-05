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

/** The colours seen over `[start, end)`, a space aside: each character's innermost highlight's, null where none. */
function coloursSeen(plain: string, marks: readonly InkMark[], start: number, end: number): Set<HighlightColor | null> {
  const order = new Map(marks.map((m, i) => [m, i]));
  const seen = new Set<HighlightColor | null>();
  for (let i = start; i < end; i += 1) {
    if (/\s/.test(plain[i] ?? '')) continue;
    seen.add(innermost(marks.filter((m) => m.start <= i && i < m.end), order)?.color ?? null);
  }
  return seen;
}

/** Whether `[a, b)` and `[c, d)` overlap, touch, or are apart by spaces alone in `plain`. */
function meet(plain: string, a: number, b: number, c: number, d: number): boolean {
  if (a <= d && c <= b) return true;
  const gap = b < c ? plain.slice(b, c) : plain.slice(d, a);
  return /^\s+$/.test(gap);
}

/**
 * The plan's new highlights made one with what they meet in their colour: the parts that meet are joined, and each
 * highlight of the user's that a part meets, of its colour, not taken away already and not `whole`, is taken away and
 * joined to it. Until nothing more meets (a part grown may reach another).
 */
function joinSameColour(plain: string, marks: readonly InkMark[], remove: string[], add: InkPart[]): InkPart[] {
  let parts = add.map((part) => ({ ...part }));
  for (let changed = true; changed;) {
    changed = false;
    for (const part of parts) {
      for (const m of marks) {
        if (m.whole || m.color !== part.color || remove.includes(m.id) || !meet(plain, part.start, part.end, m.start, m.end)) continue;
        remove.push(m.id);
        part.start = Math.min(part.start, m.start);
        part.end = Math.max(part.end, m.end);
        // What the server holds of it beyond the words (its `note`) goes with the joined part.
        part.from ??= m.id;
        changed = true;
      }
    }
    const joined: InkPart[] = [];
    for (const part of [...parts].sort((x, y) => x.start - y.start)) {
      const into = joined.find((p) => p.color === part.color && meet(plain, p.start, p.end, part.start, part.end));
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
  return parts;
}

/** Whether every character of `[start, end)` but a space lies under one of `marks`. */
function coveredBy(plain: string, marks: readonly InkMark[], start: number, end: number): boolean {
  for (let i = start; i < end; i += 1) {
    if (/\s/.test(plain[i] ?? '')) continue;
    if (!marks.some((m) => m.start <= i && i < m.end)) return false;
  }
  return true;
}

export function planInk({ start, end, ink, marks, plain }: {
  start: number;
  end: number;
  ink: Ink;
  marks: readonly InkMark[];
  /** The projection the offsets count in: spaces decide what a selection passes over, and what meets. */
  plain: string;
}): InkPlan {
  if (end <= start) return NOTHING;
  const touching = marks.filter((m) => m.start < end && m.end > start);
  if (touching.length === 0 && ink === 'none') return NOTHING;

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
  const plan = (effect: 'removed' | 'recoloured' | 'created'): InkPlan => {
    const parts = joinSameColour(plain, marks, remove, add);
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
    const meetsInk = marks.some((m) => !m.whole && m.color === ink && meet(plain, only.start, only.end, m.start, m.end));
    if ((only.whole && only.start <= start && end <= only.end) || (!only.whole && only.start === start && only.end === end && !meetsInk)) {
      recolor.push({ id: only.id, color: ink });
      return plan('recoloured');
    }
  }
  // The ink over the whole selection: other colours give way where it passes (one that is never cut is recoloured
  // whole), and its own colour is one with it — or, lying under them all along, shows once they give way.
  for (const m of others) {
    if (m.whole) recolor.push({ id: m.id, color: ink });
    else cut(m);
  }
  if (!coveredBy(plain, same, start, end)) add.push({ start, end, color: ink });
  return plan(others.length > 0 ? 'recoloured' : 'created');
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
