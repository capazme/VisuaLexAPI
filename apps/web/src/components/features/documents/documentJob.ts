/** The file «Analizza documento» is given, as its row shows it (D6): its kind, its size, where its reading is. */

/** The kinds of document, by their name: their colour on the row, in the Inchiostro tones (D6). */
export type DocumentKind = 'docx' | 'html' | 'md' | 'txt' | 'other';

export function documentKind(fileName: string): DocumentKind {
  if (/\.docx$/i.test(fileName)) return 'docx';
  if (/\.html?$/i.test(fileName)) return 'html';
  if (/\.(md|markdown)$/i.test(fileName)) return 'md';
  if (/\.txt$/i.test(fileName)) return 'txt';
  return 'other';
}

const sizeFormat = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });

/** «840 KB», «2,4 MB». */
export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${sizeFormat.format(Math.max(1, Math.round(bytes / 1024)))} KB`;
  return `${sizeFormat.format(bytes / (1024 * 1024))} MB`;
}

export type DocumentStage = 'reading' | 'searching' | 'done' | 'error';

export interface DocumentJob {
  /** Counts the files: a new one is a new row. */
  id: number;
  name: string;
  bytes: number;
  kind: DocumentKind;
  stage: DocumentStage;
  error?: string;
}

