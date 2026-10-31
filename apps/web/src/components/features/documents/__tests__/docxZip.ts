/**
 * Builds DOCX packages for the tests from the unpacked, invented fixtures in `docx/` (spec #391 §10.2): readable XML
 * in the repository, zipped here. The builder can also write the packages no producer writes (a lying size, a
 * duplicate name, an encrypted entry), for the reader's refusals.
 */
import { deflateRawSync } from 'node:zlib';

// `.rels` named on its own: the glob skips names that start with a dot, and a package without `_rels/.rels` has no
// main part for Word or LibreOffice.
const fixtureFiles = import.meta.glob(['./docx/**/*', './docx/**/.rels'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/**
 * As Word writes a part: no line break between tags. The fixtures are indented to be read; the indentation would be
 * text between tags, which the old reader read and Word never writes.
 */
export function compactXml(xml: string): string {
  return xml.replace(/>\s*\n\s*</g, '><').trim();
}

/** The files of fixture `name` (`docx/<name>/…`), each part compacted, keyed by its name in the package. */
export function fixtureParts(name: string): Record<string, string> {
  const prefix = `./docx/${name}/`;
  const parts: Record<string, string> = {};
  for (const [path, content] of Object.entries(fixtureFiles)) {
    if (path.startsWith(prefix)) parts[path.slice(prefix.length)] = compactXml(content);
  }
  if (Object.keys(parts).length === 0) throw new Error(`no fixture ${name}`);
  return parts;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipInput {
  name: string;
  data: string | Uint8Array;
  /** Deflated (the default) or stored. */
  method?: 'deflate' | 'store';
  /** The name in the local header, when it must differ from the central one. */
  localName?: string;
  /** Sizes declared in the central directory, in place of the true ones. */
  declaredUncompressed?: number;
  /** Bytes written as the entry's compressed data, in place of the real compression. */
  rawData?: Uint8Array;
  /** General-purpose flags (bit 0 encrypted, bit 3 data descriptor). */
  flags?: number;
}

/** A ZIP of `inputs`, in order, with a data descriptor after an entry whose flags carry bit 3. */
export function buildZip(inputs: ZipInput[], options: { comment?: string } = {}): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const input of inputs) {
    const plain = typeof input.data === 'string' ? encoder.encode(input.data) : input.data;
    const method = input.method === 'store' ? 0 : 8;
    const compressed = input.rawData ?? (method === 8 ? new Uint8Array(deflateRawSync(plain)) : plain);
    const crc = crc32(plain);
    const name = encoder.encode(input.name);
    const localName = encoder.encode(input.localName ?? input.name);
    const flags = input.flags ?? 0;
    const descriptor = (flags & 0x8) !== 0;
    const uncompressed = input.declaredUncompressed ?? plain.length;

    const local = new Uint8Array(30 + localName.length + compressed.length + (descriptor ? 16 : 0));
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, descriptor ? 0 : crc, true);
    lv.setUint32(18, descriptor ? 0 : compressed.length, true);
    lv.setUint32(22, descriptor ? 0 : uncompressed, true);
    lv.setUint16(26, localName.length, true);
    local.set(localName, 30);
    local.set(compressed, 30 + localName.length);
    if (descriptor) {
      const at = 30 + localName.length + compressed.length;
      lv.setUint32(at, 0x08074b50, true);
      lv.setUint32(at + 4, crc, true);
      lv.setUint32(at + 8, compressed.length, true);
      lv.setUint32(at + 12, uncompressed, true);
    }

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, compressed.length, true);
    cv.setUint32(24, uncompressed, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((total, c) => total + c.length, 0);
  const comment = encoder.encode(options.comment ?? '');
  const end = new Uint8Array(22 + comment.length);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, inputs.length, true);
  ev.setUint16(10, inputs.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, comment.length, true);
  end.set(comment, 22);

  const zip = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const chunk of [...locals, ...centrals, end]) {
    zip.set(chunk, at);
    at += chunk.length;
  }
  return zip;
}

/** The package of fixture `name`, every part deflated. */
export function fixtureDocx(name: string, method: 'deflate' | 'store' = 'deflate'): Uint8Array {
  return buildZip(Object.entries(fixtureParts(name)).map(([partName, data]) => ({ name: partName, data, method })));
}

/** The reader the page used before spec #391 L2, frozen here: the measure of «the same text as today». */
export function legacyDocxText(documentXml: string): string {
  const decoded = new DOMParser().parseFromString(
    `<span>${documentXml
      .replace(/<w:tab\s*\/?\s*>/gi, '\t')
      .replace(/<w:br\s*\/?\s*>/gi, '\n')
      .replace(/<\/w:p>/gi, '\n')
      .replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/gi, '$1')
      .replace(/<[^>]+>/g, '')}</span>`,
    'text/html',
  ).body.textContent ?? '';
  return decoded.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
