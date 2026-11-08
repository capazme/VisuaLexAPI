/**
 * Writes the copy of a DOCX package (spec #391 §6.2, §7.1): every entry not changed is copied **byte for byte,
 * compressed as it was** — its local header, its data and its data descriptor if it has one — and its central record
 * with only the local header's offset rewritten. A changed part is deflated again with the browser's own
 * `CompressionStream('deflate-raw')`; a part the copy adds (a note part's relationships) is appended. The package was
 * opened by `openZip`, which refused ZIP64, multi-disk and encrypted entries, so nothing here is half carried.
 */
import { DocxError } from './docxErrors';
import type { ZipEntry, ZipPackage } from './zipPackage';

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
  for (let at = 0; at < bytes.length; at += 1) crc = CRC_TABLE[(crc ^ bytes[at]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  writer.write(bytes as Uint8Array<ArrayBuffer>).catch(() => {});
  writer.close().catch(() => {});
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = stream.readable.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const SIG_DESCRIPTOR = 0x08074b50;
/** General-purpose flag bit 3: sizes and CRC in a data descriptor after the data. */
const FLAG_DESCRIPTOR = 0x8;
/** The largest number a 32-bit field of the ZIP records holds: past it the copy would need ZIP64. */
const MAX_U32 = 0xffffffff;

/** Where an entry's raw bytes end: after its data, and after its data descriptor when it has one. */
function rawEnd(pkg: ZipPackage, entry: ZipEntry): number {
  const dataEnd = entry.dataOffset + entry.compressedSize;
  if (!(entry.flags & FLAG_DESCRIPTOR)) return dataEnd;
  const view = new DataView(pkg.bytes.buffer, pkg.bytes.byteOffset, pkg.bytes.byteLength);
  if (dataEnd + 4 > pkg.centralStart) throw new DocxError('malformed', 'data descriptor');
  const length = view.getUint32(dataEnd, true) === SIG_DESCRIPTOR ? 16 : 12;
  if (dataEnd + length > pkg.centralStart) throw new DocxError('malformed', 'data descriptor');
  return dataEnd + length;
}

interface Written {
  local: Uint8Array;
  central: Uint8Array;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

interface Deflated {
  crc: number;
  data: Uint8Array;
  size: number;
}

async function deflatePart(plain: Uint8Array): Promise<Deflated> {
  return { crc: crc32(plain), data: await deflateRaw(plain), size: plain.length };
}

export interface ZipAddition {
  name: string;
  data: Uint8Array;
}

/**
 * The package `pkg` with the parts in `changed` (by the entry's name lowercased) replaced, the parts in `added`
 * appended, and every other entry copied raw. The end record's comment is kept.
 */
export async function writeZip(pkg: ZipPackage, changed: Map<string, Uint8Array>, added: ZipAddition[]): Promise<Uint8Array> {
  const source = pkg.bytes;
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const written: Written[] = [];
  let offset = 0;
  const encoder = new TextEncoder();
  // The time and date of the package's first entry, for the parts the copy adds.
  const first = pkg.entries[0];
  const time = first ? view.getUint16(first.localOffset + 10, true) : 0;
  const date = first ? view.getUint16(first.localOffset + 12, true) : 0x21;

  // Entries whose data overlap (a hostile package) would make the copy many times the file: refused.
  let rawTotal = 0;
  for (const entry of pkg.entries) {
    rawTotal += rawEnd(pkg, entry) - entry.localOffset;
    if (rawTotal > source.length) throw new DocxError('unsafe', 'overlapping entries');
  }

  for (const entry of pkg.entries) {
    const replacement = changed.get(entry.name.toLowerCase());
    const central = source.slice(entry.centralOffset, entry.centralOffset + entry.centralLength);
    const cv = new DataView(central.buffer);
    if (!replacement) {
      const local = source.subarray(entry.localOffset, rawEnd(pkg, entry));
      cv.setUint32(42, offset, true);
      written.push({ local, central });
      offset += local.length;
      continue;
    }
    const { crc, data, size } = await deflatePart(replacement);
    const nameLength = view.getUint16(entry.localOffset + 26, true);
    const name = source.subarray(entry.localOffset + 30, entry.localOffset + 30 + nameLength);
    const flags = view.getUint16(entry.localOffset + 6, true) & ~FLAG_DESCRIPTOR;
    const local = new Uint8Array(30 + nameLength + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, SIG_LOCAL, true);
    lv.setUint16(4, Math.max(20, view.getUint16(entry.localOffset + 4, true)), true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, 8, true);
    lv.setUint16(10, view.getUint16(entry.localOffset + 10, true), true);
    lv.setUint16(12, view.getUint16(entry.localOffset + 12, true), true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameLength, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(data, 30 + nameLength);
    cv.setUint16(6, Math.max(20, cv.getUint16(6, true)), true);
    cv.setUint16(8, cv.getUint16(8, true) & ~FLAG_DESCRIPTOR, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, size, true);
    cv.setUint32(42, offset, true);
    written.push({ local, central });
    offset += local.length;
  }

  for (const addition of added) {
    const { crc, data, size } = await deflatePart(addition.data);
    const name = encoder.encode(addition.name);
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, SIG_LOCAL, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 8, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, SIG_CENTRAL, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 8, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    written.push({ local, central });
    offset += local.length;
  }

  const centralStart = offset;
  const centralSize = written.reduce((sum, item) => sum + item.central.length, 0);
  if (written.length > 0xfffe || centralStart + centralSize > MAX_U32) throw new DocxError('too_large', 'copy needs zip64');
  const comment = source.subarray(pkg.endOffset + 22);
  const end = new Uint8Array(22 + comment.length);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, SIG_END, true);
  ev.setUint16(8, written.length, true);
  ev.setUint16(10, written.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralStart, true);
  ev.setUint16(20, comment.length, true);
  end.set(comment, 22);
  return concat([...written.map(item => item.local), ...written.map(item => item.central), end]);
}
