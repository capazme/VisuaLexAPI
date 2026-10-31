/**
 * Reads the document «Analizza documento» is given, in the browser: the file is never sent anywhere.
 * TXT and Markdown as they are, HTML as its text with a line break after each block, DOCX from its main XML part.
 */

/** 15 MB: the limit the page announces. */
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

/** What the hidden input offers; a PDF is accepted only to explain why it cannot be read. */
export const DOCUMENT_ACCEPT = '.txt,.md,.markdown,.html,.htm,.docx,.pdf';

export type DocumentReading = { ok: true; text: string } | { ok: false; error: string };

/** The elements that end a paragraph: each ends with one line break in the text read (design 2026-10-29 §4.6). */
const HTML_BLOCKS = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'BLOCKQUOTE']);

/**
 * An HTML document's text: its characters as `textContent` gives them, and a line break at the end of each block
 * (`p`, `div`, `li`, `h1`–`h6`, `tr`, `blockquote`) and for each `br` — a paragraph is a line for «Analizza
 * documento», and `textContent` put none between two `<p>`. Nothing else is added or dropped. A block nested in
 * another adds no second break.
 */
export function htmlText(content: string): string {
  const body = new DOMParser().parseFromString(content, 'text/html').body;
  const parts: string[] = [];
  let endsWithBreak = true;
  const add = (piece: string) => {
    if (!piece) return;
    parts.push(piece);
    endsWithBreak = piece.endsWith('\n');
  };
  const walk = (node: Node) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE) {
        add(child.nodeValue ?? '');
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = (child as Element).tagName.toUpperCase();
        if (tag === 'BR') {
          add('\n');
          continue;
        }
        walk(child);
        if (HTML_BLOCKS.has(tag) && !endsWithBreak) add('\n');
      }
    }
  };
  walk(body);
  return parts.join('');
}

function readableText(fileName: string, content: string): string {
  return /\.html?$/i.test(fileName) ? htmlText(content) : content;
}

function decodeXml(value: string): string {
  const parser = new DOMParser();
  return parser.parseFromString(`<span>${value}</span>`, 'text/html').body.textContent ?? value;
}

/** Extracts the main XML part from a DOCX without sending the file anywhere. */
export async function readDocx(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const eocd = 0x06054b50;
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (view.getUint32(offset, true) === eocd) { end = offset; break; }
  }
  if (end < 0) throw new Error('Archivio DOCX non valido');

  const entries = view.getUint16(end + 10, true);
  const centralOffset = view.getUint32(end + 16, true);
  let cursor = centralOffset;
  let documentXml: Uint8Array | null = null;
  for (let index = 0; index < entries; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('Indice DOCX non valido');
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (name === 'word/document.xml') {
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.subarray(start, start + compressedSize);
      if (method === 0) documentXml = compressed;
      else if (method === 8) {
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        documentXml = new Uint8Array(await new Response(stream).arrayBuffer());
      } else throw new Error('Compressione DOCX non supportata');
      break;
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (!documentXml) throw new Error('Testo principale DOCX non trovato');

  const xml = decoder.decode(documentXml);
  return decodeXml(xml
    .replace(/<w:tab\s*\/?\s*>/gi, '\t')
    .replace(/<w:br\s*\/?\s*>/gi, '\n')
    .replace(/<\/w:p>/gi, '\n')
    .replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/gi, '$1')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The checks and the words of the page, in the order it has always made them. */
export async function readDocumentFile(file: File): Promise<DocumentReading> {
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: 'Il documento supera il limite locale di 15 MB.' };
  }
  if (/\.pdf$/i.test(file.name)) {
    return { ok: false, error: 'I PDF scansionati o non testuali richiedono OCR. Per ora importa un PDF testuale o copia il testo in formato TXT/HTML. Il file non è stato inviato al server.' };
  }
  if (!/\.(txt|md|markdown|html?|docx)$/i.test(file.name)) {
    return { ok: false, error: 'Formato non supportato. Usa TXT, Markdown, HTML o DOCX.' };
  }
  try {
    const content = /\.docx$/i.test(file.name) ? await readDocx(file) : readableText(file.name, await file.text());
    if (!content.trim()) return { ok: false, error: 'Il documento non contiene testo leggibile.' };
    return { ok: true, text: content };
  } catch {
    return { ok: false, error: 'Impossibile leggere il documento localmente.' };
  }
}
