import { crc32, inflateRawSync } from 'node:zlib';

/**
 * Text in and out of a case's act files (LC56), with Node's own zlib for DOCX and ODT, and Mozilla's pdfjs-dist
 * for PDF (LC57, the one package added).
 *
 * - `extractText`: the text of a DOCX (`word/document.xml`), an ODT (`content.xml`) or a TXT. DOC and RTF are
 *   left out: the caller says so. Footnotes, headers and comments too.
 * - `pdfText`: the text of a PDF, page by page.
 * - `textToDocx`: a plain DOCX from plain text or simple Markdown: a line is a paragraph, `#` lines are bold
 *   headings, `**…**` is bold. Nothing else of Markdown (lists, links, tables stay as typed).
 */

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ODT_MIME = 'application/vnd.oasis.opendocument.text';
export const EXTRACTABLE = new Set([DOCX_MIME, ODT_MIME, 'text/plain']);

/** An XML part inflated past this is refused: a 25 MB upload must not become gigabytes in memory. */
const MAX_XML_BYTES = 64 * 1024 * 1024;

// ─── Reading ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * One entry of a ZIP, read through the central directory (its sizes are the reliable ones), or null. Stored and
 * deflated entries only; no ZIP64 (a file under 25 MB needs none).
 */
function zipEntry(zip: Buffer, name: string): Buffer | null {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > zip.length) return null;
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== 0x02014b50) return null;
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const next = at + 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    if (zip.toString('utf8', at + 46, at + 46 + nameLength) === name) {
      const local = zip.readUInt32LE(at + 42);
      if (local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) return null;
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const body = zip.subarray(start, start + size);
      if (body.length !== size) return null;
      if (method === 0) return body.length <= MAX_XML_BYTES ? body : null;
      // Throws past the ceiling: the caller reads it as an unreadable file.
      if (method === 8) return inflateRawSync(body, { maxOutputLength: MAX_XML_BYTES });
      return null;
    }
    at = next;
  }
  return null;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e: string) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()];
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });

/** Word's runs: `<w:t>` text, a run's `<w:tab/>` (tab stops in `<w:tabs>` carry attributes), breaks, paragraphs. */
function docxText(xml: string): string {
  let out = '';
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:(?:br|cr)\b[^>]*\/>|<\/w:p>|<w:p\b[^>]*\/>/g)) {
    if (m[1] !== undefined) out += decode(m[1]);
    else out += m[0] === '<w:tab/>' ? '\t' : '\n';
  }
  return out;
}

/** LibreOffice's body: paragraphs and headings, tabs, line breaks, runs of spaces; every other tag dropped. */
function odtText(xml: string): string {
  const body = xml.slice(Math.max(0, xml.indexOf('<office:body')));
  return decode(
    body
      .replace(/<text:tab\/>/g, '\t')
      .replace(/<text:line-break\/>/g, '\n')
      .replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (_, n?: string) => ' '.repeat(Math.min(Number(n ?? 1), 1000)))
      .replace(/<\/text:(?:p|h)>|<text:(?:p|h)\b[^>]*\/>/g, '\n')
      .replace(/<[^>]*>/g, ''),
  );
}

const tidy = (text: string) => text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/**
 * The text of a file, or null when it cannot be read (a damaged package, a part too large). Throws for a type
 * not in `EXTRACTABLE`: the caller checks first.
 */
export function extractText(content: Buffer, mime: string): string | null {
  let text: string;
  try {
    if (mime === 'text/plain') text = content.toString('utf8');
    else if (mime === DOCX_MIME || mime === ODT_MIME) {
      const part = zipEntry(content, mime === DOCX_MIME ? 'word/document.xml' : 'content.xml');
      if (!part) return null;
      text = mime === DOCX_MIME ? docxText(part.toString('utf8')) : odtText(part.toString('utf8'));
    } else throw new Error(`no text extraction for ${mime}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('no text extraction')) throw error;
    return null;
  }
  return tidy(text);
}

export const PDF_MIME = 'application/pdf';

/**
 * The text of a PDF, each page under «[pagina N]», or null and the reason in Italian (encrypted, damaged, a scan).
 * Never throws. Past `pages` pages or `ms` milliseconds it gives what it read, with a first line that says so.
 * Node build, no worker thread, nothing fetched: no font, CMap, ICC profile or wasm decoder is loaded, none is
 * needed for text. No OCR.
 */
export async function pdfText(content: Buffer, limits = { pages: 500, ms: 20_000 }): Promise<{ text: string | null; motivo: string | null }> {
  const deadline = Date.now() + limits.ms;
  // An ES module: tsc makes this a require(), which Node 22.12+ and 24 load.
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: new Uint8Array(content),
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    disableAutoFetch: true,
    disableStream: true,
    enableXfa: false,
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    const total = doc.numPages;
    const pages: string[] = [];
    let chars = 0;
    let note = total > limits.pages ? `[testo parziale: il PDF ha ${total} pagine, lette le prime ${limits.pages}]` : '';
    for (let n = 1; n <= Math.min(total, limits.pages); n++) {
      // shortcut: the clock is checked between pages, so one page that spins the CPU is not cut; a worker thread
      // with a hard kill would be, if a real file ever does it.
      if (Date.now() >= deadline) {
        note = `[testo parziale: tempo scaduto, lette ${n - 1} pagine su ${total}]`;
        break;
      }
      const items = (await (await doc.getPage(n)).getTextContent()).items;
      const text = items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join('');
      chars += text.trim().length;
      pages.push(`[pagina ${n}]\n${tidy(text)}`);
    }
    if (!chars && !note) return { text: null, motivo: 'Il PDF non contiene testo: è una scansione.' };
    return { text: tidy([note, ...pages].filter(Boolean).join('\n\n')), motivo: null };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'PasswordException') return { text: null, motivo: 'Testo non estraibile: il PDF è protetto da password.' };
    return { text: null, motivo: 'Testo non estraibile: il PDF è danneggiato o non è un PDF valido.' };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

// ─── Writing ─────────────────────────────────────────────────────────────────────────────────────────────

// Characters XML 1.0 does not allow: Word refuses a document that has one.
// eslint-disable-next-line no-control-regex
const xmlEscape = (text: string) => text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const run = (text: string, bold: boolean, size?: number) =>
  `<w:r>${bold || size ? `<w:rPr>${bold ? '<w:b/>' : ''}${size ? `<w:sz w:val="${size}"/>` : ''}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;

function paragraph(line: string): string {
  const heading = /^(#{1,6})\s+(.*)$/.exec(line);
  const text = heading ? heading[2] : line;
  if (!text) return '<w:p/>';
  // `**bold**` alternates with plain text: the odd pieces are bold. A heading is bold whole.
  const runs = text.split(/\*\*(.+?)\*\*/).map((piece, i) => (piece ? run(piece, Boolean(heading) || i % 2 === 1, heading ? 32 - heading[1].length * 2 : undefined) : ''));
  return `<w:p>${runs.join('')}</w:p>`;
}

/** A ZIP of stored entries: no compression needed for a few kilobytes of XML, and nothing to get wrong. */
function zipStored(entries: [string, string][]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const body = Buffer.from(text, 'utf8');
    const fileName = Buffer.from(name, 'utf8');
    const crc = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0x21, 12); // 1 January 1980, the DOS epoch
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(body.length, 24);
    entry.writeUInt16LE(fileName.length, 28);
    entry.writeUInt32LE(offset, 42);
    parts.push(local, fileName, body);
    central.push(entry, fileName);
    offset += 30 + fileName.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** The smallest DOCX Word, LibreOffice and Pages open: content types, the package's relationship, the document. */
export function textToDocx(text: string): Buffer {
  const body = text.replace(/\r\n?/g, '\n').split('\n').map(paragraph).join('');
  return zipStored([
    [
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ],
    [
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ],
    ['word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`],
  ]);
}
