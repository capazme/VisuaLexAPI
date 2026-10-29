/**
 * The lesson's format (courses spec §10.3), read by the web's own parser: a closed subset of Markdown — paragraphs,
 * `###` headings, one level of `-` and `1.` lists, `>` quotes, `**bold**`, `*italic*`, and citation links `[testo](#c1)`.
 * The server refuses anything else on the way in (`apps/server/src/lingo/courseFormat.ts`); here whatever is not the
 * subset stays text, which React escapes: the lesson is written from material the user did not write, so nothing of it
 * is ever HTML (no `dangerouslySetInnerHTML`, stored XSS). Root rule 23 does not apply: a lesson is not `article_text`,
 * and its highlights stay in the session.
 *
 * A highlight counts characters in the block's plain text: every text leaf in reading order, nothing between them
 * (`plainText`). The renderer gives each leaf its offset, so a selection maps back to offsets and a highlight to leaves.
 */

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

/** A line's inline content: citations first (their text may be bold or italic), then emphasis around them. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest.length > 0) {
    const cite = CITE.exec(rest);
    if (!cite) {
      out.push(...emphasis(rest));
      break;
    }
    if (cite.index > 0) out.push(...emphasis(rest.slice(0, cite.index)));
    out.push({ kind: 'cite', marker: cite[2], children: emphasis(cite[1]) });
    rest = rest.slice(cite.index + cite[0].length);
  }
  return out.filter((node) => node.kind !== 'text' || node.text !== '');
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

/** A highlight: `[start, end)` in the block's plain text. */
export type Span = readonly [number, number];

/** Adds a highlight, merged with any it touches or overlaps: one colour, so two that meet are one. */
export function addSpan(spans: readonly Span[], added: Span): Span[] {
  let [start, end] = added;
  if (end <= start) return [...spans];
  const kept: Span[] = [];
  for (const [s, e] of spans) {
    if (e < start || s > end) kept.push([s, e]);
    else {
      start = Math.min(start, s);
      end = Math.max(end, e);
    }
  }
  return [...kept, [start, end] as Span].sort((a, b) => a[0] - b[0]);
}

/** Removes the highlight that starts at `start` («Togli»). */
export const removeSpan = (spans: readonly Span[], start: number): Span[] => spans.filter(([s]) => s !== start);

/** Pieces of the leaf `[from, from + text.length)`, each inside or outside a highlight; the highlight named by its start. */
export function splitLeaf(text: string, from: number, spans: readonly Span[]): { text: string; at: number; highlight: number | null }[] {
  const to = from + text.length;
  const cuts = new Set([from, to]);
  for (const [s, e] of spans) {
    if (s > from && s < to) cuts.add(s);
    if (e > from && e < to) cuts.add(e);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: { text: string; at: number; highlight: number | null }[] = [];
  for (let k = 0; k < points.length - 1; k += 1) {
    const [a, b] = [points[k], points[k + 1]];
    const span = spans.find(([s, e]) => s <= a && b <= e);
    out.push({ text: text.slice(a - from, b - from), at: a, highlight: span ? span[0] : null });
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
