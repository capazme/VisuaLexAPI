/**
 * The lesson's format (courses spec §10.3), read by the web's own parser: a closed subset of Markdown — paragraphs,
 * `###` headings, one level of `-` and `1.` lists, `>` quotes, `**bold**`, `*italic*`, and citation links `[testo](#c1)`.
 * The server refuses anything else on the way in (`apps/server/src/lingo/courseFormat.ts`); here whatever is not the
 * subset stays text, which React escapes: the lesson is written from material the user did not write, so nothing of it
 * is ever HTML written from a string (stored XSS). Root rule 23 does not apply: a lesson is not `article_text`,
 * and its highlights stay in the session.
 *
 * A highlight counts characters in the block's plain text: every text leaf in reading order, nothing between them
 * (`plainText`). The renderer gives each leaf its offset, so a selection maps back to offsets and a highlight to leaves.
 */

import type { HighlightColor } from '../../../../utils/highlightColors';

export type Inline =
  /** `at`: the leaf's offset in the block's plain text, once `numberLeaves` has counted it. */
  | { kind: 'text'; text: string; at?: number }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  /** `[testo](#c1)`: `marker` is `c1`. */
  | { kind: 'cite'; marker: string; children: Inline[] };

export type LessonNode =
  | { kind: 'p'; inline: Inline[] }
  | { kind: 'h3'; inline: Inline[] }
  | { kind: 'ul'; items: Inline[][] }
  | { kind: 'ol'; start: number; items: Inline[][] }
  | { kind: 'quote'; paragraphs: Inline[][] };

const HEADING = /^### (.*)$/;
const BULLET = /^- (.*)$/;
const NUMBERED = /^(\d{1,3})\. (.*)$/;
const QUOTE = /^>\s?(.*)$/;
/** A citation as the server admits it: `[testo](#c1)` … `#c60`, its text on one line. */
const CITE = /\[([^\]\n]+)\]\(#(c[1-9][0-9]?)\)/;

/** Bold before italic, so that `**x**` is never read as two empty italics. Unclosed marks stay as text. */
function emphasis(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest.length > 0) {
    const bold = /\*\*(?=\S)([\s\S]*?\S)\*\*/.exec(rest);
    const italic = /\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)/.exec(rest);
    const next = [bold, italic].filter((m): m is RegExpExecArray => m !== null).sort((a, b) => a.index - b.index || b[0].length - a[0].length)[0];
    if (!next) {
      out.push({ kind: 'text', text: rest });
      break;
    }
    if (next.index > 0) out.push({ kind: 'text', text: rest.slice(0, next.index) });
    out.push(next === bold ? { kind: 'strong', children: emphasis(next[1]) } : { kind: 'em', children: emphasis(next[1]) });
    rest = rest.slice(next.index + next[0].length);
  }
  return out;
}

/** Where a citation stood while emphasis is read around it: two private-use characters around its index. */
const HOLD = /\uE000(\d+)\uE001/;

/**
 * A line's inline content. Citations are taken out first (their text may be bold or italic, `[**art. 7**](#c1)`), held
 * by a placeholder while emphasis is read over the whole line (so `**si veda [l'art. 7](#c1).**` is bold around the
 * citation), then put back in the text leaves. A line that already holds the placeholders' characters is read with
 * citations and emphasis apart, its emphasis never across a citation.
 */
export function parseInline(text: string): Inline[] {
  const clean = (nodes: Inline[]) => nodes.filter((node) => node.kind !== 'text' || node.text !== '');
  const cites: { marker: string; label: string }[] = [];
  const global = new RegExp(CITE.source, 'g');
  if (/[\uE000\uE001]/.test(text)) {
    const out: Inline[] = [];
    let last = 0;
    for (const m of text.matchAll(global)) {
      out.push(...emphasis(text.slice(last, m.index)), { kind: 'cite', marker: m[2], children: emphasis(m[1]) });
      last = m.index + m[0].length;
    }
    out.push(...emphasis(text.slice(last)));
    return clean(out);
  }
  const held = text.replace(global, (_, label: string, marker: string) => `\uE000${cites.push({ marker, label }) - 1}\uE001`);
  const restore = (nodes: Inline[]): Inline[] =>
    nodes.flatMap((node): Inline[] => {
      if (node.kind !== 'text') return [{ ...node, children: restore(node.children) }];
      const out: Inline[] = [];
      let rest = node.text;
      for (let m = HOLD.exec(rest); m; m = HOLD.exec(rest)) {
        const cite = cites[Number(m[1])];
        out.push({ kind: 'text', text: rest.slice(0, m.index) }, { kind: 'cite', marker: cite.marker, children: emphasis(cite.label) });
        rest = rest.slice(m.index + m[0].length);
      }
      out.push({ kind: 'text', text: rest });
      return clean(out);
    });
  return restore(emphasis(held));
}

/** A block's text as nodes. Lines of one paragraph are joined by a space, as Markdown reads a soft break. */
export function parseLesson(text: string): LessonNode[] {
  const nodes: LessonNode[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  const run = (match: (line: string) => RegExpExecArray | null) => {
    const found: RegExpExecArray[] = [];
    while (i < lines.length) {
      const m = match(lines[i]);
      if (!m) break;
      found.push(m);
      i += 1;
    }
    return found;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      nodes.push({ kind: 'h3', inline: parseInline(heading[1].trim()) });
      i += 1;
      continue;
    }
    if (BULLET.test(line)) {
      nodes.push({ kind: 'ul', items: run((l) => BULLET.exec(l)).map((m) => parseInline(m[1].trim())) });
      continue;
    }
    if (NUMBERED.test(line)) {
      const items = run((l) => NUMBERED.exec(l));
      nodes.push({ kind: 'ol', start: Number(items[0][1]), items: items.map((m) => parseInline(m[2].trim())) });
      continue;
    }
    if (QUOTE.test(line)) {
      // An empty `>` line splits the quote's paragraphs.
      const paragraphs: string[][] = [[]];
      for (const m of run((l) => QUOTE.exec(l))) {
        const content = m[1].trim();
        if (content === '') paragraphs.push([]);
        else paragraphs[paragraphs.length - 1].push(content);
      }
      nodes.push({ kind: 'quote', paragraphs: paragraphs.filter((p) => p.length > 0).map((p) => parseInline(p.join(' '))) });
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !HEADING.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i]) && !QUOTE.test(lines[i])) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    nodes.push({ kind: 'p', inline: parseInline(paragraph.join(' ')) });
  }
  return nodes;
}

/** Every text leaf of the nodes, in reading order. */
export function leaves(nodes: LessonNode[]): string[] {
  const out: string[] = [];
  const walk = (inline: Inline[]) => {
    for (const node of inline) {
      if (node.kind === 'text') out.push(node.text);
      else walk(node.children);
    }
  };
  for (const node of nodes) {
    if (node.kind === 'p' || node.kind === 'h3') walk(node.inline);
    else if (node.kind === 'quote') node.paragraphs.forEach(walk);
    else node.items.forEach(walk);
  }
  return out;
}

/** The nodes with each text leaf's offset in the plain text (`at`), counted in reading order: what the renderer draws. */
export function numberLeaves(nodes: LessonNode[]): LessonNode[] {
  let cursor = 0;
  const walk = (inline: Inline[]): Inline[] =>
    inline.map((node) => {
      if (node.kind !== 'text') return { ...node, children: walk(node.children) };
      const at = cursor;
      cursor += node.text.length;
      return { ...node, at };
    });
  return nodes.map((node) => {
    if (node.kind === 'p' || node.kind === 'h3') return { ...node, inline: walk(node.inline) };
    if (node.kind === 'quote') return { ...node, paragraphs: node.paragraphs.map(walk) };
    return { ...node, items: node.items.map(walk) };
  });
}

/** The block's plain text, which highlights count in: the leaves joined with nothing between them. */
export const plainText = (nodes: LessonNode[]) => leaves(nodes).join('');

/** The citation markers the text uses, in order of first use. */
export function citedMarkers(nodes: LessonNode[]): string[] {
  const out: string[] = [];
  const walk = (inline: Inline[]) => {
    for (const node of inline) {
      if (node.kind === 'cite' && !out.includes(node.marker)) out.push(node.marker);
      if (node.kind !== 'text') walk(node.children);
    }
  };
  for (const node of nodes) {
    if (node.kind === 'p' || node.kind === 'h3') walk(node.inline);
    else if (node.kind === 'quote') node.paragraphs.forEach(walk);
    else node.items.forEach(walk);
  }
  return out;
}

/**
 * A highlight: `[start, end)` in the block's plain text, and its colour (A4). One saved before the lessons took colours
 * has none, and is yellow.
 */
export type Span = readonly [number, number, HighlightColor?];

export const spanColor = (span: Span): HighlightColor => span[2] ?? 'yellow';

/**
 * The highlighter over a block (A4, spec `2026-11-03-a4-highlighter-and-notes-design` §4): the reader's rules
 * (`planInk`) in the lesson's own form, where highlights never overlap and a colour paints over what it covers. Words
 * inside one highlight of the ink, or under «Nessun colore», are taken out of what they touch (the parts outside stay);
 * any other colour paints them. Highlights of one colour that meet are one.
 */
export function paintSpans(spans: readonly Span[], [start, end]: readonly [number, number], ink: HighlightColor | 'none'): Span[] {
  if (end <= start) return [...spans];
  const holder = spans.find(([s, e]) => s <= start && end <= e);
  const erase = ink === 'none' || (holder !== undefined && spanColor(holder) === ink);
  const kept: [number, number, HighlightColor][] = [];
  for (const span of spans) {
    const [s, e] = span;
    const color = spanColor(span);
    if (e <= start || s >= end) kept.push([s, e, color]);
    else {
      if (s < start) kept.push([s, start, color]);
      if (e > end) kept.push([end, e, color]);
    }
  }
  if (!erase) kept.push([start, end, ink as HighlightColor]);
  kept.sort((a, b) => a[0] - b[0]);
  const out: [number, number, HighlightColor][] = [];
  for (const span of kept) {
    const last = out.at(-1);
    if (last && last[2] === span[2] && last[1] >= span[0]) last[1] = Math.max(last[1], span[1]);
    else out.push(span);
  }
  return out;
}

/**
 * Pieces of the leaf `[from, from + text.length)`, each inside or outside a highlight; the highlight named by its start,
 * with its colour.
 */
export function splitLeaf(
  text: string,
  from: number,
  spans: readonly Span[],
): { text: string; at: number; highlight: number | null; color: HighlightColor | null }[] {
  const to = from + text.length;
  const cuts = new Set([from, to]);
  for (const [s, e] of spans) {
    if (s > from && s < to) cuts.add(s);
    if (e > from && e < to) cuts.add(e);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: { text: string; at: number; highlight: number | null; color: HighlightColor | null }[] = [];
  for (let k = 0; k < points.length - 1; k += 1) {
    const [a, b] = [points[k], points[k + 1]];
    const span = spans.find(([s, e]) => s <= a && b <= e);
    out.push({ text: text.slice(a - from, b - from), at: a, highlight: span ? span[0] : null, color: span ? spanColor(span) : null });
  }
  return out;
}

/** Words per minute a study reading is guessed at: a block of about 1,200 words takes 10–15 minutes (§5, step 2). */
export const STUDY_WORDS_PER_MINUTE = 100;

/**
 * A block's indicative minutes (§5, step 2): its share of the module's estimate by words when the module has one, else
 * its words at a study pace; at least 1. An estimate, never a timer.
 */
export function blockMinutes(parole: number, moduleWords: number, moduleMinutes: number | null): number {
  if (moduleMinutes !== null && moduleWords > 0) return Math.max(1, Math.round((moduleMinutes * parole) / moduleWords));
  return Math.max(1, Math.ceil(parole / STUDY_WORDS_PER_MINUTE));
}
