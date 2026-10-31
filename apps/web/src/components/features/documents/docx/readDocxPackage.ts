/**
 * A DOCX read in full, in the browser (spec #391 §6.1): the package opened with its bounds, the main part and the
 * notes inflated, their text and its map. Runs in the Worker (`docxReader.worker.ts`), or in the page where there is
 * no Worker (the tests).
 */
import { DocxError } from './docxErrors';
import { DOCUMENT_PART, ENDNOTES_PART, FOOTNOTES_PART, docxText, type DocxText } from './docxText';
import { checkReadable, findEntry, openZip, readEntry, type ZipEntry } from './zipPackage';

export interface DocxReading extends DocxText {
  /** The package carries a digital signature (`_xmlsignatures/`): it can be read, a copy of it cannot be written. */
  signed: boolean;
}

/** A part's XML as a string: UTF-8 (a BOM dropped), or UTF-16 when it starts with its BOM. */
function decodePart(bytes: Uint8Array): string {
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new DocxError('malformed', 'encoding');
  }
}

export async function readDocxBytes(bytes: Uint8Array): Promise<DocxReading> {
  const pkg = openZip(bytes);
  const document = findEntry(pkg, DOCUMENT_PART);
  if (!document) throw new DocxError('no_document');
  const footnotes = findEntry(pkg, FOOTNOTES_PART);
  const endnotes = findEntry(pkg, ENDNOTES_PART);
  checkReadable([document, footnotes, endnotes].filter((entry): entry is ZipEntry => entry !== undefined));

  const read = async (entry: ZipEntry | undefined) => (entry ? decodePart(await readEntry(pkg, entry)) : undefined);
  const reading = docxText({
    document: (await read(document))!,
    footnotes: await read(footnotes),
    endnotes: await read(endnotes),
  });
  const signed = pkg.entries.some(entry => entry.name.toLowerCase().startsWith('_xmlsignatures/'));
  return { ...reading, signed };
}
