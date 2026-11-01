import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DocxError, type DocxErrorCode } from '../docx/docxErrors';
import { readDocxBytes } from '../docx/readDocxPackage';
import { MAX_ENTRIES, MAX_PART_BYTES, MAX_RATIO } from '../docx/zipPackage';
import { paragraph } from './fixtures';
import { buildZip, fixtureDocx, fixtureParts, type ZipInput } from './docxZip';

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const DOCUMENT = `<w:document ${W_NS}><w:body>${paragraph('art. 2043 c.c.')}</w:body></w:document>`;
const doc = (extra: Partial<ZipInput> = {}): ZipInput => ({ name: 'word/document.xml', data: DOCUMENT, ...extra });

async function refusal(bytes: Uint8Array): Promise<DocxErrorCode | 'read'> {
  try {
    await readDocxBytes(bytes);
    return 'read';
  } catch (error) {
    if (error instanceof DocxError) return error.code;
    throw error;
  }
}

describe('readDocxBytes — a package as the programs write it', () => {
  it('reads the deflated and the stored package of a fixture alike, notes included', async () => {
    const deflated = await readDocxBytes(fixtureDocx('notes'));
    const stored = await readDocxBytes(fixtureDocx('notes', 'store'));
    expect(deflated.text).toBe(stored.text);
    expect(deflated.text).toContain('Note\n1. Cfr. art. 2043 c.c.');
    expect(deflated.signed).toBe(false);
  });

  it('reads entries written with a data descriptor (sizes after the data)', async () => {
    const reading = await readDocxBytes(buildZip([{ name: '[Content_Types].xml', data: '<Types/>', flags: 0x8 }, doc({ flags: 0x8 })]));
    expect(reading.text).toBe('art. 2043 c.c.');
  });

  it('finds the main part whatever the case of its name, as OPC compares names', async () => {
    expect((await readDocxBytes(buildZip([doc({ name: 'Word/Document.xml' })]))).text).toBe('art. 2043 c.c.');
  });

  it('says a signed package is signed, and still reads it', async () => {
    const reading = await readDocxBytes(buildZip([doc(), { name: '_xmlsignatures/sig1.xml', data: '<Signature/>' }]));
    expect(reading).toMatchObject({ text: 'art. 2043 c.c.', signed: true });
  });

  it('reads a part saved as UTF-16 with its BOM', async () => {
    const xml = `\ufeff${DOCUMENT}`;
    const bytes = new Uint8Array(xml.length * 2);
    for (let at = 0; at < xml.length; at += 1) {
      bytes[at * 2] = xml.charCodeAt(at) & 0xff;
      bytes[at * 2 + 1] = xml.charCodeAt(at) >> 8;
    }
    expect((await readDocxBytes(buildZip([doc({ data: bytes })]))).text).toBe('art. 2043 c.c.');
  });
});

describe('readDocxBytes — refusals', () => {
  it('a CFB file is a document protected by a password', async () => {
    const cfb = new Uint8Array(512);
    cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(await refusal(cfb)).toBe('encrypted');
  });

  it('Strict Open XML is named', async () => {
    const strict = '<w:document xmlns:w="http://purl.oclc.org/ooxml/wordprocessingml/main"><w:body/></w:document>';
    expect(await refusal(buildZip([doc({ data: strict })]))).toBe('strict');
  });

  it('not a ZIP, or a ZIP without the main part', async () => {
    expect(await refusal(new TextEncoder().encode('non è uno zip, nemmeno per sbaglio'))).toBe('malformed');
    expect(await refusal(buildZip([{ name: 'word/styles.xml', data: '<w:styles/>' }]))).toBe('no_document');
  });

  it('duplicate names, even differing only in case', async () => {
    expect(await refusal(buildZip([doc(), doc()]))).toBe('unsafe');
    expect(await refusal(buildZip([doc(), doc({ name: 'WORD/document.xml' })]))).toBe('unsafe');
  });

  it('names that climb out or start at the root', async () => {
    for (const name of ['../word/document.xml', 'word/../../x.xml', '/word/x.xml', '\\word\\x.xml', 'C:/x.xml']) {
      expect(await refusal(buildZip([doc(), { name, data: 'x' }])), name).toBe('unsafe');
    }
  });

  it('a local header whose name differs from the central one', async () => {
    expect(await refusal(buildZip([doc({ localName: 'word/documenx.xml' })]))).toBe('unsafe');
  });

  it('an encrypted entry, and a compression method other than store and deflate', async () => {
    expect(await refusal(buildZip([doc({ flags: 0x1 })]))).toBe('unsafe');
    const bytes = buildZip([doc({ method: 'store' })]);
    // The method in the central record (offset 10 of the record) set to 12, bzip2.
    const view = new DataView(bytes.buffer);
    const central = bytes.length - 22 - (46 + 'word/document.xml'.length);
    view.setUint16(central + 10, 12, true);
    expect(await refusal(bytes)).toBe('unsafe');
  });

  it('a ZIP64 package', async () => {
    const bytes = buildZip([doc()]);
    new DataView(bytes.buffer).setUint16(bytes.length - 22 + 10, 0xffff, true);
    expect(await refusal(bytes)).toBe('unsafe');
  });

  it('more entries than a package needs', async () => {
    const many: ZipInput[] = [doc({ method: 'store' })];
    for (let index = 0; index < MAX_ENTRIES; index += 1) many.push({ name: `x/${index}`, data: '', method: 'store' });
    expect(await refusal(buildZip(many))).toBe('too_large');
  });

  it('a part declared too compressed is refused before it is inflated', async () => {
    const compressed = new Uint8Array(deflateRawSync(new TextEncoder().encode(DOCUMENT)));
    expect(await refusal(buildZip([doc({ rawData: compressed, declaredUncompressed: compressed.length * (MAX_RATIO + 1) })]))).toBe('too_large');
  });

  it('a ZIP bomb: ten megabytes of zeros in a few kilobytes', async () => {
    const zeros = new Uint8Array(10 * 1024 * 1024);
    expect(await refusal(buildZip([doc(), { name: 'word/footnotes.xml', data: zeros }]))).toBe('too_large');
  });

  it('a part that lies about its size: the stream is cut where the declared size ends', async () => {
    const big = `<w:document ${W_NS}><w:body>${paragraph('x'.repeat(200_000))}</w:body></w:document>`;
    const compressed = new Uint8Array(deflateRawSync(new TextEncoder().encode(big)));
    // A ratio under the bound, a size far under the truth.
    expect(await refusal(buildZip([doc({ data: big, rawData: compressed, declaredUncompressed: compressed.length * 2 })]))).toBe('too_large');
  });

  it('a part inflated short of its declared size', async () => {
    const compressed = new Uint8Array(deflateRawSync(new TextEncoder().encode(DOCUMENT)));
    expect(await refusal(buildZip([doc({ rawData: compressed, declaredUncompressed: DOCUMENT.length + 10 })]))).toBe('malformed');
  });

  it('a part over 50 MB declared, and the parts over 120 MB together', async () => {
    const filler = new Uint8Array(300_000);
    expect(await refusal(buildZip([doc({ rawData: filler, declaredUncompressed: MAX_PART_BYTES + 1 })]))).toBe('too_large');
    const near = MAX_PART_BYTES - 10;
    expect(await refusal(buildZip([
      doc({ rawData: filler, declaredUncompressed: near }),
      { name: 'word/footnotes.xml', data: '', rawData: filler, declaredUncompressed: near },
      { name: 'word/endnotes.xml', data: '', rawData: filler, declaredUncompressed: near },
    ]))).toBe('too_large');
  });

  it('a DOCTYPE in a part', async () => {
    const parts = fixtureParts('plain');
    const withDoctype = parts['word/document.xml'].replace('?>', '?><!DOCTYPE w:document [<!ENTITY x "y">]>');
    expect(await refusal(buildZip([doc({ data: withDoctype })]))).toBe('unsafe');
  });

  it('a central directory pointing outside the file', async () => {
    const bytes = buildZip([doc()]);
    new DataView(bytes.buffer).setUint32(bytes.length - 22 + 16, bytes.length, true);
    expect(await refusal(bytes)).toBe('malformed');
  });
});
