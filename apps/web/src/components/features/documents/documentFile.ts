/**
 * Reads the document «Analizza documento» is given, in the browser: the file is never sent anywhere.
 * TXT and Markdown as they are, HTML as its text, DOCX through `docx/` (its body and its notes).
 */
import { DocxError, type DocxErrorCode } from './docx/docxErrors';
import { readDocxFile } from './docx/docxWorkerClient';

/** 15 MB: the limit the page announces. */
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

/** What the hidden input offers; a PDF is accepted only to explain why it cannot be read. */
export const DOCUMENT_ACCEPT = '.txt,.md,.markdown,.html,.htm,.docx,.pdf';

export type DocumentReading = { ok: true; text: string } | { ok: false; error: string };

function readableText(fileName: string, content: string): string {
  if (/\.html?$/i.test(fileName)) {
    const document = new DOMParser().parseFromString(content, 'text/html');
    return document.body.textContent ?? '';
  }
  return content;
}

/**
 * The text of a DOCX, as Word shows it, read in a Web Worker with the package's bounds (`docx/`, spec #391 §6.1):
 * the body, then its footnotes and endnotes under «Note». The map from each character back to the XML is in
 * `readDocxFile`'s answer; this keeps the text only.
 */
export async function readDocx(file: File): Promise<string> {
  return (await readDocxFile(file)).text;
}

/** The words for a DOCX refused for a reason the user can act on; any other gets the page's general words. */
const DOCX_REFUSALS: Partial<Record<DocxErrorCode, string>> = {
  encrypted: 'Il documento è protetto da password: aprilo in Word, togli la password e salvalo di nuovo.',
  strict: 'Salva il file da Word come «Documento Word» e riprova.',
  too_large: 'Il documento ha parti troppo grandi o troppo compresse per leggerlo nel browser in sicurezza.',
  timeout: 'La lettura del documento ha richiesto troppo tempo. Il file non è stato inviato al server.',
};

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
  } catch (error) {
    const refusal = error instanceof DocxError ? DOCX_REFUSALS[error.code] : undefined;
    return { ok: false, error: refusal ?? 'Impossibile leggere il documento localmente.' };
  }
}
