/**
 * Why a DOCX could not be read (spec 2026-10-31-document-hyperlinks-design.md §6.1). A code, not words: the page
 * chooses the words (`documentFile.ts`), and the code crosses the Worker's boundary as plain data.
 */
export type DocxErrorCode =
  /** Not a ZIP at all, or a ZIP whose records do not hold together. */
  | 'malformed'
  /** A CFB file: what Word writes for a document protected by a password. */
  | 'encrypted'
  /** Strict Open XML: another namespace, which the reader does not walk. */
  | 'strict'
  /** A part over the bounds: too large inflated, too compressed, too many entries, the parts too large together. */
  | 'too_large'
  /** A package no producer writes: duplicate names, `..` or a leading slash, a `<!DOCTYPE`, ZIP64, an encrypted entry. */
  | 'unsafe'
  /** No `word/document.xml`. */
  | 'no_document'
  /** The reading did not end in time (the Worker is stopped). */
  | 'timeout'
  /** A copy cannot be written: the package is digitally signed, and a changed copy would lose the signature (L4). */
  | 'signed';

export class DocxError extends Error {
  readonly code: DocxErrorCode;

  constructor(code: DocxErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'DocxError';
    this.code = code;
  }
}

export function isDocxErrorCode(value: unknown): value is DocxErrorCode {
  return typeof value === 'string'
    && ['malformed', 'encrypted', 'strict', 'too_large', 'unsafe', 'no_document', 'timeout', 'signed'].includes(value);
}
