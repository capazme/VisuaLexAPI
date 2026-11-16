/** How long the instructions wait after the last keystroke before they save. */
export const SAVE_DELAY_MS = 800;

/** «15 novembre» this year, «15 novembre 2025» before. */
export function changedOn(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** «250 KB», «1,2 MB». */
export function weight(bytes: number): string {
  if (bytes < 1000 * 1000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1000 / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MB`;
}

const KINDS: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/msword': 'Word',
  'application/vnd.oasis.opendocument.text': 'ODT',
  'application/rtf': 'RTF',
  'text/plain': 'TXT',
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
};

/** The file's kind in a word, from the type the server read in its content. */
export function kindOf(mime: string): string {
  return KINDS[mime] ?? 'File';
}

/** A file name from an act's title: no characters a file system refuses. */
export function fileNameOf(title: string, extension: string): string {
  return `${title.trim().replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 100).trim() || 'atto'}.${extension}`;
}
