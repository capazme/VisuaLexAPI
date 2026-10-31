/**
 * The text of a DOCX as Word shows it, with a map from every character back to where it lives in the package
 * (spec 2026-10-31-document-hyperlinks-design.md §6.1). Pure: it takes the parts' XML as strings.
 *
 * What is read: the visible runs of `word/document.xml`, then its footnotes and endnotes under «Note», each note a
 * paragraph with its number, in the order the body refers to them. Headers and footers are not read (Q3).
 * What is not read, because Word does not show it: tracked deletions and moves away (`w:del`, `w:moveFrom`,
 * `w:delText`), a field's instruction (`w:instrText`, and whatever lies between a field's `begin` and `separate`),
 * the fallback copy of an alternate content (`mc:Fallback`: the first `mc:Choice` is read), hidden runs (`w:vanish`
 * in the run's own properties), the properties themselves, and any text outside `w:t`/`m:t` (a drawing's position,
 * the indentation of a pretty-printed part).
 * A tab, a break (a page break too), a carriage return, a non-breaking or soft hyphen, a symbol and a paragraph end
 * are characters of the text, mapped to their element with no `w:t` behind them.
 *
 * The text is then folded as the reader always folded it (spaces and tabs before a line break dropped, three line
 * breaks or more made two, the whole trimmed), so a DOCX without the defects above reads as it did (§6.1).
 */
import { DocxError } from './docxErrors';
import { tokenize, type XmlAttribute } from './xmlTokens';

export const DOCUMENT_PART = 'word/document.xml';
export const FOOTNOTES_PART = 'word/footnotes.xml';
export const ENDNOTES_PART = 'word/endnotes.xml';
export type DocxPartName = typeof DOCUMENT_PART | typeof FOOTNOTES_PART | typeof ENDNOTES_PART;

/** The heading drawn above the notes. */
export const NOTES_HEADING = 'Note';

/**
 * Where a piece of the text comes from. Source offsets are UTF-16 indexes into the part's XML as decoded.
 * - `text`: the decoded content of a `w:t` (or `m:t`, a formula's text); a segment's `offset` counts in it.
 * - `mark`: an element that stands for one character (`tab`, `br`, `cr`, `noBreakHyphen`, `softHyphen`, `sym`,
 *   `ptab`), or a paragraph's end (`p`, its close tag).
 * - `added`: written by the reader: the «Note» heading and a note's number.
 */
export type DocxOrigin =
  | { kind: 'text'; part: DocxPartName; element: string; runStart: number; tagStart: number; contentStart: number; contentEnd: number }
  | { kind: 'mark'; part: DocxPartName; element: string; runStart: number; tagStart: number; tagEnd: number }
  | { kind: 'added' };

/** Characters `[start, end)` of the text come from `origins[origin]`, starting at `offset` in its own text. */
export interface DocxSegment {
  start: number;
  end: number;
  origin: number;
  offset: number;
}

export interface DocxCharMap {
  origins: DocxOrigin[];
  /** In order, not overlapping, covering every character of the text. */
  segments: DocxSegment[];
}

export interface DocxNote {
  kind: 'footnote' | 'endnote';
  id: string;
  /** As drawn before the note: «1», «ii», «*». */
  label: string;
}

export interface DocxText {
  text: string;
  map: DocxCharMap;
  notes: DocxNote[];
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W_STRICT = 'http://purl.oclc.org/ooxml/wordprocessingml/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

/** The prefixes Word always writes, for a part that uses them without declaring them. */
const DEFAULT_PREFIXES: Record<string, string> = { w: W, m: M, mc: MC };

/** Elements whose whole content Word does not show as text of the document. */
const SKIPPED_W = new Set([
  'del', 'moveFrom', 'delText', 'instrText', 'delInstrText',
  'pPr', 'rPrChange', 'pPrChange', 'sectPr', 'sectPrChange', 'tblPr', 'tblPrChange', 'tblGrid', 'trPr', 'tcPr',
  'sdtPr', 'sdtEndPr', 'footnotePr', 'endnotePr',
]);

const NOTE_SEPARATORS = new Set(['separator', 'continuationSeparator', 'continuationNotice']);

const MARK_CHARS: Record<string, string> = {
  tab: '\t', ptab: '\t', br: '\n', cr: '\n', noBreakHyphen: '‑', softHyphen: '­',
};

interface Piece {
  text: string;
  origin: DocxOrigin;
}

interface NoteReference {
  kind: 'footnote' | 'endnote';
  id: string;
  custom: boolean;
}

interface Frame {
  ns: string;
  local: string;
  prefixes: Record<string, string>;
  skip: boolean;
  /** For a run: where its tag starts, and whether its own properties hide it. */
  run?: { start: number; hidden: boolean };
  /** For `mc:AlternateContent`: whether a `mc:Choice` was already read. */
  choiceTaken?: boolean;
  /** For a `w:t`/`m:t` being read. */
  text?: { pieces: string[]; tagStart: number; contentStart: number; contentEnd: number; runStart: number };
  /** For a note in a notes part: its id. */
  note?: string;
}

function attribute(attributes: XmlAttribute[], local: string): string | undefined {
  for (const { name, value } of attributes) {
    if (name === local || name.endsWith(`:${local}`)) return value;
  }
  return undefined;
}

function isOn(value: string | undefined): boolean {
  return value === undefined || !['false', '0', 'off'].includes(value);
}

function declare(attributes: XmlAttribute[], inherited: Record<string, string>): Record<string, string> {
  let prefixes = inherited;
  for (const { name, value } of attributes) {
    if (name !== 'xmlns' && !name.startsWith('xmlns:')) continue;
    if (value === W_STRICT) throw new DocxError('strict');
    if (prefixes === inherited) prefixes = { ...inherited };
    prefixes[name === 'xmlns' ? '' : name.slice(6)] = value;
  }
  return prefixes;
}

/** Counts in lower-case roman numerals, as Word numbers endnotes by default. */
export function roman(value: number): string {
  const table: Array<[number, string]> = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ];
  let rest = value;
  let out = '';
  for (const [amount, digits] of table) {
    while (rest >= amount) { out += digits; rest -= amount; }
  }
  return out;
}

interface WalkResult {
  /** The body's pieces (the document part). */
  pieces: Piece[];
  /** In a notes part: each note's pieces, by id. */
  notes: Map<string, Piece[]>;
  references: NoteReference[];
}

/** Walks one part: what is visible, in order, as pieces. */
function walkPart(xml: string, part: DocxPartName): WalkResult {
  const isNotesPart = part !== DOCUMENT_PART;
  const pieces: Piece[] = [];
  const notes = new Map<string, Piece[]>();
  const references: NoteReference[] = [];
  const stack: Frame[] = [];
  /** Open fields, innermost last: in its instruction until `separate`, then in its result. */
  const fields: Array<'instruction' | 'result'> = [];
  let skipDepth = 0;
  let hiddenRuns = 0;
  let currentNote: Piece[] | null = null;

  const emit = (piece: Piece) => {
    if (isNotesPart) currentNote?.push(piece);
    else pieces.push(piece);
  };
  const nearestRun = () => {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (stack[index].run) return stack[index].run;
    }
    return undefined;
  };
  const visible = () => skipDepth === 0 && hiddenRuns === 0 && (!isNotesPart || currentNote !== null);
  const inInstruction = () => fields.includes('instruction');

  for (const token of tokenize(xml)) {
    if (token.type === 'text') {
      const top = stack[stack.length - 1];
      if (top?.text) {
        top.text.pieces.push(token.text);
        top.text.contentEnd = token.end;
      }
      continue;
    }

    if (token.type === 'close') {
      const frame = stack.pop();
      if (!frame) continue;
      if (frame.text && frame.text.pieces.length > 0 && visible() && !inInstruction()) {
        const text = frame.text.pieces.join('');
        if (text) {
          emit({
            text,
            origin: {
              kind: 'text', part, element: frame.local === 't' && frame.ns === M ? 'm:t' : 'w:t',
              runStart: frame.text.runStart, tagStart: frame.text.tagStart,
              contentStart: frame.text.contentStart, contentEnd: frame.text.contentEnd,
            },
          });
        }
      }
      if (frame.ns === W && frame.local === 'p' && visible()) {
        emit({ text: '\n', origin: { kind: 'mark', part, element: 'p', runStart: -1, tagStart: token.start, tagEnd: token.end } });
      }
      if (frame.run?.hidden) hiddenRuns -= 1;
      if (frame.skip) skipDepth -= 1;
      if (frame.note !== undefined) currentNote = null;
      continue;
    }

    // An open tag.
    const parent = stack[stack.length - 1];
    const prefixes = declare(token.attributes, parent?.prefixes ?? DEFAULT_PREFIXES);
    const colon = token.name.indexOf(':');
    const prefix = colon < 0 ? '' : token.name.slice(0, colon);
    const local = colon < 0 ? token.name : token.name.slice(colon + 1);
    const ns = prefixes[prefix] ?? '';
    const frame: Frame = { ns, local, prefixes, skip: false };

    if (ns === W && SKIPPED_W.has(local)) frame.skip = true;
    if (ns === MC && local === 'Fallback') frame.skip = true;
    if (ns === MC && local === 'Choice' && parent?.ns === MC && parent.local === 'AlternateContent') {
      if (parent.choiceTaken) frame.skip = true;
      parent.choiceTaken = true;
    }
    if (ns === MC && local === 'AlternateContent') frame.choiceTaken = false;

    if (isNotesPart && ns === W && (local === 'footnote' || local === 'endnote') && skipDepth === 0) {
      const type = attribute(token.attributes, 'type');
      const id = attribute(token.attributes, 'id');
      if (id !== undefined && !(type && NOTE_SEPARATORS.has(type)) && !token.selfClosing) {
        frame.note = id;
        currentNote = [];
        notes.set(id, currentNote);
      }
    }

    if ((ns === W || ns === M) && local === 'r') frame.run = { start: token.start, hidden: false };

    // `w:vanish` in a run's own properties hides the run (not in a paragraph mark's, not in a change's old ones).
    if (ns === W && local === 'vanish' && parent?.ns === W && parent.local === 'rPr') {
      const runFrame = stack[stack.length - 2];
      if (runFrame?.run && !runFrame.run.hidden && isOn(attribute(token.attributes, 'val'))) {
        runFrame.run.hidden = true;
        hiddenRuns += 1;
      }
    }

    const inRun = parent?.run !== undefined;
    if (skipDepth === 0 && !frame.skip && ns === W && inRun) {
      if (local === 'fldChar') {
        const type = attribute(token.attributes, 'fldCharType');
        if (type === 'begin') fields.push('instruction');
        else if (type === 'separate' && fields.length > 0) fields[fields.length - 1] = 'result';
        else if (type === 'end') fields.pop();
      } else if (visible() && !inInstruction()) {
        const runStart = parent.run!.start;
        let char: string | undefined = MARK_CHARS[local];
        if (local === 'sym') {
          const code = attribute(token.attributes, 'char');
          char = code && /^[0-9a-fA-F]{1,6}$/.test(code) && parseInt(code, 16) <= 0x10ffff
            && !(parseInt(code, 16) >= 0xd800 && parseInt(code, 16) <= 0xdfff) && parseInt(code, 16) > 0
            ? String.fromCodePoint(parseInt(code, 16))
            : undefined;
        }
        if (char !== undefined) {
          emit({ text: char, origin: { kind: 'mark', part, element: local, runStart, tagStart: token.start, tagEnd: token.end } });
        }
        if (!isNotesPart && (local === 'footnoteReference' || local === 'endnoteReference')) {
          const id = attribute(token.attributes, 'id');
          if (id !== undefined) {
            references.push({
              kind: local === 'footnoteReference' ? 'footnote' : 'endnote',
              id,
              custom: isOn(attribute(token.attributes, 'customMarkFollows')) && attribute(token.attributes, 'customMarkFollows') !== undefined,
            });
          }
        }
      }
    }

    if ((ns === W || ns === M) && local === 't' && !frame.skip) {
      frame.text = {
        pieces: [], tagStart: token.start, contentStart: token.end, contentEnd: token.end,
        runStart: nearestRun()?.start ?? -1,
      };
    }

    if (token.selfClosing) {
      // Nothing to close: a self-closed run, skip element or note leaves no state behind.
      if (frame.run?.hidden) hiddenRuns -= 1;
      if (frame.note !== undefined) currentNote = null;
      continue;
    }
    if (frame.skip) skipDepth += 1;
    stack.push(frame);
  }

  return { pieces, notes, references };
}

/**
 * The reader's folding, kept from the expressions it replaced (`[ \t]+\n` → `\n`, `\n{3,}` → `\n\n`, trim), applied
 * to the raw text and returning which characters stay.
 */
function fold(raw: string): Uint8Array {
  const kept = new Uint8Array(raw.length).fill(1);
  for (let at = 0; at < raw.length; at += 1) {
    if (raw[at] !== '\n') continue;
    for (let back = at - 1; back >= 0 && (raw[back] === ' ' || raw[back] === '\t'); back -= 1) kept[back] = 0;
  }
  let newlines = 0;
  for (let at = 0; at < raw.length; at += 1) {
    if (!kept[at]) continue;
    if (raw[at] === '\n') {
      newlines += 1;
      if (newlines > 2) kept[at] = 0;
    } else {
      newlines = 0;
    }
  }
  const space = /\s/;
  for (let at = 0; at < raw.length; at += 1) {
    if (!kept[at]) continue;
    if (!space.test(raw[at])) break;
    kept[at] = 0;
  }
  for (let at = raw.length - 1; at >= 0; at -= 1) {
    if (!kept[at]) continue;
    if (!space.test(raw[at])) break;
    kept[at] = 0;
  }
  return kept;
}

function assemble(pieces: Piece[]): { text: string; map: DocxCharMap } {
  const raw = pieces.map(piece => piece.text).join('');
  const kept = fold(raw);
  const origins = pieces.map(piece => piece.origin);
  const segments: DocxSegment[] = [];
  const out: string[] = [];
  let pieceIndex = 0;
  let pieceStart = 0;
  let written = 0;
  let current: DocxSegment | null = null;
  for (let at = 0; at < raw.length; at += 1) {
    while (at >= pieceStart + pieces[pieceIndex].text.length) {
      pieceStart += pieces[pieceIndex].text.length;
      pieceIndex += 1;
    }
    if (!kept[at]) continue;
    const offset = at - pieceStart;
    if (current && current.origin === pieceIndex && current.offset + (current.end - current.start) === offset) {
      current.end += 1;
    } else {
      current = { start: written, end: written + 1, origin: pieceIndex, offset };
      segments.push(current);
    }
    written += 1;
  }
  // The text, from the kept characters (joined in runs, not one string per character).
  let runStart = -1;
  for (let at = 0; at <= raw.length; at += 1) {
    if (at < raw.length && kept[at]) {
      if (runStart < 0) runStart = at;
    } else if (runStart >= 0) {
      out.push(raw.slice(runStart, at));
      runStart = -1;
    }
  }
  return { text: out.join(''), map: { origins, segments } };
}

export interface DocxPartsXml {
  document: string;
  footnotes?: string;
  endnotes?: string;
}

/** The text of the parts, with its map and the notes drawn under «Note». */
export function docxText(parts: DocxPartsXml): DocxText {
  const body = walkPart(parts.document, DOCUMENT_PART);
  const footnotes = parts.footnotes ? walkPart(parts.footnotes, FOOTNOTES_PART).notes : new Map<string, Piece[]>();
  const endnotes = parts.endnotes ? walkPart(parts.endnotes, ENDNOTES_PART).notes : new Map<string, Piece[]>();

  const pieces = [...body.pieces];
  const notes: DocxNote[] = [];
  const seen = new Set<string>();
  let footnoteNumber = 0;
  let endnoteNumber = 0;
  // Footnotes first, then endnotes, each in the order the body refers to them (Word's own numbering).
  for (const kind of ['footnote', 'endnote'] as const) {
    for (const reference of body.references) {
      if (reference.kind !== kind) continue;
      const key = `${kind}:${reference.id}`;
      const notePieces = (kind === 'footnote' ? footnotes : endnotes).get(reference.id);
      if (seen.has(key) || !notePieces) continue;
      seen.add(key);
      let label: string;
      if (reference.custom) label = '*';
      else if (kind === 'footnote') label = String(++footnoteNumber);
      else label = roman(++endnoteNumber);
      if (notes.length === 0) pieces.push({ text: `\n\n${NOTES_HEADING}\n`, origin: { kind: 'added' } });
      notes.push({ kind, id: reference.id, label });
      // «1.», «i.»; a mark of the author's own («*») stands as it is.
      const head = reference.custom ? label : `${label}.`;
      const startsWithSpace = /^\s/.test(notePieces[0]?.text ?? '');
      pieces.push({ text: startsWithSpace ? head : `${head} `, origin: { kind: 'added' } });
      pieces.push(...notePieces);
      if (notePieces[notePieces.length - 1]?.text !== '\n') pieces.push({ text: '\n', origin: { kind: 'added' } });
    }
  }

  const { text, map } = assemble(pieces);
  return { text, map, notes };
}

/** Where character `index` of the text comes from, or `null` past the end. */
export function locateChar(map: DocxCharMap, index: number): { origin: DocxOrigin; offset: number } | null {
  let low = 0;
  let high = map.segments.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const segment = map.segments[middle];
    if (index < segment.start) high = middle - 1;
    else if (index >= segment.end) low = middle + 1;
    else return { origin: map.origins[segment.origin], offset: segment.offset + index - segment.start };
  }
  return null;
}
