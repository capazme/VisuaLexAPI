/**
 * Renders an article's text — its structure, the reader's highlights and
 * anchored notes, the Cmd+F hits — as HTML for `SafeHTML`.
 *
 * The contract (CLAUDE.md gotcha 23): the text nodes of the output spell
 * `article_text` with its newlines removed, character for character. Stored
 * anchors are offsets into exactly that projection, so nothing here may add a
 * visible character (labels come from CSS `content: attr(...)`), drop one, or
 * let the HTML parser swallow one (the source text is escaped).
 *
 * How: every mark — structure decoration, printed enumerator, highlight, note
 * anchor, search hit — is a raw range. The text is cut at every block edge and
 * every mark edge, and each run is emitted inside the marks that cover it,
 * opened in a fixed nesting order with a stack that keeps the common prefix
 * open from one run to the next. The result is always well-formed: a mark that
 * crosses a block is split per block, two overlapping highlights both show.
 *
 * `structure === null` is the flat mode used by the Brocardi sections: no
 * block wrappers, and every newline is a `<br />`, as before.
 */
import type { Annotation, Highlight } from '../types';
import { HIGHLIGHT_STYLES } from './highlightColors';
import type { ArticleStructure, DecorationKind, StructureBlock } from './articleStructure';

export interface RenderArticleInput {
  raw: string;
  /** Parsed structure; null renders flat (Brocardi sections). */
  structure: ArticleStructure | null;
  highlights: Highlight[];
  annotations: Annotation[];
  searchQuery?: string | null;
}

type MarkKind = 'marker' | DecorationKind | 'note' | 'highlight' | 'search';

/** Nesting order, outermost first. */
const RANK: Record<MarkKind, number> = {
  marker: 0,
  ref: 1,
  'ref-missing': 1,
  mod: 2,
  notice: 3,
  note: 4,
  highlight: 5,
  search: 6,
  'mod-paren': 7,
  'rubric-paren': 7,
  hidden: 8,
};

interface Mark {
  start: number;
  end: number;
  kind: MarkKind;
  open: string;
  close: string;
  seq: number;
}

const escapeAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const NOTE_ANCHOR_STYLE =
  'text-decoration:underline wavy hsl(var(--hl-yellow-fg));text-decoration-thickness:2px;text-underline-offset:3px;cursor:help;';

function decorationOpen(kind: DecorationKind, noteId?: string): string {
  switch (kind) {
    case 'mod':
      return '<span class="vlx-mod" title="Parte modificata da un atto successivo">';
    case 'mod-paren':
    case 'rubric-paren':
      return '<span class="vlx-paren">';
    case 'notice':
      return '<span class="vlx-notice">';
    case 'hidden':
      return '<span class="vlx-hidden">';
    case 'ref': {
      const id = escapeAttr(noteId ?? '');
      return `<span class="vlx-ref" role="button" tabindex="0" aria-haspopup="dialog" data-note="${id}" aria-label="Nota di aggiornamento ${id}">`;
    }
    case 'ref-missing':
      return '<span class="vlx-ref-missing" title="Nota non presente nel testo scaricato">';
  }
}

/**
 * Where a stored anchor ends, in plain-text offsets, or null when its text is
 * not at its offset. Exact (case-insensitive) first, as always. Then one
 * bounded rescue for anchors stored from a rendered selection, whose text
 * carries newlines the projection does not have: anchored at the same offset,
 * whitespace skipped on both sides, every other character equal.
 */
function anchorEnd(plain: string, start: number, text: string): number | null {
  if (!text || start < 0 || start >= plain.length) return null;
  const exact = plain.slice(start, start + text.length);
  if (exact.length === text.length && exact.toLowerCase() === text.toLowerCase()) return start + text.length;
  if (/\s/.test(plain[start])) return null;
  let i = start;
  let matched = 0;
  for (let j = 0; j < text.length; j++) {
    if (/\s/.test(text[j])) continue;
    while (i < plain.length && /\s/.test(plain[i])) i++;
    if (i >= plain.length || plain[i].toLowerCase() !== text[j].toLowerCase()) return null;
    i++;
    matched++;
  }
  return matched > 0 ? i : null;
}

export function renderArticleHtml(input: RenderArticleInput): string {
  const raw = input.raw || '';
  if (!raw) return '';

  // rawAt[p] = raw index of the p-th character of the projection (no '\n').
  const rawAt: number[] = [];
  for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) !== 10) rawAt.push(i);
  const plain = raw.replace(/\n/g, '');
  const plainLower = plain.toLowerCase();

  const marks: Mark[] = [];
  let seq = 0;
  const pushRaw = (start: number, end: number, kind: MarkKind, open: string, close: string) => {
    if (end > start) marks.push({ start, end, kind, open, close, seq: seq++ });
  };
  const pushPlain = (start: number, end: number, kind: MarkKind, open: string, close: string) => {
    if (start < 0 || end <= start || end > rawAt.length) return;
    pushRaw(rawAt[start], rawAt[end - 1] + 1, kind, open, close);
  };

  for (const h of input.highlights) {
    const author = h.originalAuthor?.username ?? (h.sourceSuggestionId ? 'utente-rimosso' : null);
    const title = author ? ` title="${escapeAttr(`Evidenziato da @${author}`)}"` : '';
    const style = HIGHLIGHT_STYLES[h.color] ?? HIGHLIGHT_STYLES.yellow;
    const open = `<mark style="${style}" data-highlight="${escapeAttr(h.id)}" class="highlight-mark"${title}>`;
    if (typeof h.startOffset === 'number' && h.startOffset >= 0) {
      const end = anchorEnd(plain, h.startOffset, h.text);
      if (end !== null) pushPlain(h.startOffset, end, 'highlight', open, '</mark>');
      continue;
    }
    // Saved before offsets existed: every occurrence, as it always rendered.
    const needle = h.text.toLowerCase();
    if (!needle) continue;
    for (let at = plainLower.indexOf(needle); at !== -1; at = plainLower.indexOf(needle, at + needle.length)) {
      pushPlain(at, at + needle.length, 'highlight', open, '</mark>');
    }
  }

  for (const a of input.annotations) {
    if (typeof a.startOffset !== 'number' || a.startOffset < 0 || !a.anchorText) continue;
    const end = anchorEnd(plain, a.startOffset, a.anchorText);
    if (end === null) continue;
    pushPlain(
      a.startOffset,
      end,
      'note',
      `<span class="note-anchor" data-note-id="${escapeAttr(a.id)}" title="${escapeAttr(a.text)}" style="${NOTE_ANCHOR_STYLE}">`,
      '</span>',
    );
  }

  const query = input.searchQuery;
  if (query && query.length >= 2) {
    const needle = query.toLowerCase();
    let ordinal = 0;
    for (let at = plainLower.indexOf(needle); at !== -1; at = plainLower.indexOf(needle, at + 1)) {
      pushPlain(at, at + needle.length, 'search', `<mark class="search-match" data-search-idx="${ordinal++}">`, '</mark>');
    }
  }

  const structure = input.structure;
  if (!structure) return renderSpan(raw, 0, raw.length, marks, true);

  for (const d of structure.decorations) pushRaw(d.start, d.end, d.kind, decorationOpen(d.kind, d.noteId), '</span>');
  return renderBlocks(raw, structure, marks);
}

function renderBlocks(raw: string, structure: ArticleStructure, marks: Mark[]): string {
  const parts: string[] = [];
  const tail = structure.updates;
  let inTail = false;
  for (const block of structure.blocks) {
    if (tail && !inTail && block.start >= tail.start) {
      inTail = true;
      // Folded by CSS through a class on the container (useArticleTextInteractions),
      // so opening the notes never re-renders this HTML; the toggle's label is
      // CSS-generated, never a text node.
      const label = `Note di aggiornamento (${Object.keys(structure.notes).length})`;
      parts.push(
        '<div class="vlx-updates">' +
          `<span class="vlx-updates-toggle" role="button" tabindex="0" aria-expanded="false" aria-label="${label}" data-label="${label}"></span>` +
          '<div class="vlx-updates-body">',
      );
    }
    const blockMarks = marks.filter((m) => m.start < block.end && m.end > block.start);
    if (block.marker) {
      blockMarks.push({
        start: block.marker.start,
        end: block.marker.end,
        kind: 'marker',
        open: '<span class="vlx-marker">',
        close: '</span>',
        seq: -1,
      });
    }
    parts.push(`<div class="${blockClass(block)}"${blockAttributes(block)}>`);
    parts.push(renderSpan(raw, block.start, block.end, blockMarks, false));
    parts.push('</div>');
  }
  if (inTail) parts.push('</div></div>');
  return parts.join('');
}

const blockClass = (b: StructureBlock): string => `vlx-b vlx-${b.kind}${b.marker ? ' vlx-has-marker' : ''}`;

const blockAttributes = (b: StructureBlock): string =>
  (b.level ? ` data-level="${b.level}"` : '') + (b.noteId ? ` data-note-head="${escapeAttr(b.noteId)}"` : '');

const byNesting = (x: Mark, y: Mark): number =>
  RANK[x.kind] - RANK[y.kind] || x.start - y.start || y.end - x.end || x.seq - y.seq;

/**
 * Emits raw[start, end) with its marks. In a block (`flat === false`) a
 * newline renders only between two visible characters; on an edge it is
 * dropped — the block boundary already breaks the line.
 */
function renderSpan(raw: string, start: number, end: number, marks: Mark[], flat: boolean): string {
  const local = marks.filter((m) => m.start < end && m.end > start);
  const cuts = new Set<number>([start, end]);
  for (const m of local) {
    cuts.add(Math.max(m.start, start));
    cuts.add(Math.min(m.end, end));
  }
  const points = [...cuts].sort((a, b) => a - b);

  let firstVisible = end;
  let lastVisible = start - 1;
  if (!flat) {
    for (let k = start; k < end; k++) {
      if (!/\s/.test(raw[k])) {
        firstVisible = k;
        break;
      }
    }
    for (let k = end - 1; k >= start; k--) {
      if (!/\s/.test(raw[k])) {
        lastVisible = k;
        break;
      }
    }
  }

  let out = '';
  const stack: Mark[] = [];
  for (let p = 0; p + 1 < points.length; p++) {
    const a = points[p];
    const b = points[p + 1];
    let text = '';
    for (let k = a; k < b; k++) {
      const c = raw[k];
      if (c === '\n') {
        if (flat || (k > firstVisible && k < lastVisible)) text += '<br />';
      } else if (c === '&') text += '&amp;';
      else if (c === '<') text += '&lt;';
      else if (c === '>') text += '&gt;';
      else text += c;
    }
    if (!text) continue;
    const active = local.filter((m) => m.start <= a && m.end >= b).sort(byNesting);
    let keep = 0;
    while (keep < stack.length && keep < active.length && stack[keep] === active[keep]) keep++;
    for (let q = stack.length - 1; q >= keep; q--) out += stack[q].close;
    stack.length = keep;
    for (let q = keep; q < active.length; q++) {
      out += active[q].open;
      stack.push(active[q]);
    }
    out += text;
  }
  for (let q = stack.length - 1; q >= 0; q--) out += stack[q].close;
  return out;
}
