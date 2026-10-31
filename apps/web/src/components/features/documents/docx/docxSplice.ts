/**
 * Splices hyperlinks into one part's XML (spec 2026-10-31-document-hyperlinks-design.md §6.2–§6.5). Pure: it takes
 * the part's text, its runs (`docxRuns.ts`) and the citations already placed on them, and returns the new text.
 *
 * Only the runs a link wraps change: a run cut at a citation's edge becomes two runs, each with the run's whole
 * properties; a run inside a link gets the link's look (the Hyperlink character style, or the colour and underline
 * as direct formatting) inserted in its properties by the schema's order; the `w:hyperlink` tags go around them.
 * Every other byte of the part is the original's.
 */
import { REL_NS, W_NS, type ParagraphChild, type PartRuns, type RunAtom, type RunInfo } from './docxRuns';

/** Why a citation is left as it is (§6.5). The page chooses the words. */
export type DocxLinkSkip =
  /** Already a link: a `w:hyperlink`, or a `HYPERLINK` field. «già collegata» */
  | 'already_linked'
  /** In a field's result (`w:fldSimple`, a complex field). «in un campo di Word» */
  | 'in_field'
  /** Touches a tracked change. «in una revisione non accettata» */
  | 'in_revision'
  /** In a content control (`w:sdt`). «in un campo modulo» */
  | 'in_content_control'
  /** A comment's range starts or ends inside it. «a cavallo di un commento» */
  | 'across_comment'
  /** A text box, a wrapper, a tab, a break, a paragraph end, a drawing… «in una posizione che non modifico» */
  | 'structure'
  /** Characters the reader wrote itself (the «Note» heading, a note's number), or the range is not in the text. */
  | 'not_in_document'
  /** The address does not pass `sourceAddress` (https, Normattiva or EUR-Lex only). */
  | 'invalid_address'
  /** It overlaps a citation already linked. */
  | 'overlap';

/** A place inside a run: before atom `atom`, or inside the `w:t` at `atom`, `offset` characters in. */
export interface RunPosition {
  run: number;
  atom: number;
  offset: number;
}

/** A citation placed on the part's runs: from `start` (inclusive) to `end` (exclusive). */
export interface PlacedLink {
  start: RunPosition;
  end: RunPosition;
  /** The citation's text, as the reader read it: the runs covered must spell it. */
  text: string;
  /** The relationship's id, given by the caller once the link is accepted. */
  relId?: string;
}

/** How a link looks: the id of the Hyperlink character style, or `null` for colour and underline on the runs. */
export interface LinkLook {
  styleId: string | null;
}

export const LINK_COLOR = '0563C1';

/** The children of `w:rPr` in the schema's order (CT_RPr, EG_RPrBase, then the change). Word refuses another order. */
export const RPR_ORDER = [
  'rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss',
  'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs',
  'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout',
  'specVanish', 'oMath', 'rPrChange',
] as const;
const RPR_INDEX = new Map<string, number>(RPR_ORDER.map((name, index) => [name, index]));

const MARK_TEXT: Record<string, string> = { noBreakHyphen: '\u2011', softHyphen: '\u00AD' };
/** Atoms a link may cover: they draw characters (or nothing) and carry no structure. */
const COVERABLE = new Set(['t', 'noBreakHyphen', 'softHyphen', 'sym', 'lastRenderedPageBreak']);
/** Children of a paragraph a link may carry between its runs, as Word itself does (§6.3). */
const CARRIED = new Set(['proofErr', 'bookmarkStart', 'bookmarkEnd']);
const REVISION_CHILDREN = new Set([
  'ins', 'del', 'moveTo', 'moveFrom', 'moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd',
]);
const XML_SPACE = /[ \t\r\n]/;

function compare(a: RunPosition, b: RunPosition): number {
  return a.run - b.run || a.atom - b.atom || a.offset - b.offset;
}

/** The text an atom draws. */
function atomText(atom: RunAtom): string {
  if (atom.ns !== W_NS) return '';
  if (atom.text) return atom.text.decoded;
  if (atom.local === 'sym') return atom.symChar ?? '';
  return MARK_TEXT[atom.local] ?? '';
}

function isInternal(run: RunInfo, position: RunPosition): boolean {
  return !(position.atom === 0 && position.offset === 0) && !(position.atom === run.atoms.length && position.offset === 0);
}

function runSkip(run: RunInfo): DocxLinkSkip | null {
  if (run.context.hyperlink || run.field === 'link') return 'already_linked';
  if (run.context.simpleField || run.field === 'field' || run.fieldPart) return 'in_field';
  if (run.context.revision || run.formatRevision) return 'in_revision';
  if (run.context.contentControl) return 'in_content_control';
  if (run.context.structure || run.ns !== W_NS || run.local !== 'r' || run.declaresNamespace || run.hidden) return 'structure';
  // A part written with WordprocessingML as its default namespace: the writer's attributes (`w:val`) must be
  // qualified, and an unprefixed `val` belongs to no namespace. No producer writes such a part; it is left alone.
  if (!run.prefix) return 'structure';
  if (run.parent.ns !== W_NS || run.parent.local !== 'p') return 'structure';
  return null;
}

function childSkip(child: ParagraphChild): DocxLinkSkip | null {
  if (child.ns !== W_NS) return 'structure';
  if (CARRIED.has(child.local)) return null;
  if (child.local === 'commentRangeStart' || child.local === 'commentRangeEnd') return 'across_comment';
  if (REVISION_CHILDREN.has(child.local)) return 'in_revision';
  if (child.local === 'hyperlink') return 'already_linked';
  if (child.local === 'fldSimple') return 'in_field';
  if (child.local === 'sdt') return 'in_content_control';
  return 'structure';
}

function atomSkip(atom: RunAtom): DocxLinkSkip | null {
  if (atom.ns === W_NS && COVERABLE.has(atom.local)) return null;
  if (atom.ns === W_NS && ['fldChar', 'instrText', 'delInstrText'].includes(atom.local)) return 'in_field';
  return 'structure';
}

/** A `w:t` the writer cuts at `offset`: one plain text token, and a cut that will not change what Word shows. */
function canCut(atom: RunAtom): boolean {
  const text = atom.text;
  if (!text || !text.plain || text.otherSpace) return false;
  // Without `xml:space="preserve"` Word drops the spaces at the element's edges: a half would have to keep them
  // dropped on its outer edge and kept on its inner one, which one element cannot say.
  if (!text.preserve && (XML_SPACE.test(text.decoded[0] ?? '') || XML_SPACE.test(text.decoded[text.decoded.length - 1] ?? ''))) {
    return false;
  }
  return true;
}

/**
 * Whether `link` may be written on `runs`, and why not. Checks the runs and the paragraph's children it covers, the
 * text they spell against the citation's, and the cuts at its edges.
 */
export function checkLink(xml: string, runs: PartRuns, link: PlacedLink): DocxLinkSkip | null {
  const first = runs.runs[link.start.run];
  const last = runs.runs[link.end.run];
  if (!first || !last || compare(link.start, link.end) >= 0) return 'not_in_document';
  for (const run of [first, last]) {
    const skip = runSkip(run);
    if (skip) return skip;
  }
  if (first.parent.start !== last.parent.start) return 'structure';
  const children = runs.paragraphs.get(first.parent.start);
  if (!children) return 'structure';
  const from = children.findIndex(child => child.run === first.index);
  const to = children.findIndex(child => child.run === last.index);
  if (from < 0 || to < from) return 'structure';

  let spelled = '';
  for (let index = from; index <= to; index += 1) {
    const child = children[index];
    if (child.run === undefined) {
      const skip = childSkip(child);
      if (skip) return skip;
      continue;
    }
    const run = runs.runs[child.run];
    const skip = runSkip(run);
    if (skip) return skip;
    const atomFrom = run === first ? link.start.atom : 0;
    const atomTo = run === last ? (link.end.offset > 0 ? link.end.atom + 1 : link.end.atom) : run.atoms.length;
    for (let at = atomFrom; at < atomTo; at += 1) {
      const atom = run.atoms[at];
      const atomSkipReason = atomSkip(atom);
      if (atomSkipReason) return atomSkipReason;
      let text = atomText(atom);
      const cutStart = run === first && at === link.start.atom ? link.start.offset : 0;
      const cutEnd = run === last && at === link.end.atom && link.end.offset > 0 ? link.end.offset : text.length;
      if (cutStart > 0 || cutEnd < text.length) {
        if (!canCut(atom)) return 'structure';
        const raw = xml.slice(atom.text!.openEnd, atom.text!.closeStart);
        if ((cutStart > 0 && rawIndex(raw, cutStart) < 0) || (cutEnd < text.length && rawIndex(raw, cutEnd) < 0)) return 'structure';
      }
      text = text.slice(cutStart, cutEnd);
      spelled += text;
    }
  }
  if (spelled !== link.text) return 'structure';
  return null;
}

/** The index in a plain `w:t`'s raw content where its decoded text reaches `offset`, or -1 inside a reference. */
export function rawIndex(raw: string, offset: number): number {
  let decoded = 0;
  let at = 0;
  while (at < raw.length && decoded < offset) {
    const char = raw[at];
    if (char === '&') {
      const semicolon = raw.indexOf(';', at);
      const body = raw.slice(at + 1, semicolon);
      let units = 1;
      if (body.startsWith('#')) {
        const value = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        units = value > 0xffff ? 2 : 1;
      }
      if (decoded + units > offset) return -1;
      decoded += units;
      at = semicolon + 1;
    } else if (char === '\r') {
      decoded += 1;
      at += raw[at + 1] === '\n' ? 2 : 1;
    } else {
      // A surrogate pair is two units of the decoded text and of the raw alike.
      decoded += 1;
      at += 1;
    }
  }
  return decoded === offset ? at : -1;
}

interface Edit {
  start: number;
  end: number;
  text: string;
  /** At the same place: a link's end before a link's start, both before a run's replacement. */
  order: number;
}

interface Cut {
  position: RunPosition;
  close: boolean;
  open?: PlacedLink;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The link's look as children of `w:rPr`, for a run (§6.4). */
function lookElements(run: RunInfo, look: LinkLook): Array<{ local: string; xml: string }> {
  const p = run.prefix ? `${run.prefix}:` : '';
  if (look.styleId !== null && !run.hasStyle) {
    return [{ local: 'rStyle', xml: `<${p}rStyle ${p}val="${escapeAttribute(look.styleId)}"/>` }];
  }
  const out: Array<{ local: string; xml: string }> = [];
  if (!run.hasColor) out.push({ local: 'color', xml: `<${p}color ${p}val="${LINK_COLOR}" ${p}themeColor="hyperlink"/>` });
  if (!run.hasUnderline) out.push({ local: 'u', xml: `<${p}u ${p}val="single"/>` });
  return out;
}

/** The run's properties with the link's look inserted by the schema's order; `''` stands for none. */
function styledProperties(xml: string, run: RunInfo, look: LinkLook): string {
  const additions = lookElements(run, look);
  const rPr = run.rPr;
  const p = run.prefix ? `${run.prefix}:` : '';
  if (additions.length === 0) return rPr ? xml.slice(rPr.start, rPr.end) : '';
  if (!rPr) return `<${p}rPr>${additions.map(item => item.xml).join('')}</${p}rPr>`;
  if (rPr.selfClosing) {
    const open = xml.slice(rPr.start, rPr.end).replace(/\s*\/>$/, '>');
    return `${open}${additions.map(item => item.xml).join('')}</${rPr.name}>`;
  }
  // Each addition goes before the first child that comes after it in the schema; an element of another namespace (an
  // extension, `w14:…`) counts as after every element of the schema.
  const inserts = new Map<number, string>();
  for (const addition of additions) {
    const index = RPR_INDEX.get(addition.local)!;
    const before = rPr.children.find(child => child.ns !== W_NS || (RPR_INDEX.get(child.local) ?? Infinity) > index);
    const at = before ? before.start : xml.lastIndexOf('</', rPr.end - 1);
    inserts.set(at, (inserts.get(at) ?? '') + addition.xml);
  }
  let out = '';
  let cursor = rPr.start;
  for (const at of [...inserts.keys()].sort((a, b) => a - b)) {
    out += xml.slice(cursor, at) + inserts.get(at);
    cursor = at;
  }
  return out + xml.slice(cursor, rPr.end);
}

/** The `w:hyperlink` open tag for `link`, written where `run` is. */
function openTag(run: RunInfo, link: PlacedLink): string {
  const p = run.prefix ? `${run.prefix}:` : '';
  let relPrefix = run.relPrefix;
  let declaration = '';
  if (!relPrefix) {
    relPrefix = run.rPrefixTaken ? 'vlxr' : 'r';
    declaration = ` xmlns:${relPrefix}="${REL_NS}"`;
  }
  return `<${p}hyperlink${declaration} ${relPrefix}:id="${escapeAttribute(link.relId!)}" ${p}history="1">`;
}

function closeTag(run: RunInfo): string {
  return `</${run.prefix ? `${run.prefix}:` : ''}hyperlink>`;
}

/** The source of a run's body between two positions, cutting a `w:t` where a position falls inside it. */
function bodySlice(xml: string, run: RunInfo, from: RunPosition, to: RunPosition, bodyStart: number): string {
  const sourceAt = (position: RunPosition): number => {
    if (position.atom >= run.atoms.length) return run.closeStart;
    return position.atom === 0 && position.offset === 0 ? bodyStart : run.atoms[position.atom].start;
  };
  const piece = (atom: RunAtom, start: number, end: number): string => {
    const text = atom.text!;
    const raw = xml.slice(text.openEnd, text.closeStart);
    const rawStart = start === 0 ? 0 : rawIndex(raw, start);
    const rawEnd = end === text.decoded.length ? raw.length : rawIndex(raw, end);
    const part = text.decoded.slice(start, end);
    let open = xml.slice(atom.start, text.openEnd);
    if (!text.preserve && (XML_SPACE.test(part[0] ?? '') || XML_SPACE.test(part[part.length - 1] ?? ''))) {
      open = open.replace(/>$/, ' xml:space="preserve">');
    }
    return open + raw.slice(rawStart, rawEnd) + xml.slice(text.closeStart, atom.end);
  };

  if (from.offset > 0 && to.atom === from.atom && to.offset > 0) {
    return piece(run.atoms[from.atom], from.offset, to.offset);
  }
  let out = '';
  let cursor: number;
  if (from.offset > 0) {
    const atom = run.atoms[from.atom];
    out += piece(atom, from.offset, atom.text!.decoded.length);
    cursor = atom.end;
  } else {
    cursor = sourceAt(from);
  }
  if (to.offset > 0) {
    const atom = run.atoms[to.atom];
    out += xml.slice(cursor, atom.start) + piece(atom, 0, to.offset);
  } else {
    out += xml.slice(cursor, sourceAt(to));
  }
  return out;
}

function drawsText(run: RunInfo, from: RunPosition, to: RunPosition): boolean {
  for (let at = from.atom; at < run.atoms.length && (at < to.atom || (at === to.atom && to.offset > 0)); at += 1) {
    const text = atomText(run.atoms[at]);
    const start = at === from.atom ? from.offset : 0;
    const end = at === to.atom ? to.offset : text.length;
    if (end > start) return true;
  }
  return false;
}

/**
 * The part's XML with `links` written. The links are checked (`checkLink`), carry their relationship id, and do not
 * overlap; they are given in any order.
 */
export function spliceLinks(xml: string, runs: PartRuns, links: PlacedLink[], look: LinkLook): string {
  const sorted = [...links].sort((a, b) => compare(a.start, b.start));
  const edits: Edit[] = [];
  /** Internal cuts, by run. */
  const cuts = new Map<number, Cut[]>();
  const touched = new Set<number>();
  const addCut = (cut: Cut) => {
    const list = cuts.get(cut.position.run) ?? [];
    list.push(cut);
    cuts.set(cut.position.run, list);
  };

  for (const link of sorted) {
    const first = runs.runs[link.start.run];
    const last = runs.runs[link.end.run];
    if (isInternal(first, link.start)) addCut({ position: link.start, close: false, open: link });
    else edits.push({ start: first.start, end: first.start, text: openTag(first, link), order: 1 });
    if (isInternal(last, link.end)) addCut({ position: link.end, close: true });
    else edits.push({ start: last.end, end: last.end, text: closeTag(last), order: 0 });
    for (let index = first.index; index <= last.index; index += 1) touched.add(index);
  }

  for (const index of touched) {
    const run = runs.runs[index];
    if (run.selfClosing || run.atoms.length === 0) continue;
    const begin: RunPosition = { run: index, atom: 0, offset: 0 };
    const finish: RunPosition = { run: index, atom: run.atoms.length, offset: 0 };
    let inside = sorted.some(link => compare(link.start, begin) <= 0 && compare(link.end, begin) > 0);
    const runCuts = (cuts.get(index) ?? []).sort((a, b) => compare(a.position, b.position) || (a.close ? -1 : 1));
    const plain = run.rPr ? xml.slice(run.rPr.start, run.rPr.end) : '';
    const styled = styledProperties(xml, run, look);
    const openRun = xml.slice(run.start, run.openEnd);
    const closeRun = xml.slice(run.closeStart, run.end);
    const lead = run.rPr ? xml.slice(run.openEnd, run.rPr.start) : '';
    const bodyStart = run.rPr ? run.rPr.end : run.openEnd;

    // Positions where the run is cut, each with the tags written there.
    const stops: Array<{ position: RunPosition; tags: string; inside: boolean }> = [];
    for (const cut of runCuts) {
      const last = stops[stops.length - 1];
      const tag = cut.close ? closeTag(run) : openTag(run, cut.open!);
      if (last && compare(last.position, cut.position) === 0) {
        last.tags += tag;
        last.inside = !cut.close;
      } else {
        stops.push({ position: cut.position, tags: tag, inside: !cut.close });
      }
    }
    let out = '';
    let from = begin;
    for (let segment = 0; segment <= stops.length; segment += 1) {
      const to = segment < stops.length ? stops[segment].position : finish;
      const properties = inside && drawsText(run, from, to) ? styled : plain;
      out += openRun + (segment === 0 ? lead : '') + properties + bodySlice(xml, run, from, to, bodyStart) + closeRun;
      if (segment < stops.length) {
        out += stops[segment].tags;
        inside = stops[segment].inside;
        from = to;
      }
    }
    const original = xml.slice(run.start, run.end);
    if (out !== original) edits.push({ start: run.start, end: run.end, text: out, order: 2 });
  }

  edits.sort((a, b) => a.start - b.start || a.order - b.order);
  let result = '';
  let cursor = 0;
  for (const edit of edits) {
    result += xml.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return result + xml.slice(cursor);
}
