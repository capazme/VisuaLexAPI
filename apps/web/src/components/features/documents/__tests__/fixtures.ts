/** Invented documents for the tests of «Analizza documento»: no real client, no real case. */

/** A DOCX reduced to what the reader looks at: a ZIP whose one entry, stored, is `word/document.xml`. */
export function storedDocx(documentXml: string, name = 'word/document.xml'): Uint8Array {
  const encoder = new TextEncoder();
  const fileName = encoder.encode(name);
  const data = encoder.encode(documentXml);
  const local = new Uint8Array(30 + fileName.length + data.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(8, 0, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, data.length, true);
  lv.setUint16(26, fileName.length, true);
  local.set(fileName, 30);
  local.set(data, 30 + fileName.length);

  const central = new Uint8Array(46 + fileName.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(10, 0, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, fileName.length, true);
  cv.setUint32(42, 0, true);
  central.set(fileName, 46);

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length, true);

  const zip = new Uint8Array(local.length + central.length + end.length);
  zip.set(local, 0);
  zip.set(central, local.length);
  zip.set(end, local.length + central.length);
  return zip;
}

/** A file as a browser hands it over: jsdom's `File` has neither `text()` nor `arrayBuffer()`. */
export function testFile(parts: Array<string | Uint8Array>, name: string): File {
  const chunks = parts.map(part => (typeof part === 'string' ? new TextEncoder().encode(part) : part));
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  chunks.reduce((at, chunk) => { bytes.set(chunk, at); return at + chunk.length; }, 0);
  const result = new File(chunks as BlobPart[], name);
  Object.assign(result, {
    text: async () => new TextDecoder().decode(bytes),
    arrayBuffer: async () => bytes.slice().buffer,
  });
  return result;
}

/** A Word paragraph of one run. */
export const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

/** An invented memo, two paragraphs. */
export const DOCX_XML = `<?xml version="1.0"?><w:document><w:body>${paragraph('Memoria difensiva')}${paragraph('Si richiama l&apos;art. 2043 c.c. e la l. 241/1990 art. 3.')}</w:body></w:document>`;

/** An invented opinion citing two acts, the second in two spellings. */
export const PARERE = [
  'Parere sul recesso dal contratto di fornitura.',
  "Il fornitore invoca l'art. 1453 c.c. e, in subordine, l'art. 1455 c.c.; il cliente oppone l'art. 2043 c.c.",
  'Quanto al procedimento, la legge 241/1990 art. 3 impone la motivazione e la l. 241/90 art. 7 la comunicazione di avvio.',
  "Resta l'art. 1453 c.c., già citato.",
].join('\n');
