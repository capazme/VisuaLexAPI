/**
 * A small XML tokenizer for the parts of a DOCX (spec #391 §6.1, §7.1). It knows the five predefined entities and
 * numeric references, nothing else: a `<!DOCTYPE` refuses the part (no OOXML part carries one), which closes entity
 * expansion at the door. It never builds a tree and never serialises: it reports where each token lies in the
 * source string, so a writer can splice the original text (§6.2).
 *
 * Offsets are UTF-16 indexes into the part's text decoded from UTF-8.
 */
import { DocxError } from './docxErrors';

export interface XmlAttribute {
  /** As written, with its prefix: `w:val`. */
  name: string;
  /** Decoded. */
  value: string;
}

export type XmlToken =
  | { type: 'open'; name: string; attributes: XmlAttribute[]; selfClosing: boolean; start: number; end: number }
  | { type: 'close'; name: string; start: number; end: number }
  /** Character data between tags: `raw` as written, `text` decoded; `start`/`end` bound `raw` in the source. */
  | { type: 'text'; raw: string; text: string; start: number; end: number };

const NAME_END = /[\s/>=]/;

function malformed(detail: string): never {
  throw new DocxError('malformed', `xml: ${detail}`);
}

function codePoint(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) {
    malformed('character reference');
  }
  return String.fromCodePoint(value);
}

const PREDEFINED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decodes the five predefined entities and numeric references; any other `&name;` is refused. */
export function decodeEntities(raw: string): string {
  if (!raw.includes('&')) return raw;
  return raw.replace(/&([^;&\s]*);?/g, (whole, body: string) => {
    if (!whole.endsWith(';')) malformed('bare ampersand');
    if (body.startsWith('#x') || body.startsWith('#X')) {
      if (!/^[0-9a-fA-F]+$/.test(body.slice(2))) malformed('character reference');
      return codePoint(parseInt(body.slice(2), 16));
    }
    if (body.startsWith('#')) {
      if (!/^[0-9]+$/.test(body.slice(1))) malformed('character reference');
      return codePoint(parseInt(body.slice(1), 10));
    }
    const value = PREDEFINED[body];
    if (value === undefined) malformed('entity');
    return value;
  });
}

/** XML's end-of-line handling: a literal CRLF or lone CR reads as LF (a `&#13;` stays a CR). */
function normaliseLines(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
}

/**
 * Character data as written → as read: line ends normalised, then entities decoded. The reader's offsets inside a
 * `w:t` count in this text; a writer that maps them back to the source must use the same function.
 */
export function decodeXmlText(raw: string): string {
  return decodeEntities(normaliseLines(raw));
}

/** Deeper than this the part is refused: Word nests a few dozen levels, a table in a text box in a note included. */
export const MAX_DEPTH = 512;

function readAttributes(source: string, from: number, to: number): XmlAttribute[] {
  const attributes: XmlAttribute[] = [];
  const seen = new Set<string>();
  let at = from;
  while (at < to) {
    while (at < to && /\s/.test(source[at])) at += 1;
    if (at >= to) break;
    const nameStart = at;
    while (at < to && !NAME_END.test(source[at])) at += 1;
    const name = source.slice(nameStart, at);
    if (!name) malformed('attribute name');
    while (at < to && /\s/.test(source[at])) at += 1;
    if (source[at] !== '=') malformed('attribute without value');
    at += 1;
    while (at < to && /\s/.test(source[at])) at += 1;
    const quote = source[at];
    if (quote !== '"' && quote !== "'") malformed('attribute quote');
    const valueEnd = source.indexOf(quote, at + 1);
    if (valueEnd < 0 || valueEnd >= to) malformed('attribute value');
    const raw = source.slice(at + 1, valueEnd);
    if (raw.includes('<')) malformed('< in attribute');
    if (seen.has(name)) malformed('duplicate attribute');
    seen.add(name);
    attributes.push({ name, value: decodeXmlText(raw) });
    at = valueEnd + 1;
  }
  return attributes;
}

/** The end of a tag starting at `from` (the index of its `>`), skipping `>` inside quoted values. */
function tagEnd(source: string, from: number): number {
  let quote: string | null = null;
  for (let at = from; at < source.length; at += 1) {
    const char = source[at];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return at;
    } else if (char === '<') {
      malformed('< inside a tag');
    }
  }
  return malformed('unterminated tag');
}

/**
 * The tokens of `source`, in order, checked for nesting: each close tag closes the last open one, and every open
 * tag is closed by the end. Processing instructions (the XML declaration) and comments are skipped; CDATA is text.
 */
export function* tokenize(source: string): Generator<XmlToken> {
  const open: string[] = [];
  let rootDone = false;
  let at = 0;
  const length = source.length;
  while (at < length) {
    const lt = source.indexOf('<', at);
    const textEnd = lt < 0 ? length : lt;
    if (textEnd > at) {
      const raw = source.slice(at, textEnd);
      if (raw.includes(']]>')) malformed(']]> in text');
      if (open.length === 0) {
        if (raw.trim()) malformed('text outside the root');
      } else {
        yield { type: 'text', raw, text: decodeXmlText(raw), start: at, end: textEnd };
      }
    }
    if (lt < 0) break;

    if (source.startsWith('<?', lt)) {
      const close = source.indexOf('?>', lt + 2);
      if (close < 0) malformed('unterminated processing instruction');
      at = close + 2;
    } else if (source.startsWith('<!--', lt)) {
      const close = source.indexOf('-->', lt + 4);
      if (close < 0) malformed('unterminated comment');
      at = close + 3;
    } else if (source.startsWith('<![CDATA[', lt)) {
      if (open.length === 0) malformed('CDATA outside the root');
      const close = source.indexOf(']]>', lt + 9);
      if (close < 0) malformed('unterminated CDATA');
      const raw = source.slice(lt, close + 3);
      yield { type: 'text', raw, text: normaliseLines(source.slice(lt + 9, close)), start: lt, end: close + 3 };
      at = close + 3;
    } else if (source.startsWith('<!', lt)) {
      // A DOCTYPE (or any other declaration): no OOXML part carries one, and refusing it closes entity expansion.
      throw new DocxError('unsafe', 'doctype');
    } else if (source[lt + 1] === '/') {
      const end = tagEnd(source, lt + 2);
      const name = source.slice(lt + 2, end).trim();
      if (open.pop() !== name) malformed(`close tag ${name}`);
      if (open.length === 0) rootDone = true;
      yield { type: 'close', name, start: lt, end: end + 1 };
      at = end + 1;
    } else {
      const end = tagEnd(source, lt + 1);
      const selfClosing = source[end - 1] === '/';
      const inner = selfClosing ? end - 1 : end;
      let nameEnd = lt + 1;
      while (nameEnd < inner && !NAME_END.test(source[nameEnd])) nameEnd += 1;
      const name = source.slice(lt + 1, nameEnd);
      if (!name) malformed('tag name');
      if (open.length === 0 && rootDone) malformed('second root');
      const attributes = readAttributes(source, nameEnd, inner);
      yield { type: 'open', name, attributes, selfClosing, start: lt, end: end + 1 };
      if (!selfClosing) {
        if (open.length >= MAX_DEPTH) throw new DocxError('unsafe', 'nesting');
        open.push(name);
      }
      else if (open.length === 0) rootDone = true;
      at = end + 1;
    }
  }
  if (open.length > 0) malformed('unclosed element');
}

