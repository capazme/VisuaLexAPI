import { openZip } from '../documents/docx/zipPackage';
import { writeZip } from '../documents/docx/zipWriter';

/**
 * An act written with the old editor as a Word file (LC53), built in the browser with the web's own ZIP writer: the
 * title in bold, then one paragraph per line of the text. No styles part: Word and LibreOffice open it with their
 * defaults.
 */
const EMPTY_ZIP = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);

// XML 1.0 refuses control characters and lone surrogates: dropped, then the five specials escaped.
const xmlText = (text: string) =>
  text
    .replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const paragraph = (text: string, bold = false) =>
  text ? `<w:p><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xmlText(text)}</w:t></w:r></w:p>` : '<w:p/>';

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '</Types>';

const RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '</Relationships>';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function attoDocx(titolo: string, testo: string): Promise<Blob> {
  const body = [paragraph(titolo, true), ...testo.split(/\r\n|\r|\n/).map((line) => paragraph(line))].join('');
  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:body>${body}</w:body></w:document>`;
  const encoder = new TextEncoder();
  const bytes = await writeZip(openZip(EMPTY_ZIP), new Map(), [
    { name: '[Content_Types].xml', data: encoder.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: encoder.encode(RELS) },
    { name: 'word/document.xml', data: encoder.encode(document) },
  ]);
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: DOCX_MIME });
}
