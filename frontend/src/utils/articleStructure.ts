/**
 * The structure of an article's text — read, never rewritten.
 *
 * `article_text` is the offset space of every stored highlight and note
 * (CLAUDE.md gotcha 23): the reading surface may not add, drop or change one
 * visible character. What it may decide is the *element* each character sits
 * in. This module finds those elements — the heading, the rubric, the commi,
 * their items, Normattiva's ((modifications)), the "(119)" references and the
 * AGGIORNAMENTO notes they point to — as raw ranges over the untouched
 * string. `articleRender.ts` turns the ranges into HTML.
 *
 * The blocks partition the text: every character belongs to exactly one
 * block. Anything the parser cannot place becomes a plain comma, and it never
 * throws — the worst case is today's rendering with more air, never lost
 * text. The shapes it reads were all taken from real texts; see
 * docs/superpowers/specs/2026-09-25-lettura-testo-design.md and the fixtures
 * in `__fixtures__/articleTexts.ts`.
 */
import { ARTICLE_SUFFIX_ALTERNATION } from './articleSuffixes';

export interface TextRange {
  start: number;
  end: number;
}

export type BlockKind =
  | 'heading'
  | 'rubrica'
  | 'comma'
  | 'item'
  | 'update-sep'
  | 'update-head'
  | 'update-para';

export interface StructureBlock extends TextRange {
  kind: BlockKind;
  /** The enumerator the source prints ("1.", "a)", "1°", "((1-bis.") and the spaces after it. */
  marker?: TextRange;
  /** Items only: 1 directly under a comma, 2 inside a list of another style. */
  level?: 1 | 2;
  /** update-head only: the note id ("119", "129a"). */
  noteId?: string;
}

export type DecorationKind =
  | 'mod'
  | 'mod-paren'
  | 'notice'
  | 'ref'
  | 'ref-missing'
  | 'rubric-paren'
  | 'hidden';

export interface InlineDecoration extends TextRange {
  kind: DecorationKind;
  /** ref / ref-missing only. */
  noteId?: string;
}

export interface UpdateNote {
  id: string;
  paragraphs: TextRange[];
}

export interface ArticleStructure {
  blocks: StructureBlock[];
  decorations: InlineDecoration[];
  /** AGGIORNAMENTO notes by id, read from the tail of the text. */
  notes: Record<string, UpdateNote>;
  /** The collapsible AGGIORNAMENTO tail, when the text has one. */
  updates: TextRange | null;
}

type Segment = Omit<StructureBlock, 'end'>;

const SUFFIX = ARTICLE_SUFFIX_ALTERNATION;
/** Horizontal whitespace. EUR-Lex pads with NBSP ("1.\xa0\xa0\xa0Il…", "Articolo\xa03"). */
const HWS = '[ \\t\\xa0]';
const isHws = (c: string | undefined): boolean => c === ' ' || c === '\t' || c === '\xa0';

const ARTICLE_NUMBER = `(?:\\d+(?:${HWS}*-?${HWS}*(?:${SUFFIX})\\b)?(?:\\.\\d+)?|unico)`;
/**
 * "Art. 1453.", "Articolo\xa03", "Art. 2-ter", "### Art. 3. (Rubrica)",
 * "Codice Penale-art. 524". Group 1 is an optional markdown prefix (the Akoma
 * Ntoso fallback text), group 3 whatever follows the number on the line.
 */
const HEADING_RE = new RegExp(
  `^(${HWS}*(?:#{1,6}${HWS}+)?)` +
    `((?:art(?:icolo)?\\.?${HWS}*${ARTICLE_NUMBER}\\.?)|(?:[^\\n]{1,60}?-art\\.${HWS}*${ARTICLE_NUMBER}\\.?))` +
    `(.*)$`,
  'i',
);
/** A printed comma number: "1.", "01.", "1-bis.", "4.1." — followed by a space, so never "3.000". */
const NUMBERED_COMMA_RE = new RegExp(`^\\d{1,3}(?:-?(?:${SUFFIX})\\b)?(?:\\.\\d+)?\\.(?=${HWS}|$)`, 'i');
/** An item enumerator: "a)", "a-bis)", "aa)", "iii)", "1)", "2-ter)", "1°". */
const ITEM_RE = new RegExp(
  `^(?:(?:[a-z]{1,2}|[ivx]{1,5}|\\d{1,3})(?:-(?:${SUFFIX}))?\\)|\\d{1,3}°(?:-?(?:${SUFFIX})\\b)?)`,
  'i',
);
/**
 * EUR-Lex glue: the Official Journal nests points inside their paragraph and
 * the scraper joins them with nothing — "condizioni:a)l'interessato…;b)il
 * trattamento…", even "Unione; ob)dal diritto" with the conjunction stuck to
 * the letter. A split goes right after the match: an enumerator that
 * directly follows ":" or ";" (optionally through that conjunction) AND is
 * directly followed by text. Prose always has a space there ("lettera a); b)
 * resta"), so it is never split.
 */
const GLUE_RE = new RegExp(
  `[:;](?:${HWS}?(?:oppure|ovvero|o|e))?(?=(?:[a-z]{1,2}|[ivx]{1,5}|\\d{1,2})(?:-(?:${SUFFIX}))?\\)[^\\s)\\];,.:])`,
  'gi',
);
const TAIL_RE = new RegExp(
  `(^|\\n)${HWS}*(?:-{3,}${HWS}*\\n(?:${HWS}*\\n)*${HWS}*)?AGGIORNAMENTO${HWS}*\\(${HWS}*\\d{1,4}[a-z]?${HWS}*\\)`,
);
const TAIL_SEP_RE = new RegExp(`^${HWS}*-{3,}${HWS}*$`);
const TAIL_HEAD_RE = new RegExp(`^${HWS}*AGGIORNAMENTO${HWS}*\\(${HWS}*(\\d{1,4}[a-z]?)${HWS}*\\)`);
/** "(119)", "(129a)" standing on its own: Normattiva's reference to an AGGIORNAMENTO note. */
const REF_RE = /(^|\s)\((\d{1,4}[a-z]?)\)(?=$|[\s.,;:)])/g;
const NOTE_ID_RE = /^\d{1,4}[a-z]?$/;
const NOTICE_WORDS = /ABROGAT|SOPPRESS|SOSTITUIT|MODIFICAT|OMISSIS/;
const ROMAN_RE = /^x{0,2}(?:ix|iv|v?i{0,3})$/;
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const ROMAN_SUCCESSOR: Record<string, string> = { i: 'ii', v: 'vi', x: 'xi' };

export function parseArticleStructure(raw: string): ArticleStructure {
  if (!raw) return { blocks: [], decorations: [], notes: {}, updates: null };

  const segments: Segment[] = [];
  const decorations: InlineDecoration[] = [];
  const notes: Record<string, UpdateNote> = {};

  // The tail first: a reference in the body is a button only when its note exists.
  const tailStart = findTailStart(raw);
  const bodyEnd = tailStart ?? raw.length;
  if (tailStart !== null) readTail(raw, tailStart, segments, notes);

  const { units, blankMode } = findUnits(raw, bodyEnd);
  const bodyUnits = readHeader(raw, units, blankMode, segments, decorations);
  classifyUnits(raw, bodyUnits, segments, decorations);

  const blocks = assemble(raw, segments);
  addParenthesisedMarks(raw, blocks, tailStart, notes, decorations);
  addReferences(raw, blocks, bodyEnd, notes, decorations);
  decorations.sort((a, b) => a.start - b.start || b.end - a.end);

  return {
    blocks,
    decorations,
    notes,
    updates: tailStart === null ? null : { start: tailStart, end: raw.length },
  };
}

/** The rubric as a title: parentheses, the ((modification)) wrapper and a final dot removed. */
export function getRubricText(raw: string, structure: ArticleStructure): string | null {
  const block = structure.blocks.find((b) => b.kind === 'rubrica');
  if (!block) return null;
  let t = raw.slice(block.start, block.end).replace(/\s+/g, ' ').trim();
  if (t.startsWith('((')) t = t.slice(2).replace(/\)\)\s*\.?$/, '').trim();
  t = t.replace(/\.$/, '').trim();
  if (t.startsWith('(') && t.endsWith(')')) t = t.slice(1, -1).trim();
  return t || null;
}

/** The paragraphs of an AGGIORNAMENTO note, whitespace collapsed, ready to show as text. */
export function getUpdateNoteParagraphs(raw: string, note: UpdateNote): string[] {
  return note.paragraphs
    .map((p) => raw.slice(p.start, p.end).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// ── lines and units ─────────────────────────────────────────────

function splitLines(raw: string, from: number, to: number): TextRange[] {
  const lines: TextRange[] = [];
  let start = from;
  for (let i = from; i < to; i++) {
    if (raw.charCodeAt(i) === 10) {
      lines.push({ start, end: i });
      start = i + 1;
    }
  }
  if (start < to) lines.push({ start, end: to });
  return lines;
}

const isBlank = (raw: string, range: TextRange): boolean => raw.slice(range.start, range.end).trim() === '';

function firstContentLine(raw: string, from: number, to: number): TextRange | null {
  for (const line of splitLines(raw, from, to)) if (!isBlank(raw, line)) return line;
  return null;
}

function startsWithEnumerator(line: string): boolean {
  const t = line.replace(new RegExp(`^${HWS}*(?:\\(\\(${HWS}*)?`), '');
  return NUMBERED_COMMA_RE.test(t) || ITEM_RE.test(t);
}

/**
 * Blank mode (Normattiva, the AKN fallback): a unit starts after a blank line,
 * or at a line that opens with an enumerator. Otherwise (EUR-Lex, one line per
 * paragraph or point) every content line is a unit. Glued EUR-Lex points are
 * then split inside their unit.
 */
function findUnits(raw: string, end: number): { units: TextRange[]; blankMode: boolean } {
  const lines = splitLines(raw, 0, end);
  const content = lines.map((l) => !isBlank(raw, l));
  const first = content.indexOf(true);
  const last = content.lastIndexOf(true);
  let blankMode = false;
  for (let i = first + 1; i < last; i++) {
    if (!content[i]) {
      blankMode = true;
      break;
    }
  }

  const starts: number[] = [];
  let afterBlank = true;
  lines.forEach((line, i) => {
    if (!content[i]) {
      afterBlank = true;
      return;
    }
    if (!blankMode || afterBlank || startsWithEnumerator(raw.slice(line.start, line.end))) starts.push(line.start);
    afterBlank = false;
  });

  const withGlue: number[] = [];
  starts.forEach((start, k) => {
    withGlue.push(start);
    const stop = k + 1 < starts.length ? starts[k + 1] : end;
    const slice = raw.slice(start, stop);
    GLUE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = GLUE_RE.exec(slice)) !== null) withGlue.push(start + m.index + m[0].length);
  });

  return {
    units: withGlue.map((start, k) => ({ start, end: k + 1 < withGlue.length ? withGlue[k + 1] : end })),
    blankMode,
  };
}

// ── the header ──────────────────────────────────────────────────

function isParenthesised(text: string): boolean {
  let s = text.trim();
  if (s.startsWith('((')) s = s.slice(2).replace(new RegExp(`\\)\\)${HWS}*\\.?$`), '').trim();
  s = s.replace(/\.$/, '').trim();
  return s.startsWith('(') && s.endsWith(')');
}

function acceptRubric(line: string, allowBareTitle: boolean): boolean {
  const t = line.trim();
  if (!t || t.length > 300) return false;
  if (isParenthesised(t)) return true;
  if (!allowBareTitle) return false;
  return !startsWithEnumerator(t) && !/[.:;,]$/.test(t);
}

function addRubricParens(raw: string, start: number, end: number, decorations: InlineDecoration[]): void {
  let i = start;
  while (i < end && isHws(raw[i])) i++;
  let wrapped = false;
  if (raw.startsWith('((', i)) {
    wrapped = true;
    i += 2;
    while (i < end && isHws(raw[i])) i++;
  }
  if (raw[i] !== '(') return;
  let j = end;
  const trimBack = () => {
    while (j > i && isHws(raw[j - 1])) j--;
  };
  trimBack();
  if (wrapped && raw[j - 1] === ')' && raw[j - 2] === ')') {
    j -= 2;
    trimBack();
  }
  if (raw[j - 1] === '.') {
    j--;
    trimBack();
  }
  if (j - 1 <= i || raw[j - 1] !== ')') return;
  decorations.push({ kind: 'rubric-paren', start: i, end: i + 1 }, { kind: 'rubric-paren', start: j - 1, end: j });
}

/** What is left of a unit after `consumedEnd`, if it still holds text, becomes a unit of its own. */
function withRemainder(raw: string, consumedEnd: number, unitEnd: number, rest: TextRange[]): TextRange[] {
  const line = firstContentLine(raw, consumedEnd + 1, unitEnd);
  return line ? [{ start: line.start, end: unitEnd }, ...rest] : rest;
}

function readHeader(
  raw: string,
  units: TextRange[],
  blankMode: boolean,
  segments: Segment[],
  decorations: InlineDecoration[],
): TextRange[] {
  const first = units[0];
  if (!first) return units;
  const headLine = firstContentLine(raw, first.start, first.end);
  if (!headLine) return units;
  const match = HEADING_RE.exec(raw.slice(headLine.start, headLine.end));
  if (!match) return units;
  const [, prefix, head, rest] = match;
  const hasHash = prefix.includes('#');
  const restTrim = rest.trim();
  // "Articolo 3 della legge…" is a sentence, not a heading. Text after the
  // number counts only as a rubric: in parentheses, or on an AKN "###" line.
  if (restTrim && !restTrim.startsWith('(') && !hasHash) return units;

  segments.push({ start: first.start, kind: 'heading' });
  if (hasHash) {
    decorations.push({
      kind: 'hidden',
      start: headLine.start + prefix.indexOf('#'),
      end: headLine.start + prefix.length,
    });
  }
  const remaining = units.slice(1);

  if (restTrim) {
    const restStart = headLine.start + prefix.length + head.length;
    segments.push({ start: restStart, kind: 'rubrica' });
    addRubricParens(raw, restStart, headLine.end, decorations);
    return withRemainder(raw, headLine.end, first.end, remaining);
  }

  const nextInUnit = firstContentLine(raw, headLine.end + 1, first.end);
  if (nextInUnit) {
    if (acceptRubric(raw.slice(nextInUnit.start, nextInUnit.end), true)) {
      segments.push({ start: nextInUnit.start, kind: 'rubrica' });
      addRubricParens(raw, nextInUnit.start, nextInUnit.end, decorations);
      return withRemainder(raw, nextInUnit.end, first.end, remaining);
    }
    return withRemainder(raw, headLine.end, first.end, remaining);
  }

  const second = remaining[0];
  if (second) {
    const line = firstContentLine(raw, second.start, second.end);
    // After a blank line only a parenthesised rubric is safe to claim; with
    // one line per paragraph (EUR-Lex) the title line is a bare title.
    if (line && acceptRubric(raw.slice(line.start, line.end), !blankMode)) {
      segments.push({ start: second.start, kind: 'rubrica' });
      addRubricParens(raw, line.start, line.end, decorations);
      return withRemainder(raw, line.end, second.end, remaining.slice(1));
    }
  }
  return remaining;
}

// ── commi and items ─────────────────────────────────────────────

type ItemStyle = 'letter' | 'roman' | 'numeric';

interface Enumerator {
  kind: 'comma' | 'item';
  markerStart: number;
  markerEnd: number;
  /** "a" for "a-bis)", "2" for "2-ter)", "iii" for "iii)". */
  base: string;
  ordinal: boolean;
}

function readEnumerator(raw: string, unit: TextRange): Enumerator | null {
  let i = unit.start;
  while (i < unit.end && isHws(raw[i])) i++;
  let j = i;
  if (raw.startsWith('((', j)) {
    j += 2;
    while (j < unit.end && isHws(raw[j])) j++;
  }
  const probe = raw.slice(j, Math.min(unit.end, j + 40));
  let kind: Enumerator['kind'] = 'comma';
  let m = NUMBERED_COMMA_RE.exec(probe);
  if (!m) {
    kind = 'item';
    m = ITEM_RE.exec(probe);
  }
  if (!m) return null;
  let markerEnd = j + m[0].length;
  while (markerEnd < unit.end && isHws(raw[markerEnd])) markerEnd++;
  const token = m[0];
  return {
    kind,
    markerStart: i,
    markerEnd,
    base: token.replace(/[).°]+$/, '').split('-')[0].toLowerCase(),
    ordinal: token.includes('°'),
  };
}

function styleOf(e: Enumerator): ItemStyle | 'ambiguous' {
  if (e.ordinal || /^\d+$/.test(e.base)) return 'numeric';
  if (e.base === 'i' || e.base === 'v' || e.base === 'x') return 'ambiguous';
  if (e.base.length > 1 && ROMAN_RE.test(e.base)) return 'roman';
  return 'letter';
}

function isLetterSuccessor(previous: string | undefined, letter: string): boolean {
  return !!previous && previous.length === 1 && LETTERS.indexOf(previous) + 1 === LETTERS.indexOf(letter);
}

function isNotice(text: string): boolean {
  const t = text.trim();
  if (t === '...' || t === '…') return true;
  const letters = t.match(/\p{L}/gu) ?? [];
  if (letters.length < 6) return false;
  const upper = t.match(/\p{Lu}/gu) ?? [];
  return upper.length / letters.length >= 0.9 && NOTICE_WORDS.test(t);
}

/** "c) LETTERA ABROGATA DALLA L. …;" — a repeal notice with no parentheses around it. */
function addBareNotice(raw: string, unit: TextRange, e: Enumerator | null, decorations: InlineDecoration[]): void {
  let s = e ? e.markerEnd : unit.start;
  let t = unit.end;
  while (s < t && /\s/.test(raw[s])) s++;
  while (t > s && /\s/.test(raw[t - 1])) t--;
  if (t <= s || raw.startsWith('((', s)) return;
  if (isNotice(raw.slice(s, t))) decorations.push({ kind: 'notice', start: s, end: t });
}

function classifyUnits(raw: string, units: TextRange[], segments: Segment[], decorations: InlineDecoration[]): void {
  const enumerators = units.map((u) => readEnumerator(raw, u));
  let levelOneStyle: ItemStyle | null = null;
  let previousLetter: string | undefined;

  units.forEach((unit, idx) => {
    const e = enumerators[idx];
    if (!e || e.kind === 'comma') {
      levelOneStyle = null;
      previousLetter = undefined;
      segments.push({
        start: unit.start,
        kind: 'comma',
        ...(e ? { marker: { start: e.markerStart, end: e.markerEnd } } : {}),
      });
      addBareNotice(raw, unit, e, decorations);
      return;
    }

    let style = styleOf(e);
    if (style === 'ambiguous') {
      // "i)" is the ninth letter after "h)" (d.lgs. 231/2001 art. 25-ter) and
      // a roman one when "ii)" follows (AI Act art. 5, under "h)").
      const next = enumerators[idx + 1];
      if (next?.kind === 'item' && next.base === ROMAN_SUCCESSOR[e.base]) style = 'roman';
      else if (levelOneStyle === 'letter' && isLetterSuccessor(previousLetter, e.base)) style = 'letter';
      else style = 'roman';
    }

    let level: 1 | 2;
    if (levelOneStyle === null) {
      levelOneStyle = style;
      level = 1;
    } else {
      level = style === levelOneStyle ? 1 : 2;
    }
    if (level === 1 && style === 'letter') previousLetter = e.base;

    segments.push({ start: unit.start, kind: 'item', level, marker: { start: e.markerStart, end: e.markerEnd } });
    addBareNotice(raw, unit, e, decorations);
  });
}

// ── the AGGIORNAMENTO tail ──────────────────────────────────────

function findTailStart(raw: string): number | null {
  const m = TAIL_RE.exec(raw);
  return m ? m.index + m[1].length : null;
}

function readTail(raw: string, start: number, segments: Segment[], notes: Record<string, UpdateNote>): void {
  let current: UpdateNote | null = null;
  let paragraph: TextRange | null = null;
  for (const line of splitLines(raw, start, raw.length)) {
    const text = raw.slice(line.start, line.end);
    if (!text.trim()) {
      paragraph = null;
      continue;
    }
    if (TAIL_SEP_RE.test(text)) {
      segments.push({ start: line.start, kind: 'update-sep' });
      paragraph = null;
      continue;
    }
    const head = TAIL_HEAD_RE.exec(text);
    if (head) {
      const id = head[1];
      segments.push({ start: line.start, kind: 'update-head', noteId: id });
      current = notes[id] ?? (notes[id] = { id, paragraphs: [] });
      paragraph = null;
      continue;
    }
    if (paragraph) {
      paragraph.end = line.end; // a wrapped line of the same paragraph
      continue;
    }
    segments.push({ start: line.start, kind: 'update-para' });
    paragraph = { start: line.start, end: line.end };
    if (current) current.paragraphs.push(paragraph);
  }
}

// ── assembly and inline marks ───────────────────────────────────

function assemble(raw: string, segments: Segment[]): StructureBlock[] {
  if (segments.length === 0) segments.push({ start: 0, kind: 'comma' });
  segments.sort((a, b) => a.start - b.start);
  const unique: Segment[] = [];
  for (const s of segments) if (!unique.length || unique[unique.length - 1].start !== s.start) unique.push(s);
  unique[0] = { ...unique[0], start: 0 };
  return unique.map((s, k) => ({ ...s, end: k + 1 < unique.length ? unique[k + 1].start : raw.length }));
}

/**
 * Normattiva's double parentheses, one block at a time: "((…))" marks text a
 * later act changed; "((...))" and upper-case notices mark what it removed;
 * "((49))" is a reference to an update note.
 */
function addParenthesisedMarks(
  raw: string,
  blocks: StructureBlock[],
  tailStart: number | null,
  notes: Record<string, UpdateNote>,
  decorations: InlineDecoration[],
): void {
  for (const block of blocks) {
    const inTail = tailStart !== null && block.start >= tailStart;
    let from = block.start;
    for (;;) {
      const open = raw.indexOf('((', from);
      if (open === -1 || open >= block.end) break;
      const close = raw.indexOf('))', open + 2);
      if (close === -1 || close + 2 > block.end) break;
      const inner = raw.slice(open + 2, close).trim();
      if (!inTail && NOTE_ID_RE.test(inner)) {
        decorations.push({ kind: notes[inner] ? 'ref' : 'ref-missing', start: open, end: close + 2, noteId: inner });
      } else if (isNotice(inner)) {
        decorations.push({ kind: 'notice', start: open, end: close + 2 });
      } else {
        decorations.push(
          { kind: 'mod', start: open, end: close + 2 },
          { kind: 'mod-paren', start: open, end: open + 2 },
          { kind: 'mod-paren', start: close, end: close + 2 },
        );
      }
      from = close + 2;
    }
  }
}

/** A standalone "(119)" in the body: a button when its note exists, dimmed otherwise. */
function addReferences(
  raw: string,
  blocks: StructureBlock[],
  bodyEnd: number,
  notes: Record<string, UpdateNote>,
  decorations: InlineDecoration[],
): void {
  for (const block of blocks) {
    if (block.start >= bodyEnd) break;
    const text = raw.slice(block.start, Math.min(block.end, bodyEnd));
    REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = REF_RE.exec(text)) !== null) {
      const start = block.start + m.index + m[1].length;
      const id = m[2];
      decorations.push({ kind: notes[id] ? 'ref' : 'ref-missing', start, end: start + id.length + 2, noteId: id });
    }
  }
}
