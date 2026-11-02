/**
 * A copy of a DOCX with hyperlinks on the citations (spec 2026-10-31-document-hyperlinks-design.md §6.2–§6.5, L4).
 * All in the browser: the package is opened with the reader's bounds, the citations are placed on the runs through
 * the reader's character map (`docxText.ts`), the links are spliced into the original XML (`docxSplice.ts`), and the
 * package is written again with every unchanged entry copied raw (`zipWriter.ts`). The original bytes are never
 * changed: the copy is a new array.
 *
 * Changed, and only where a link goes: `word/document.xml`, `word/footnotes.xml`, `word/endnotes.xml`, their
 * relationship parts (created for a part that has none), `word/styles.xml` when it lacks the Hyperlink character
 * style, `[Content_Types].xml` in the rare package with no default for relationship parts.
 */
import { DocxError } from './docxErrors';
import { partRuns, type PartRuns } from './docxRuns';
import { checkLink, spliceLinks, LINK_COLOR, type DocxLinkSkip, type LinkLook, type PlacedLink, type RunPosition } from './docxSplice';
import { DOCUMENT_PART, ENDNOTES_PART, FOOTNOTES_PART, docxText, type DocxCharMap, type DocxOrigin, type DocxPartName } from './docxText';
import { decodePart } from './readDocxPackage';
import { tokenize, type XmlAttribute } from './xmlTokens';
import { writeZip, type ZipAddition } from './zipWriter';
import { checkReadable, findEntry, openZip, readEntry, type ZipEntry, type ZipPackage } from './zipPackage';
import { sourceAddress } from '../../../../utils/normattivaLink';

export type { DocxLinkSkip } from './docxSplice';

/** A citation to link: characters `[start, end)` of the reading's text, and the address it links to. */
export interface DocxLinkRequest {
  start: number;
  end: number;
  href: string;
}

export type DocxLinkOutcome =
  | { linked: true; part: DocxPartName; relId: string }
  | { linked: false; reason: DocxLinkSkip };

export interface DocxLinkedCopy {
  /** The new package. */
  bytes: Uint8Array;
  /** One per request, in the order asked. */
  outcomes: DocxLinkOutcome[];
  linked: number;
}

export interface DocxWriteOptions {
  /**
   * The text the requests' offsets count in, as the reader gave it. The copy is refused (`malformed`) when the file
   * reads otherwise now: offsets into another text would land on other words.
   */
  expectedText?: string;
}

export const HYPERLINK_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const RELS_CONTENT_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';
const CONTENT_TYPES_PART = '[Content_Types].xml';
const STYLES_PART = 'word/styles.xml';
/** The marks a link never crosses: a tab, a break, a paragraph's end (§6.5). */
const BREAKING_MARKS = new Set(['tab', 'ptab', 'br', 'cr', 'p']);

type Encoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be';

interface Part {
  entry: ZipEntry;
  xml: string;
  encoding: Encoding;
}

function encodingOf(bytes: Uint8Array): Encoding {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8-bom';
  return 'utf-8';
}

/** The part's text back to bytes, in the encoding it came in (its byte-order mark included). */
export function encodePart(xml: string, encoding: Encoding): Uint8Array {
  if (encoding === 'utf-8') return new TextEncoder().encode(xml);
  if (encoding === 'utf-8-bom') return new TextEncoder().encode(`\uFEFF${xml}`);
  const out = new Uint8Array((xml.length + 1) * 2);
  const little = encoding === 'utf-16le';
  const text = `\uFEFF${xml}`;
  for (let at = 0; at < text.length; at += 1) {
    const unit = text.charCodeAt(at);
    out[at * 2] = little ? unit & 0xff : unit >> 8;
    out[at * 2 + 1] = little ? unit >> 8 : unit & 0xff;
  }
  return out;
}

async function readPart(pkg: ZipPackage, entry: ZipEntry | undefined): Promise<Part | undefined> {
  if (!entry) return undefined;
  const bytes = await readEntry(pkg, entry);
  return { entry, xml: decodePart(bytes), encoding: encodingOf(bytes) };
}

/** `word/_rels/document.xml.rels` for `word/document.xml`, keeping the entry's own spelling. */
export function relsName(partName: string): string {
  const slash = partName.lastIndexOf('/');
  return `${partName.slice(0, slash + 1)}_rels/${partName.slice(slash + 1)}.rels`;
}

function attribute(attributes: XmlAttribute[], local: string): string | undefined {
  for (const { name, value } of attributes) {
    if (name === local || name.endsWith(`:${local}`)) return value;
  }
  return undefined;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The root element of `xml`: its name, where its open tag ends, where its close tag starts (`-1`: self-closed). */
function rootOf(xml: string): { name: string; openStart: number; openEnd: number; closeStart: number; attributes: XmlAttribute[] } {
  let root: { name: string; openStart: number; openEnd: number; closeStart: number; attributes: XmlAttribute[] } | null = null;
  let depth = 0;
  for (const token of tokenize(xml)) {
    if (token.type === 'open') {
      if (depth === 0) root = { name: token.name, openStart: token.start, openEnd: token.end, closeStart: -1, attributes: token.attributes };
      if (!token.selfClosing) depth += 1;
    } else if (token.type === 'close') {
      depth -= 1;
      if (depth === 0 && root) root.closeStart = token.start;
    }
  }
  if (!root) throw new DocxError('malformed', 'no root');
  return root;
}

/** Inserts `inner` as the last children of the root element (a self-closed root is opened). */
function appendToRoot(xml: string, inner: string): string {
  const root = rootOf(xml);
  if (root.closeStart >= 0) return xml.slice(0, root.closeStart) + inner + xml.slice(root.closeStart);
  const open = xml.slice(root.openStart, root.openEnd).replace(/\s*\/>$/, '>');
  return xml.slice(0, root.openStart) + open + inner + `</${root.name}>` + xml.slice(root.openEnd);
}

function prefixOf(name: string): string {
  const colon = name.indexOf(':');
  return colon < 0 ? '' : `${name.slice(0, colon)}:`;
}

/** The ids of a relationship part's relationships, lowercased. */
function relationshipIds(xml: string): Set<string> {
  const ids = new Set<string>();
  for (const token of tokenize(xml)) {
    if (token.type !== 'open') continue;
    const id = token.attributes.find(attr => attr.name === 'Id')?.value;
    if (id) ids.add(id.toLowerCase());
  }
  return ids;
}

interface StylesInfo {
  /** The id of the character style named Hyperlink, when there is one. */
  hyperlinkId: string | null;
  /** Every style id, lowercased. */
  ids: Set<string>;
  /** The default character style's id (Word's «Carattere predefinito paragrafo»), for `w:basedOn`. */
  defaultCharacterId: string | null;
}

export function readStyles(xml: string): StylesInfo {
  const ids = new Set<string>();
  let hyperlinkId: string | null = null;
  let defaultCharacterId: string | null = null;
  let current: { id: string | undefined; character: boolean } | null = null;
  let depth = 0;
  for (const token of tokenize(xml)) {
    if (token.type === 'open') {
      const local = token.name.slice(token.name.indexOf(':') + 1);
      if (depth === 1 && local === 'style') {
        const id = attribute(token.attributes, 'styleId');
        const character = attribute(token.attributes, 'type') === 'character';
        if (id) ids.add(id.toLowerCase());
        if (character && id && ['1', 'true', 'on'].includes(attribute(token.attributes, 'default') ?? '')) defaultCharacterId = id;
        current = token.selfClosing ? null : { id, character };
      } else if (depth === 2 && current && local === 'name') {
        if (current.character && current.id && hyperlinkId === null
          && (attribute(token.attributes, 'val') ?? '').toLowerCase() === 'hyperlink') {
          hyperlinkId = current.id;
        }
      }
      if (!token.selfClosing) depth += 1;
    } else if (token.type === 'close') {
      depth -= 1;
      if (depth === 1) current = null;
    }
  }
  return { hyperlinkId, ids, defaultCharacterId };
}

/** The Hyperlink character style as Word adds it, under a free id (§6.4). */
export function hyperlinkStyle(prefix: string, styles: StylesInfo): { id: string; xml: string } {
  let id = 'Hyperlink';
  for (let n = 1; styles.ids.has(id.toLowerCase()); n += 1) id = n === 1 ? 'HyperlinkVlx' : `HyperlinkVlx${n}`;
  const p = prefix;
  const basedOn = styles.defaultCharacterId ? `<${p}basedOn ${p}val="${escapeAttribute(styles.defaultCharacterId)}"/>` : '';
  return {
    id,
    xml: `<${p}style ${p}type="character" ${p}styleId="${id}"><${p}name ${p}val="Hyperlink"/>${basedOn}`
      + `<${p}uiPriority ${p}val="99"/><${p}unhideWhenUsed/>`
      + `<${p}rPr><${p}color ${p}val="${LINK_COLOR}" ${p}themeColor="hyperlink"/><${p}u ${p}val="single"/></${p}rPr></${p}style>`,
  };
}

/** The segments of the map that cover `[start, end)`, in order. */
function segmentsIn(map: DocxCharMap, start: number, end: number) {
  let low = 0;
  let high = map.segments.length - 1;
  let first = map.segments.length;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (map.segments[middle].end > start) {
      first = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  const out = [];
  for (let index = first; index < map.segments.length && map.segments[index].start < end; index += 1) out.push(map.segments[index]);
  return out;
}

type Placement = { part: DocxPartName; start: RunPosition; end: RunPosition } | { skip: DocxLinkSkip };

/** Where a citation lies in the runs of its part, through the reader's map. */
function place(map: DocxCharMap, runsByPart: Map<DocxPartName, PartRuns>, start: number, end: number): Placement {
  const segments = segmentsIn(map, start, end);
  if (segments.length === 0 || segments[0].start > start || segments[segments.length - 1].end < end) return { skip: 'not_in_document' };
  let part: DocxPartName | null = null;
  for (let index = 0; index < segments.length; index += 1) {
    if (index > 0 && segments[index].start !== segments[index - 1].end) return { skip: 'structure' };
    const origin = map.origins[segments[index].origin];
    if (origin.kind === 'added') return { skip: 'not_in_document' };
    if (origin.kind === 'mark' && BREAKING_MARKS.has(origin.element)) return { skip: 'structure' };
    if (part !== null && origin.part !== part) return { skip: 'structure' };
    part = origin.part;
  }
  const runs = runsByPart.get(part!);
  if (!runs) return { skip: 'structure' };

  const position = (origin: DocxOrigin, offset: number, after: boolean): RunPosition | null => {
    if (origin.kind === 'added') return null;
    const run = runs.runByStart.get(origin.runStart);
    if (!run) return null;
    const atom = run.atoms.findIndex(item => item.start === origin.tagStart);
    if (atom < 0) return null;
    if (origin.kind === 'mark') return { run: run.index, atom: after ? atom + 1 : atom, offset: 0 };
    const at = after ? offset + 1 : offset;
    const length = run.atoms[atom].text?.decoded.length ?? 0;
    if (at === 0) return { run: run.index, atom, offset: 0 };
    if (at === length) return { run: run.index, atom: atom + 1, offset: 0 };
    return { run: run.index, atom, offset: at };
  };
  const firstSegment = segments[0];
  const lastSegment = segments[segments.length - 1];
  const from = position(map.origins[firstSegment.origin], firstSegment.offset + start - firstSegment.start, false);
  const to = position(map.origins[lastSegment.origin], lastSegment.offset + end - 1 - lastSegment.start, true);
  if (!from || !to) return { skip: 'structure' };
  return { part: part!, start: from, end: to };
}

const PARTS: DocxPartName[] = [DOCUMENT_PART, FOOTNOTES_PART, ENDNOTES_PART];

/**
 * Writes a copy of the DOCX in `bytes` with a hyperlink on each citation of `requests` that can take one, and says
 * for each what was done. A signed package is refused (`signed`): a changed copy would lose the signature.
 */
export async function writeDocxLinks(
  bytes: Uint8Array,
  requests: DocxLinkRequest[],
  options: DocxWriteOptions = {},
): Promise<DocxLinkedCopy> {
  const pkg = openZip(bytes);
  if (pkg.entries.some(entry => entry.name.toLowerCase().startsWith('_xmlsignatures/'))) throw new DocxError('signed');
  const document = findEntry(pkg, DOCUMENT_PART);
  if (!document) throw new DocxError('no_document');
  const entries = new Map<DocxPartName, ZipEntry>();
  for (const name of PARTS) {
    const entry = findEntry(pkg, name);
    if (entry) entries.set(name, entry);
  }
  const relsEntries = new Map<DocxPartName, ZipEntry>();
  for (const [name, entry] of entries) {
    const rels = findEntry(pkg, relsName(entry.name));
    if (rels) relsEntries.set(name, rels);
  }
  const stylesEntry = findEntry(pkg, STYLES_PART);
  const typesEntry = findEntry(pkg, CONTENT_TYPES_PART);
  checkReadable([...entries.values(), ...relsEntries.values(), stylesEntry, typesEntry]
    .filter((entry): entry is ZipEntry => entry !== undefined));

  const parts = new Map<DocxPartName, Part>();
  for (const [name, entry] of entries) parts.set(name, (await readPart(pkg, entry))!);
  const reading = docxText({
    document: parts.get(DOCUMENT_PART)!.xml,
    footnotes: parts.get(FOOTNOTES_PART)?.xml,
    endnotes: parts.get(ENDNOTES_PART)?.xml,
  });
  if (options.expectedText !== undefined && options.expectedText !== reading.text) {
    throw new DocxError('malformed', 'the file reads otherwise than the text the citations count in');
  }

  const runsByPart = new Map<DocxPartName, PartRuns>();
  for (const [name, part] of parts) runsByPart.set(name, partRuns(part.xml));

  // Place and check each request, in the text's order; a request overlapping one already accepted is refused.
  const outcomes: DocxLinkOutcome[] = new Array(requests.length);
  const accepted = new Map<DocxPartName, Array<{ request: number; link: PlacedLink; href: string }>>();
  const order = requests.map((_, index) => index).sort((a, b) => requests[a].start - requests[b].start || a - b);
  let reachedUntil = -1;
  for (const index of order) {
    const request = requests[index];
    const href = sourceAddress(request.href);
    // Written as the server sent it, so nothing a URL parser would drop or read otherwise: no space, no control
    // character, no backslash.
    if (!href || /[\s\\]/.test(href) || [...href].some(char => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) {
      outcomes[index] = { linked: false, reason: 'invalid_address' };
      continue;
    }
    if (!Number.isInteger(request.start) || !Number.isInteger(request.end)
      || request.start < 0 || request.end > reading.text.length || request.start >= request.end
      || isLowSurrogate(reading.text.charCodeAt(request.start)) || isHighSurrogate(reading.text.charCodeAt(request.end - 1))) {
      outcomes[index] = { linked: false, reason: 'not_in_document' };
      continue;
    }
    if (request.start < reachedUntil) {
      outcomes[index] = { linked: false, reason: 'overlap' };
      continue;
    }
    const placement = place(reading.map, runsByPart, request.start, request.end);
    if ('skip' in placement) {
      outcomes[index] = { linked: false, reason: placement.skip };
      continue;
    }
    const link: PlacedLink = { start: placement.start, end: placement.end, text: reading.text.slice(request.start, request.end) };
    const skip = checkLink(parts.get(placement.part)!.xml, runsByPart.get(placement.part)!, link);
    if (skip) {
      outcomes[index] = { linked: false, reason: skip };
      continue;
    }
    reachedUntil = request.end;
    const list = accepted.get(placement.part) ?? [];
    list.push({ request: index, link, href });
    accepted.set(placement.part, list);
  }

  const changed = new Map<string, Uint8Array>();
  const added: ZipAddition[] = [];
  let linked = 0;
  if (accepted.size > 0) {
    // The link's look: the Hyperlink character style, found by its name or added; with no styles part, direct
    // formatting on the runs (§6.4).
    const look: LinkLook = { styleId: null };
    const styles = await readPart(pkg, stylesEntry);
    if (styles) {
      const info = readStyles(styles.xml);
      if (info.hyperlinkId) {
        look.styleId = info.hyperlinkId;
      } else if (prefixOf(rootOf(styles.xml).name)) {
        const style = hyperlinkStyle(prefixOf(rootOf(styles.xml).name), info);
        look.styleId = style.id;
        changed.set(styles.entry.name.toLowerCase(), encodePart(appendToRoot(styles.xml, style.xml), styles.encoding));
      }
      // A styles part in the default namespace gets no style (its attributes would be unqualified): the links take
      // the colour and underline on their runs, as with no styles part.
    }

    let relsCreated = false;
    for (const [name, list] of accepted) {
      const part = parts.get(name)!;
      const rels = await readPart(pkg, relsEntries.get(name));
      const used = rels ? relationshipIds(rels.xml) : new Set<string>();
      let next = 1;
      let relationships = '';
      const relsPrefix = rels ? prefixOf(rootOf(rels.xml).name) : '';
      for (const item of list) {
        while (used.has(`ridvlx${next}`)) next += 1;
        const relId = `rIdVlx${next}`;
        used.add(relId.toLowerCase());
        item.link.relId = relId;
        relationships += `<${relsPrefix}Relationship Id="${relId}" Type="${HYPERLINK_REL_TYPE}" Target="${escapeAttribute(item.href)}" TargetMode="External"/>`;
        outcomes[item.request] = { linked: true, part: name, relId };
        linked += 1;
      }
      const xml = spliceLinks(part.xml, runsByPart.get(name)!, list.map(item => item.link), look);
      changed.set(part.entry.name.toLowerCase(), encodePart(xml, part.encoding));
      if (rels) {
        changed.set(rels.entry.name.toLowerCase(), encodePart(appendToRoot(rels.xml, relationships), rels.encoding));
      } else {
        const xmlRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="${RELS_NS}">${relationships}</Relationships>`;
        added.push({ name: relsName(part.entry.name), data: new TextEncoder().encode(xmlRels) });
        relsCreated = true;
      }
    }

    if (relsCreated) {
      const types = await readPart(pkg, typesEntry);
      if (types && !hasRelsDefault(types.xml)) {
        const root = rootOf(types.xml);
        const p = prefixOf(root.name);
        const insert = `<${p}Default Extension="rels" ContentType="${RELS_CONTENT_TYPE}"/>`;
        const xml = root.closeStart >= 0
          ? types.xml.slice(0, root.openEnd) + insert + types.xml.slice(root.openEnd)
          : appendToRoot(types.xml, insert);
        changed.set(types.entry.name.toLowerCase(), encodePart(xml, types.encoding));
      }
    }
  }

  return { bytes: await writeZip(pkg, changed, added), outcomes, linked };
}

/** A range that starts or ends inside a surrogate pair would cut a character in two. */
function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

function hasRelsDefault(xml: string): boolean {
  for (const token of tokenize(xml)) {
    if (token.type !== 'open' || !token.name.endsWith('Default')) continue;
    if ((token.attributes.find(attr => attr.name === 'Extension')?.value ?? '').toLowerCase() === 'rels') return true;
  }
  return false;
}
