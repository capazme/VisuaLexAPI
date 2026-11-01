/**
 * The DOCX writer (spec 2026-10-31-document-hyperlinks-design.md §6.2–§6.5, §10.2, L4), on the invented fixture
 * `docx/links/` and variants of it: the round trip proved part by part, the untouched cases reported, the look.
 *
 * With `DOCX_ROUNDTRIP_OUT=<folder>` the copies are also written there, for `tools/e2e/docx-roundtrip/` to open in
 * LibreOffice (not in CI, which has none).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sourceAddress } from '../../../../utils/normattivaLink';
import { DocxError } from '../docx/docxErrors';
import { partRuns } from '../docx/docxRuns';
import { LINK_COLOR, RPR_ORDER, rawIndex } from '../docx/docxSplice';
import { DOCUMENT_PART, locateChar } from '../docx/docxText';
import { readDocxBytes } from '../docx/readDocxPackage';
import { HYPERLINK_REL_TYPE, readStyles, relsName, writeDocxLinks, type DocxLinkOutcome, type DocxLinkRequest } from '../docx/writeDocxPackage';
import { tokenize } from '../docx/xmlTokens';
import { writeZip } from '../docx/zipWriter';
import { checkReadable, openZip, readEntry, type ZipEntry, type ZipPackage } from '../docx/zipPackage';
import { buildZip, fixtureParts, type ZipInput } from './docxZip';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const art = (article: string) => `https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art${article}!vig=`;
const LAW_241 = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241~art7!vig=';
/** Parts the writer may change (§6.2); every other entry must come out byte for byte. */
const CHANGEABLE = new Set([
  'word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml', 'word/_rels/document.xml.rels',
  'word/_rels/footnotes.xml.rels', 'word/_rels/endnotes.xml.rels', 'word/styles.xml', '[content_types].xml',
]);

type Parts = Record<string, string | Uint8Array>;

function linksParts(): Parts {
  return fixtureParts('links');
}

function zip(parts: Parts, extra: (name: string) => Partial<ZipInput> = () => ({})): Uint8Array {
  return buildZip(Object.entries(parts).map(([name, data]) => ({ name, data, ...extra(name) })));
}

async function unpack(bytes: Uint8Array): Promise<{ pkg: ZipPackage; parts: Map<string, string> }> {
  const pkg = openZip(bytes);
  checkReadable(pkg.entries);
  const parts = new Map<string, string>();
  for (const entry of pkg.entries) parts.set(entry.name, new TextDecoder().decode(await readEntry(pkg, entry)));
  return { pkg, parts };
}

/** Requests for the `occurrence`-th appearance of each phrase in the text as read. */
async function requests(bytes: Uint8Array, citations: Array<[string, string, number?]>): Promise<DocxLinkRequest[]> {
  const { text } = await readDocxBytes(bytes);
  return citations.map(([phrase, href, occurrence = 0]) => {
    let at = -1;
    for (let n = 0; n <= occurrence; n += 1) at = text.indexOf(phrase, at + 1);
    if (at < 0) throw new Error(`no «${phrase}» in the text`);
    return { start: at, end: at + phrase.length, href };
  });
}

const LINKED: Array<[string, string, number?]> = [
  ['art. 2043 c.c.', art('2043')],
  ['artt. 1223', art('1223')],
  ['1225 c.c.', art('1225')],
  ['art. 18 l. 300/1970', 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1970-05-20;300~art18!vig='],
  ['art. 1453 c.c.', art('1453')],
  ['art. 1455 c.c.', art('1455')],
  ['art. 3 d.lgs. 23/2015', 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2015-03-04;23~art3!vig='],
  ['art. 21‑bis l. 241/1990', 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241~art21bis!vig='],
  ['art. 2 c.p.', 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1930-10-19;1398~art2!vig='],
  ['art. 7 l. 241/1990', LAW_241],
  ['art. 2697 c.c.', art('2697')],
];

const UNTOUCHED: Array<[string, DocxLinkOutcome & { linked: false }]> = [
  ['art. 1 c.c.', { linked: false, reason: 'already_linked' }],
  ['art. 2 c.c.', { linked: false, reason: 'already_linked' }],
  ['art. 3 c.c.', { linked: false, reason: 'in_field' }],
  ['art. 4 c.c.', { linked: false, reason: 'in_field' }],
  ['art. 5 c.c.', { linked: false, reason: 'in_revision' }],
  ['art. 6 c.c.', { linked: false, reason: 'in_revision' }],
  ['art. 8 c.c.', { linked: false, reason: 'in_content_control' }],
  ['art. 9 c.c.', { linked: false, reason: 'across_comment' }],
  ['art.\t10 c.c.', { linked: false, reason: 'structure' }],
  ['art. 11 c.c.', { linked: false, reason: 'structure' }],
  ['art. 12 c.c.', { linked: false, reason: 'structure' }],
  ['art. 13 c.c.', { linked: false, reason: 'in_revision' }],
  ['art. 14 c.c.', { linked: false, reason: 'in_revision' }],
  ['art. 15 c.c.', { linked: false, reason: 'structure' }],
];

// ── The proofs of §10.2, as functions any copy can be held to ──────────────────────────────────────────────────

/** Where an entry's raw bytes end: after its data descriptor when it has one. */
function rawEnd(pkg: ZipPackage, entry: ZipEntry): number {
  const end = entry.dataOffset + entry.compressedSize;
  if (!(entry.flags & 0x8)) return end;
  const view = new DataView(pkg.bytes.buffer, pkg.bytes.byteOffset, pkg.bytes.byteLength);
  return end + (view.getUint32(end, true) === 0x08074b50 ? 16 : 12);
}

/** 1. Every entry not in §6.2's list: its local header, data and descriptor, and its central record, unchanged. */
function expectRawCopies(input: ZipPackage, output: ZipPackage): void {
  for (const entry of input.entries) {
    if (CHANGEABLE.has(entry.name.toLowerCase())) continue;
    const copy = output.byName.get(entry.name.toLowerCase());
    expect(copy, entry.name).toBeDefined();
    const before = input.bytes.subarray(entry.localOffset, rawEnd(input, entry));
    const after = output.bytes.subarray(copy!.localOffset, rawEnd(output, copy!));
    expect(Buffer.from(after).equals(Buffer.from(before)), entry.name).toBe(true);
    const centralBefore = input.bytes.slice(entry.centralOffset, entry.centralOffset + entry.centralLength);
    const centralAfter = output.bytes.slice(copy!.centralOffset, copy!.centralOffset + copy!.centralLength);
    centralBefore.fill(0, 42, 46);
    centralAfter.fill(0, 42, 46);
    expect(Buffer.from(centralAfter).equals(Buffer.from(centralBefore)), `${entry.name} central`).toBe(true);
  }
}

const LOOK = [`<w:color w:val="${LINK_COLOR}" w:themeColor="hyperlink"/>`, '<w:u w:val="single"/>'];

/** A run's properties as written, with the link's look taken away where the input run did not have it. */
function withoutLook(output: string, input: string, styleId: string | null): string {
  let out = output;
  const additions = [...LOOK, ...(styleId ? [`<w:rStyle w:val="${styleId}"/>`] : [])];
  for (const addition of additions) if (!input.includes(addition)) out = out.replace(addition, '');
  return out === '<w:rPr></w:rPr>' && input === '' ? '' : out;
}

/** 3. Per character, the run's properties are the input's once the link's look is taken away. */
async function expectSameFormatting(input: Uint8Array, output: Uint8Array, styleId: string | null, linked: DocxLinkRequest[]): Promise<void> {
  const before = await readDocxBytes(input);
  const after = await readDocxBytes(output);
  const xmlBefore = (await unpack(input)).parts;
  const xmlAfter = (await unpack(output)).parts;
  const runsOf = (parts: Map<string, string>) => new Map([...parts].filter(([name]) => name.startsWith('word/') && name.endsWith('.xml'))
    .map(([name, xml]) => [name, { xml, runs: partRuns(xml) }]));
  const runsBefore = runsOf(xmlBefore);
  const runsAfter = runsOf(xmlAfter);
  const propertiesAt = (reading: typeof before, table: typeof runsBefore, index: number): string | null => {
    const where = locateChar(reading.map, index);
    if (!where || where.origin.kind === 'added') return null;
    const { xml, runs } = table.get(where.origin.part)!;
    if (where.origin.runStart < 0) return `mark ${where.origin.kind === 'mark' ? where.origin.element : ''}`;
    const run = runs.runByStart.get(where.origin.runStart)!;
    return run.rPr ? xml.slice(run.rPr.start, run.rPr.end) : '';
  };
  for (let index = 0; index < before.text.length; index += 1) {
    const a = propertiesAt(before, runsBefore, index);
    const b = propertiesAt(after, runsAfter, index);
    if (a === null) {
      expect(b).toBeNull();
      continue;
    }
    // Inside a link the look may be added; anywhere else the properties are the input's, exactly.
    const inLink = linked.some(range => index >= range.start && index < range.end);
    expect(inLink ? withoutLook(b!, a, styleId) : b, `character ${index} «${before.text[index]}»`).toBe(a);
  }
}

/**
 * 4. The part's normal form: the inserted `w:hyperlink` wrappers taken out, the link's look and every
 * `xml:space="preserve"` taken away, then each run merged with the next when they are written alike. A copy and its
 * original must have the same.
 */
function normalForm(xml: string, relIds: Set<string>, styleId: string | null): string {
  let out = '';
  let cursor = 0;
  const removed: boolean[] = [];
  for (const token of tokenize(xml)) {
    if (token.type === 'open' && token.name === 'w:hyperlink') {
      const remove = relIds.has(token.attributes.find(attr => attr.name.endsWith(':id'))?.value ?? '');
      if (!token.selfClosing) removed.push(remove);
      if (remove) { out += xml.slice(cursor, token.start); cursor = token.end; }
    } else if (token.type === 'close' && token.name === 'w:hyperlink') {
      if (removed.pop()) { out += xml.slice(cursor, token.start); cursor = token.end; }
    }
  }
  out += xml.slice(cursor);
  for (const look of [...LOOK, ...(styleId ? [`<w:rStyle w:val="${styleId}"/>`] : [])]) out = out.split(look).join('');
  out = out.split('<w:rPr></w:rPr>').join('').split(' xml:space="preserve"').join('');
  for (;;) {
    const runs = partRuns(out).runs;
    let merged = false;
    for (let index = 0; index + 1 < runs.length; index += 1) {
      const a = runs[index];
      const b = runs[index + 1];
      if (a.end !== b.start || a.parent.start !== b.parent.start) continue;
      const head = (run: typeof a) => out.slice(run.start, run.rPr ? run.rPr.end : run.openEnd);
      const lastAtom = a.atoms[a.atoms.length - 1];
      const firstAtom = b.atoms[0];
      if (head(a) !== head(b) || !lastAtom?.text || !firstAtom?.text) continue;
      out = out.slice(0, lastAtom.text.closeStart) + out.slice(firstAtom.text.openEnd);
      merged = true;
      break;
    }
    if (!merged) break;
  }
  return out;
}

/** 8. Every `w:rPr` has its children in the schema's order (extensions of other namespaces last). */
function expectPropertiesInOrder(xml: string, part: string): void {
  for (const run of partRuns(xml).runs) {
    if (!run.rPr) continue;
    let last = -1;
    let foreign = false;
    for (const child of run.rPr.children) {
      if (child.ns !== W_NS) { foreign = true; continue; }
      const index = (RPR_ORDER as readonly string[]).indexOf(child.local);
      expect(index, `${part}: ${child.local} unknown`).toBeGreaterThanOrEqual(0);
      expect(index, `${part}: ${xml.slice(run.rPr.start, run.rPr.end)}`).toBeGreaterThan(last);
      if (child.local !== 'rPrChange') expect(foreign, `${part}: ${child.local} after an extension`).toBe(false);
      last = index;
    }
  }
}

const DRAWN: Record<string, string> = { noBreakHyphen: '\u2011', softHyphen: '\u00AD' };

/** The text inside each inserted `w:hyperlink`, by its relationship id. */
function linkTexts(xml: string, relIds: Set<string>): Map<string, string> {
  const ranges: Array<{ id: string; start: number; end: number }> = [];
  const open: Array<{ id: string; start: number } | null> = [];
  for (const token of tokenize(xml)) {
    if (token.type === 'open' && token.name === 'w:hyperlink' && !token.selfClosing) {
      const id = token.attributes.find(attr => attr.name.endsWith(':id'))?.value ?? '';
      open.push(relIds.has(id) ? { id, start: token.end } : null);
    } else if (token.type === 'close' && token.name === 'w:hyperlink') {
      const top = open.pop();
      if (top) ranges.push({ ...top, end: token.start });
    }
  }
  const texts = new Map<string, string>();
  const runs = partRuns(xml).runs;
  for (const range of ranges) {
    let text = '';
    for (const run of runs) {
      if (run.start < range.start || run.end > range.end) continue;
      for (const atom of run.atoms) text += atom.text?.decoded ?? atom.symChar ?? DRAWN[atom.local] ?? '';
    }
    texts.set(range.id, text);
  }
  return texts;
}

async function expectRoundTrip(
  input: Uint8Array, output: Uint8Array, asked: DocxLinkRequest[], outcomes: DocxLinkOutcome[], styleId: string | null,
): Promise<void> {
  const before = await unpack(input);
  const after = await unpack(output);
  expectRawCopies(before.pkg, after.pkg);
  // 2. The same text, character for character.
  const reading = await readDocxBytes(input);
  expect((await readDocxBytes(output)).text).toBe(reading.text);
  const linked = asked.filter((_, index) => outcomes[index].linked);
  await expectSameFormatting(input, output, styleId, linked);
  const relIds = new Set(outcomes.flatMap(outcome => (outcome.linked ? [outcome.relId] : [])));
  // §6.3: each link's text is exactly its citation's, and each linked citation has its link.
  outcomes.forEach((outcome, index) => {
    if (!outcome.linked) return;
    const texts = linkTexts(after.parts.get(outcome.part)!, new Set([outcome.relId]));
    expect(texts.get(outcome.relId), `${outcome.part} ${outcome.relId}`).toBe(reading.text.slice(asked[index].start, asked[index].end));
  });
  for (const part of ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml']) {
    const original = before.parts.get(part);
    const copy = after.parts.get(part);
    if (original === undefined) continue;
    expect(normalForm(copy!, relIds, styleId), part).toBe(normalForm(original, relIds, styleId));
    expectPropertiesInOrder(copy!, part);
    // A half that starts or ends with a space keeps it.
    for (const run of partRuns(copy!).runs) {
      for (const atom of run.atoms) {
        if (atom.text && /^\s|\s$/.test(atom.text.decoded) && !before.parts.get(part)!.includes(copy!.slice(atom.start, atom.end))) {
          expect(atom.text.preserve, `${part}: «${atom.text.decoded}»`).toBe(true);
        }
      }
    }
  }
  // 5. Each inserted relationship: external, its id unique in its part, its target an address of the two sources.
  for (const [name, xml] of after.parts) {
    if (!name.endsWith('.rels')) continue;
    const ids = new Set<string>();
    for (const token of tokenize(xml)) {
      if (token.type !== 'open' || !token.name.endsWith('Relationship')) continue;
      const attr = (key: string) => token.attributes.find(item => item.name === key)?.value;
      expect(ids.has(attr('Id')!.toLowerCase()), `${name}: ${attr('Id')}`).toBe(false);
      ids.add(attr('Id')!.toLowerCase());
      if (relIds.has(attr('Id')!) && !(before.parts.get(name) ?? '').includes(`Id="${attr('Id')}"`)) {
        expect(attr('Type')).toBe(HYPERLINK_REL_TYPE);
        expect(attr('TargetMode')).toBe('External');
        expect(sourceAddress(attr('Target'))).toBe(attr('Target'));
      }
    }
  }
  // 8. No two styles share an id.
  const styles = after.parts.get('word/styles.xml');
  if (styles) {
    const ids = [...styles.matchAll(/w:styleId="([^"]+)"/g)].map(match => match[1].toLowerCase());
    expect(new Set(ids).size).toBe(ids.length);
  }
}

/** With `DOCX_ROUNDTRIP_OUT`, the input, the copy and the addresses linked, for the LibreOffice script. */
function saveForLibreOffice(name: string, input: Uint8Array, output: Uint8Array, asked: DocxLinkRequest[], outcomes: DocxLinkOutcome[]): void {
  const folder = process.env.DOCX_ROUNDTRIP_OUT;
  if (!folder) return;
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `${name}.input.docx`), input);
  writeFileSync(join(folder, `${name}.docx`), output);
  const links = asked.filter((_, index) => outcomes[index].linked).map(request => request.href);
  writeFileSync(join(folder, `${name}.json`), JSON.stringify({ links }, null, 2));
}

async function writeAll(parts: Parts, citations = LINKED) {
  const input = zip(parts);
  const asked = await requests(input, [...citations, ...UNTOUCHED.map(([phrase]) => [phrase, art('1')] as [string, string])]);
  const result = await writeDocxLinks(input, asked);
  return { input, asked, result };
}

// ── The tests ──────────────────────────────────────────────────────────────────────────────────────────────────

describe('writeDocxLinks — the fixture with every structure (§10.2)', () => {
  it('links each citation it can, and leaves each other one alone with its reason', async () => {
    const { input, asked, result } = await writeAll(linksParts());
    expect(result.outcomes.slice(0, LINKED.length).map((outcome, index) => [LINKED[index][0], outcome.linked]))
      .toEqual(LINKED.map(([phrase]) => [phrase, true]));
    expect(result.outcomes.slice(LINKED.length).map((outcome, index) => [UNTOUCHED[index][0], outcome]))
      .toEqual(UNTOUCHED.map(([phrase, outcome]) => [phrase, outcome]));
    expect(result.linked).toBe(LINKED.length);
    saveForLibreOffice('links', input, result.bytes, asked, result.outcomes);
  });

  it('proves the round trip: raw copies, the same text, the same formatting, the original under the links', async () => {
    const { input, asked, result } = await writeAll(linksParts());
    await expectRoundTrip(input, result.bytes, asked, result.outcomes, 'Collegamentoipertestuale');
  });

  it('writes a citation across three runs as one link, each half keeping its run’s properties', async () => {
    const { result } = await writeAll(linksParts());
    const xml = (await unpack(result.bytes)).parts.get(DOCUMENT_PART)!;
    const id = (result.outcomes[0] as { relId: string }).relId;
    expect(id).toBe('rIdVlx2'); // rIdVlx1 is already in the part's relationships
    expect(xml).toContain(
      '<w:r w:rsidRPr="00D4E5F6"><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">Ai sensi dell\'</w:t></w:r>'
      + `<w:hyperlink r:id="${id}" w:history="1">`
      + '<w:r w:rsidRPr="00D4E5F6"><w:rPr><w:rStyle w:val="Collegamentoipertestuale"/><w:i/></w:rPr><w:t xml:space="preserve">art. </w:t></w:r>'
      + '<w:proofErr w:type="spellStart"/>'
      + '<w:r w:rsidRPr="00D4E5F6"><w:rPr><w:rStyle w:val="Collegamentoipertestuale"/><w:b/><w:i/></w:rPr><w:t>2043</w:t></w:r>'
      + '<w:proofErr w:type="spellEnd"/><w:bookmarkStart w:id="0" w:name="_GoBack"/><w:bookmarkEnd w:id="0"/>'
      + '<w:r w:rsidRPr="00D4E5F6"><w:rPr><w:rStyle w:val="Collegamentoipertestuale"/><w:i/></w:rPr><w:t xml:space="preserve"> c.c.</w:t></w:r>'
      + '</w:hyperlink>'
      + '<w:r w:rsidRPr="00D4E5F6"><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> il danno va risarcito.</w:t></w:r>',
    );
  });

  it('links each number of a list on its own, cutting one run, and adds the space-keeping mark a half needs', async () => {
    const { result } = await writeAll(linksParts());
    const xml = (await unpack(result.bytes)).parts.get(DOCUMENT_PART)!;
    const [a, b] = [result.outcomes[1], result.outcomes[2]].map(outcome => (outcome as { relId: string }).relId);
    const style = '<w:rPr><w:rStyle w:val="Collegamentoipertestuale"/></w:rPr>';
    expect(xml).toContain(
      '<w:r w:rsidR="00A1B2C3"><w:t xml:space="preserve">Visti gli </w:t></w:r>'
      + `<w:hyperlink r:id="${a}" w:history="1"><w:r w:rsidR="00A1B2C3">${style}<w:t>artt. 1223</w:t></w:r></w:hyperlink>`
      + '<w:r w:rsidR="00A1B2C3"><w:t xml:space="preserve"> e </w:t></w:r>'
      + `<w:hyperlink r:id="${b}" w:history="1"><w:r w:rsidR="00A1B2C3">${style}<w:t>1225 c.c.</w:t></w:r></w:hyperlink>`,
    );
  });

  it('cuts inside a text with character references without breaking one', async () => {
    const { result } = await writeAll(linksParts());
    const xml = (await unpack(result.bytes)).parts.get(DOCUMENT_PART)!;
    expect(xml).toContain('<w:t xml:space="preserve">Cfr. l&#8217;</w:t>');
    expect(xml).toContain('<w:t xml:space="preserve">art. 3 d.lgs. 23/2015</w:t></w:r></w:hyperlink><w:r><w:t xml:space="preserve"> &amp; succ. mod.</w:t>');
  });

  it('a run with its own character style keeps it and takes only the look it lacks, as direct formatting', async () => {
    const { result } = await writeAll(linksParts());
    const xml = (await unpack(result.bytes)).parts.get(DOCUMENT_PART)!;
    expect(xml).toContain('<w:rPr><w:rStyle w:val="Citazione"/><w:color w:val="C00000"/><w:u w:val="single"/></w:rPr><w:t>art. 1453 c.c.</w:t>');
    expect(xml).toContain('<w:rPr><w:rStyle w:val="Collegamentoipertestuale"/><w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/><w:b/><w:sz w:val="26"/><w14:ligatures w14:val="standard"/></w:rPr>');
  });

  it('carries a non-breaking hyphen inside the link, cut like a text boundary', async () => {
    const { result } = await writeAll(linksParts());
    const xml = (await unpack(result.bytes)).parts.get(DOCUMENT_PART)!;
    const id = (result.outcomes[7] as { relId: string }).relId;
    expect(xml).toContain(
      `<w:r><w:t xml:space="preserve">Trattino: </w:t></w:r><w:hyperlink r:id="${id}" w:history="1">`
      + '<w:r><w:rPr><w:rStyle w:val="Collegamentoipertestuale"/></w:rPr><w:t xml:space="preserve">art. 21</w:t></w:r>'
      + '<w:r><w:rPr><w:rStyle w:val="Collegamentoipertestuale"/></w:rPr><w:noBreakHyphen/><w:t xml:space="preserve">bis l. 241/1990</w:t></w:r>'
      + '</w:hyperlink><w:r><w:t xml:space="preserve"> e </w:t></w:r>',
    );
  });

  it('links in the notes: the footnote part, with no relationships and no r prefix, gets both', async () => {
    const { result } = await writeAll(linksParts());
    const { parts } = await unpack(result.bytes);
    const footnoteId = (result.outcomes[9] as { relId: string; part: string });
    expect(footnoteId).toMatchObject({ part: 'word/footnotes.xml', relId: 'rIdVlx1' });
    expect(parts.get('word/footnotes.xml')).toContain(
      `<w:hyperlink xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdVlx1" w:history="1">`,
    );
    expect(parts.get('word/_rels/footnotes.xml.rels')).toBe(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + `<Relationship Id="rIdVlx1" Type="${HYPERLINK_REL_TYPE}" Target="${LAW_241}" TargetMode="External"/></Relationships>`,
    );
    expect(parts.get('word/endnotes.xml')).toContain('<w:hyperlink r:id="rIdVlx1" w:history="1">');
    // The content types already had the default for relationship parts: unchanged.
    expect(parts.get('[Content_Types].xml')).toBe(fixtureParts('links')['[Content_Types].xml']);
    expect(parts.get('word/styles.xml')).toBe(fixtureParts('links')['word/styles.xml']);
  });

  it('never changes the bytes it was given', async () => {
    const input = zip(linksParts());
    const copy = input.slice();
    await writeDocxLinks(input, await requests(input, LINKED));
    expect(Buffer.from(input).equals(Buffer.from(copy))).toBe(true);
  });

  it('writes nothing new when nothing is linked: every entry comes out as it went in', async () => {
    const input = zip(linksParts());
    const result = await writeDocxLinks(input, await requests(input, UNTOUCHED.map(([phrase]) => [phrase, art('1')])));
    expect(result.linked).toBe(0);
    expect(Buffer.from(result.bytes).equals(Buffer.from(input))).toBe(true);
  });
});

describe('writeDocxLinks — the link’s look (§6.4)', () => {
  it('with no styles part, colour and underline go on the runs, by the schema’s order', async () => {
    const parts = linksParts();
    delete parts['word/styles.xml'];
    const { input, asked, result } = await writeAll(parts);
    saveForLibreOffice('links-no-styles', input, result.bytes, asked, result.outcomes);
    const xml = (await unpack(result.bytes)).parts.get(DOCUMENT_PART)!;
    expect(xml).toContain(`<w:rPr><w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/><w:b/><w:color w:val="${LINK_COLOR}" w:themeColor="hyperlink"/><w:sz w:val="26"/><w:u w:val="single"/><w14:ligatures w14:val="standard"/></w:rPr>`);
    // A run with its own underline keeps it; it gets the colour only.
    expect(xml).toContain(`<w:rPr><w:color w:val="${LINK_COLOR}" w:themeColor="hyperlink"/><w:u w:val="double"/></w:rPr><w:t>art. 2 c.p.</w:t>`);
    await expectRoundTrip(input, result.bytes, asked, result.outcomes, null);
  });

  it('a styles part without the Hyperlink style gets Word’s own, under a free id', async () => {
    const parts = linksParts();
    parts['word/styles.xml'] = (parts['word/styles.xml'] as string).replace(/<w:style w:type="character" w:styleId="Collegamentoipertestuale">.*?<\/w:style>/, '');
    const { input, asked, result } = await writeAll(parts);
    saveForLibreOffice('links-style-added', input, result.bytes, asked, result.outcomes);
    const styles = (await unpack(result.bytes)).parts.get('word/styles.xml')!;
    expect(styles).toContain('<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="Carpredefinitoparagrafo"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1" w:themeColor="hyperlink"/><w:u w:val="single"/></w:rPr></w:style></w:styles>');
    expect(readStyles(styles).hyperlinkId).toBe('Hyperlink');
    await expectRoundTrip(input, result.bytes, asked, result.outcomes, 'Hyperlink');
  });

  it('when another style holds the id Hyperlink, the added one takes HyperlinkVlx', async () => {
    const parts = linksParts();
    parts['word/styles.xml'] = (parts['word/styles.xml'] as string)
      .replace(/<w:style w:type="character" w:styleId="Collegamentoipertestuale">.*?<\/w:style>/, '')
      .replace('w:styleId="Citazione"', 'w:styleId="Hyperlink"');
    parts['word/document.xml'] = (parts['word/document.xml'] as string).replace('w:val="Citazione"', 'w:val="Hyperlink"');
    const { input, asked, result } = await writeAll(parts);
    const styles = (await unpack(result.bytes)).parts.get('word/styles.xml')!;
    expect(readStyles(styles).hyperlinkId).toBe('HyperlinkVlx');
    await expectRoundTrip(input, result.bytes, asked, result.outcomes, 'HyperlinkVlx');
  });

  it('an English document’s style id is found by its name', async () => {
    const parts = linksParts();
    parts['word/styles.xml'] = (parts['word/styles.xml'] as string).replace('w:styleId="Collegamentoipertestuale"', 'w:styleId="Hyperlink"');
    const { result } = await writeAll(parts);
    const { parts: out } = await unpack(result.bytes);
    expect(out.get('word/styles.xml')).toBe(parts['word/styles.xml']);
    expect(out.get(DOCUMENT_PART)).toContain('<w:rStyle w:val="Hyperlink"/><w:b/><w:i/>');
  });
});

describe('writeDocxLinks — the package', () => {
  it('a package with no relationships for the body and no default for them gets both', async () => {
    const parts = linksParts();
    delete parts['word/_rels/document.xml.rels'];
    parts['[Content_Types].xml'] = (parts['[Content_Types].xml'] as string).replace(/<Default Extension="rels"[^>]*\/>/, '');
    const input = zip(parts);
    const result = await writeDocxLinks(input, await requests(input, LINKED.slice(0, 1)));
    const { parts: out } = await unpack(result.bytes);
    expect(out.get('word/_rels/document.xml.rels')).toContain(`<Relationship Id="rIdVlx1" Type="${HYPERLINK_REL_TYPE}" Target="${art('2043')}" TargetMode="External"/>`);
    expect(out.get('[Content_Types].xml')).toContain('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>');
    expect((await readDocxBytes(result.bytes)).text).toBe((await readDocxBytes(input)).text);
  });

  it('copies stored entries, entries with a data descriptor and binary entries raw', async () => {
    const image = new Uint8Array(4096).map((_, index) => (index * 7919) % 251);
    const parts: Parts = { ...linksParts(), 'word/media/image1.png': image };
    const input = zip(parts, name => (name === 'word/settings.xml' ? { method: 'store' }
      : name === 'customXml/item1.xml' || name === 'word/document.xml' ? { flags: 0x8 } : {}));
    const asked = await requests(input, LINKED);
    const result = await writeDocxLinks(input, asked);
    await expectRoundTrip(input, result.bytes, asked, result.outcomes, 'Collegamentoipertestuale');
    const out = openZip(result.bytes);
    const entry = out.byName.get('word/media/image1.png')!;
    expect(Buffer.from(await readEntry(out, entry)).equals(Buffer.from(image))).toBe(true);
    // The changed part loses its descriptor: its sizes are in its headers now.
    expect(out.byName.get('word/document.xml')!.flags & 0x8).toBe(0);
  });

  it('keeps a part saved as UTF-16 in UTF-16', async () => {
    const parts = linksParts();
    const xml = `\uFEFF${(parts['word/footnotes.xml'] as string).replace('encoding="UTF-8"', 'encoding="UTF-16"')}`;
    const bytes = new Uint8Array(xml.length * 2);
    for (let at = 0; at < xml.length; at += 1) {
      bytes[at * 2] = xml.charCodeAt(at) & 0xff;
      bytes[at * 2 + 1] = xml.charCodeAt(at) >> 8;
    }
    parts['word/footnotes.xml'] = bytes;
    const input = zip(parts);
    const result = await writeDocxLinks(input, await requests(input, [['art. 7 l. 241/1990', LAW_241]]));
    const out = openZip(result.bytes);
    const written = await readEntry(out, out.byName.get('word/footnotes.xml')!);
    expect([written[0], written[1]]).toEqual([0xff, 0xfe]);
    expect(new TextDecoder('utf-16le').decode(written)).toContain('<w:hyperlink');
  });

  it('refuses a signed package', async () => {
    const input = zip({ ...linksParts(), '_xmlsignatures/sig1.xml': '<Signature/>' });
    await expect(writeDocxLinks(input, [])).rejects.toMatchObject({ code: 'signed' });
    await expect(writeDocxLinks(input, [])).rejects.toBeInstanceOf(DocxError);
  });

  it('refuses a file that now reads otherwise than the text the citations count in', async () => {
    const input = zip(linksParts());
    await expect(writeDocxLinks(input, [], { expectedText: 'altro testo' })).rejects.toMatchObject({ code: 'malformed' });
    const { text } = await readDocxBytes(input);
    await expect(writeDocxLinks(input, [], { expectedText: text })).resolves.toMatchObject({ linked: 0 });
  });

  it('keeps the bounds of the reader: a ZIP bomb by declared ratio is refused before anything is inflated', async () => {
    const parts = linksParts();
    const input = buildZip(Object.entries(parts).map(([name, data]) => (name === 'word/styles.xml'
      ? { name, data, declaredUncompressed: 40 * 1024 * 1024 } : { name, data })));
    await expect(writeDocxLinks(input, [])).rejects.toMatchObject({ code: 'too_large' });
  });
});

describe('writeDocxLinks — what it refuses to write', () => {
  it('an address outside the two sources, a range outside the text, an overlap', async () => {
    const input = zip(linksParts());
    const [first] = await requests(input, LINKED.slice(0, 1));
    const result = await writeDocxLinks(input, [
      { ...first, href: 'javascript:alert(1)' },
      { ...first, href: 'http://www.normattiva.it/' },
      { start: -1, end: 3, href: art('1') },
      { start: 5, end: 5, href: art('1') },
      { start: 0, end: 10_000_000, href: art('1') },
      first,
      { start: first.start + 2, end: first.end + 2, href: art('1') },
    ]);
    expect(result.outcomes.map(outcome => (outcome.linked ? 'linked' : outcome.reason))).toEqual([
      'invalid_address', 'invalid_address', 'not_in_document', 'not_in_document', 'not_in_document', 'linked', 'overlap',
    ]);
  });

  it('an address a URL parser would read otherwise (a space, a control character, a backslash)', async () => {
    const input = zip(linksParts());
    const [first] = await requests(input, LINKED.slice(0, 1));
    const result = await writeDocxLinks(input, ['\t', '\n', ' ', '\\@altro', '\u0001'].map(bad => ({ ...first, href: `${art('2043')}${bad}x` })));
    expect(result.outcomes.every(outcome => !outcome.linked && outcome.reason === 'invalid_address')).toBe(true);
  });

  it('a range that would cut a character in two (a surrogate pair)', async () => {
    const parts = linksParts();
    parts['word/document.xml'] = (parts['word/document.xml'] as string).replace('Cfr. l&#8217;art.', 'Cfr. &#x1F4D6;art.');
    const input = zip(parts);
    const { text } = await readDocxBytes(input);
    const at = text.indexOf('\u{1F4D6}');
    const result = await writeDocxLinks(input, [
      { start: at + 1, end: at + 8, href: art('3') },
      { start: at - 2, end: at + 1, href: art('3') },
      { start: at + 2, end: at + 2 + 'art. 3 d.lgs. 23/2015'.length, href: art('3') },
    ]);
    expect(result.outcomes.map(outcome => (outcome.linked ? 'linked' : outcome.reason))).toEqual(['not_in_document', 'not_in_document', 'linked']);
  });

  it('a part written with WordprocessingML as its default namespace is left alone', async () => {
    const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><document xmlns="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><body><p><r><t>art. 2043 c.c.</t></r></p></body></document>';
    const input = zip({ 'word/document.xml': xml });
    const result = await writeDocxLinks(input, [{ start: 0, end: 14, href: art('2043') }]);
    expect(result.outcomes[0]).toEqual({ linked: false, reason: 'structure' });
  });

  it('a hostile package whose entries share their bytes is refused before it is copied many times over', async () => {
    // `openZip` checks each entry against the file, not against the others: entries pointing at the same bytes are
    // the writer's to refuse (each copied raw would make the copy many times the file).
    const pkg = openZip(zip(linksParts()));
    const shared = { ...pkg, entries: [...pkg.entries, ...pkg.entries.map(entry => ({ ...entry, name: `copia/${entry.name}` }))] };
    await expect(writeZip(shared, new Map(), [])).rejects.toMatchObject({ code: 'unsafe' });
  });

  it('the characters the reader wrote (the «Note» heading, a note’s number) are not in the document', async () => {
    const input = zip(linksParts());
    const [request] = await requests(input, [['1. V. art.', art('1')]]);
    const result = await writeDocxLinks(input, [request]);
    expect(result.outcomes[0]).toEqual({ linked: false, reason: 'not_in_document' });
  });

  it('a citation across a paragraph’s end, or a text without the space-keeping mark cut at its edge', async () => {
    const parts = linksParts();
    parts['word/document.xml'] = (parts['word/document.xml'] as string)
      .replace('<w:t xml:space="preserve">Cfr. l&#8217;art.', '<w:t>Cfr. l&#8217;art.')
      .replace(' &amp; succ. mod.</w:t>', ' &amp; succ. mod. </w:t>');
    const input = zip(parts);
    const result = await writeDocxLinks(input, await requests(input, [['art. 3 d.lgs. 23/2015', art('1')]]));
    expect(result.outcomes[0]).toEqual({ linked: false, reason: 'structure' });
    const { text } = await readDocxBytes(input);
    const across = text.indexOf('risarcito.');
    const crossing = await writeDocxLinks(input, [{ start: across, end: across + 'risarcito.\nVisti'.length, href: art('1') }]);
    expect(crossing.outcomes[0]).toEqual({ linked: false, reason: 'structure' });
  });
});

describe('writeDocxLinks — a package saved by LibreOffice (§10.2)', () => {
  // The fixture `links` opened in LibreOffice 26.8 and saved as «Word 2007-365»: its habits (a data descriptor on
  // every entry, `&apos;`, empty `<w:rPr></w:rPr>`, the content types last, its own style ids) in a binary package.
  // The tests run from `apps/web` (jsdom gives `import.meta.url` no file scheme).
  const saved = () => new Uint8Array(readFileSync(join(process.cwd(), 'src/components/features/documents/__tests__/docx-saved/libreoffice.docx')));

  it('is clean: no path, no e-mail address, no author but the neutral one', async () => {
    const { parts } = await unpack(saved());
    for (const [name, content] of parts) {
      expect(content, name).not.toMatch(/\/Users\/|\/home\/|[A-Za-z]:\\|\\\\/);
      expect(content, name).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      for (const [, author] of content.matchAll(/w:(?:author|initials)="([^"]*)"/g)) expect(author, name).toBe('Autore di prova');
      for (const tag of ['dc:creator', 'cp:lastModifiedBy', 'Company', 'Template']) {
        const value = content.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1];
        if (value !== undefined) expect(value, `${name} ${tag}`).toBe('');
      }
    }
  });

  it('links its citations and proves the round trip', async () => {
    const input = saved();
    const asked = await requests(input, LINKED);
    const result = await writeDocxLinks(input, asked);
    expect(result.outcomes.map((outcome, index) => [LINKED[index][0], outcome.linked ? 'linked' : outcome.reason]))
      .toEqual(LINKED.map(([phrase]) => [phrase, 'linked']));
    const styleId = readStyles((await unpack(input)).parts.get('word/styles.xml')!).hyperlinkId;
    await expectRoundTrip(input, result.bytes, asked, result.outcomes, styleId ?? 'Hyperlink');
    saveForLibreOffice('libreoffice', input, result.bytes, asked, result.outcomes);
  });
});

describe('the writer’s helpers', () => {
  it('rawIndex maps a decoded offset into a text with references, and refuses the middle of an astral one', () => {
    expect(rawIndex('a&amp;b', 2)).toBe(6);
    expect(rawIndex('l&#8217;art', 2)).toBe(8);
    expect(rawIndex('x&#x1F600;y', 2)).toBe(-1);
    expect(rawIndex('x&#x1F600;y', 3)).toBe(10);
    expect(rawIndex('a\r\nb', 2)).toBe(3);
  });

  it('relsName keeps the part’s own spelling', () => {
    expect(relsName('word/document.xml')).toBe('word/_rels/document.xml.rels');
    expect(relsName('Word/FootNotes.xml')).toBe('Word/_rels/FootNotes.xml.rels');
  });
});
