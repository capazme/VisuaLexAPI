/**
 * The ZIP container of a DOCX, read in the browser with bounds (spec #391 §6.1, §7.1).
 *
 * Only the central directory is trusted for the layout, and only after every number in it is checked against the
 * file: the entry count, each entry's name, where its data lies, its declared sizes and ratio. An entry is inflated
 * only when asked for, and the inflating stream is cut as soon as it passes the size the directory declared, so a
 * part that lies about its size cannot grow past it (a ZIP bomb). ZIP64, multi-disk and encrypted entries are
 * refused: no DOCX of 15 MB needs them, and a writer (L4) must never carry a package it half understands.
 */
import { DocxError } from './docxErrors';

/** At most this many entries in the package. Word's own packages hold a few dozen. */
export const MAX_ENTRIES = 2000;
/** A part read is at most this large once inflated. */
export const MAX_PART_BYTES = 50 * 1024 * 1024;
/** The parts read, together, at most this large once inflated. */
export const MAX_READ_BYTES = 120 * 1024 * 1024;
/** A part to be inflated whose declared size passes this many times its compressed size is refused. */
export const MAX_RATIO = 200;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
/** The first eight bytes of a Compound File Binary: an encrypted Office document (or a `.doc`). */
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export interface ZipEntry {
  /** The name as stored (OPC names are ASCII; UTF-8 is accepted). */
  name: string;
  /** 0 stored, 8 deflated: anything else is refused before the entry is read. */
  method: number;
  /** The general-purpose flags: bit 3 marks a data descriptor after the data. */
  flags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  /** Where the entry's local header starts. */
  localOffset: number;
  /** Where its data starts (after the local header's name and extra field). */
  dataOffset: number;
  /** Where its central record starts, and its length: a writer copies it with only the offset rewritten. */
  centralOffset: number;
  centralLength: number;
}

export interface ZipPackage {
  bytes: Uint8Array;
  entries: ZipEntry[];
  /** By the name lowercased: OPC part names compare without case. */
  byName: Map<string, ZipEntry>;
  /** Where the central directory starts: no entry's data lies at or beyond it. */
  centralStart: number;
  /** Where the end-of-central-directory record starts: the writer (L4) carries its comment over. */
  endOffset: number;
}

function startsWithCfb(bytes: Uint8Array): boolean {
  return bytes.length >= CFB_MAGIC.length && CFB_MAGIC.every((value, index) => bytes[index] === value);
}

/** A name a package may carry: no `..` segment, no leading slash or backslash, no NUL, not empty. */
function isSafeName(name: string): boolean {
  if (!name || name.includes('\0')) return false;
  if (name.startsWith('/') || name.startsWith('\\')) return false;
  if (/^[A-Za-z]:/.test(name)) return false;
  return !name.split(/[\\/]/).some(segment => segment === '..');
}

/** Reads the central directory of `bytes`, checking every number against the file. Inflates nothing. */
export function openZip(bytes: Uint8Array): ZipPackage {
  if (startsWithCfb(bytes)) throw new DocxError('encrypted');
  if (bytes.length < 22) throw new DocxError('malformed', 'too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (view.getUint32(offset, true) === SIG_END) {
      // The comment must end the file exactly, else this is a signature inside the comment or the data.
      if (offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { end = offset; break; }
    }
  }
  if (end < 0) throw new DocxError('malformed', 'no end of central directory');
  if (end >= 20 && view.getUint32(end - 20, true) === SIG_ZIP64_LOCATOR) throw new DocxError('unsafe', 'zip64');

  const diskNumber = view.getUint16(end + 4, true);
  const centralDisk = view.getUint16(end + 6, true);
  const entriesOnDisk = view.getUint16(end + 8, true);
  const entryCount = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralStart = view.getUint32(end + 16, true);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralStart === 0xffffffff) {
    throw new DocxError('unsafe', 'zip64');
  }
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) throw new DocxError('unsafe', 'multi-disk');
  if (entryCount > MAX_ENTRIES) throw new DocxError('too_large', 'entries');
  if (centralStart + centralSize > end) throw new DocxError('malformed', 'central directory out of bounds');

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries: ZipEntry[] = [];
  const byName = new Map<string, ZipEntry>();
  let cursor = centralStart;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > centralStart + centralSize || view.getUint32(cursor, true) !== SIG_CENTRAL) {
      throw new DocxError('malformed', 'central record');
    }
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc32 = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const diskStart = view.getUint16(cursor + 34, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const centralLength = 46 + nameLength + extraLength + commentLength;
    if (cursor + centralLength > centralStart + centralSize) throw new DocxError('malformed', 'central record length');
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new DocxError('unsafe', 'zip64');
    }
    if (diskStart !== 0) throw new DocxError('unsafe', 'multi-disk');
    if (flags & 0x1) throw new DocxError('unsafe', 'encrypted entry');

    let name: string;
    try {
      name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    } catch {
      throw new DocxError('unsafe', 'name encoding');
    }
    if (!isSafeName(name)) throw new DocxError('unsafe', 'name');
    const key = name.toLowerCase();
    if (byName.has(key)) throw new DocxError('unsafe', 'duplicate name');

    // The local header: its signature, its name equal to the central one, its data inside the file and before the
    // central directory.
    if (localOffset + 30 > centralStart || view.getUint32(localOffset, true) !== SIG_LOCAL) {
      throw new DocxError('malformed', 'local header');
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (localNameLength !== nameLength
      || bytes.subarray(localOffset + 30, localOffset + 30 + nameLength).some((value, at) => value !== bytes[cursor + 46 + at])) {
      throw new DocxError('unsafe', 'local name differs');
    }
    if (dataOffset + compressedSize > centralStart) throw new DocxError('malformed', 'data out of bounds');

    const entry: ZipEntry = {
      name, method, flags, crc32, compressedSize, uncompressedSize, localOffset, dataOffset,
      centralOffset: cursor, centralLength,
    };
    entries.push(entry);
    byName.set(key, entry);
    cursor += centralLength;
  }

  return { bytes, entries, byName, centralStart, endOffset: end };
}

export function findEntry(pkg: ZipPackage, name: string): ZipEntry | undefined {
  return pkg.byName.get(name.toLowerCase());
}

/**
 * Checks, before inflating anything, that `entries` may be read: each at most `MAX_PART_BYTES` declared, all at most
 * `MAX_READ_BYTES` together, and a deflated one at most `MAX_RATIO` times its compressed size.
 */
export function checkReadable(entries: ZipEntry[]): void {
  let total = 0;
  for (const entry of entries) {
    if (entry.method !== 0 && entry.method !== 8) throw new DocxError('unsafe', 'compression method');
    if (entry.method === 0 && entry.compressedSize !== entry.uncompressedSize) throw new DocxError('malformed', 'stored size');
    if (entry.uncompressedSize > MAX_PART_BYTES) throw new DocxError('too_large', 'part');
    if (entry.method === 8 && entry.uncompressedSize > 0
      && (entry.compressedSize === 0 || entry.uncompressedSize / entry.compressedSize > MAX_RATIO)) {
      throw new DocxError('too_large', 'ratio');
    }
    total += entry.uncompressedSize;
    if (total > MAX_READ_BYTES) throw new DocxError('too_large', 'parts together');
  }
}

/**
 * The entry's bytes, inflated. The stream is cut, and the entry refused, as soon as it passes the size the central
 * directory declared; one that ends short of it is refused as well (the directory lied either way).
 * Call `checkReadable` first.
 */
export async function readEntry(pkg: ZipPackage, entry: ZipEntry): Promise<Uint8Array> {
  const data = pkg.bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method !== 8) throw new DocxError('unsafe', 'compression method');

  const limit = entry.uncompressedSize;
  const out = new Uint8Array(limit);
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  // The writer's promises reject when the reader is cancelled or the data is corrupt: the reading below reports it.
  // The bytes come from a File (an ArrayBuffer, never shared memory).
  writer.write(data as Uint8Array<ArrayBuffer>).catch(() => {});
  writer.close().catch(() => {});
  let filled = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (filled + value.length > limit) {
        await reader.cancel().catch(() => {});
        throw new DocxError('too_large', 'inflated past the declared size');
      }
      out.set(value, filled);
      filled += value.length;
    }
  } catch (error) {
    if (error instanceof DocxError) throw error;
    throw new DocxError('malformed', 'deflate');
  }
  if (filled !== limit) throw new DocxError('malformed', 'inflated short of the declared size');
  return out;
}
