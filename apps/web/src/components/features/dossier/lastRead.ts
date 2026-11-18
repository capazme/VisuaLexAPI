/**
 * The last article read in each dossier (LC86), kept in this browser: its act's key, its row's key (`practiceArticleKey`,
 * which names the version too) and how far into the row the reading was, in pixels. «Fonti» opens with every row
 * closed but that one, opened again where it was. A convenience of this browser, never sent to the server; removed
 * when a session ends (`BROWSER_STORAGE`, kind `user`), so the next person on the browser does not see what the last
 * one read.
 */
const STORAGE_KEY = 'visualex-dossier-last-read';

export interface LastRead {
  act: string;
  article: string;
  offset: number;
}

function readAll(): Record<string, unknown> {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return kept && typeof kept === 'object' && !Array.isArray(kept) ? kept as Record<string, unknown> : {};
  } catch {
    // Private mode, or a value that is not ours: nothing kept.
    return {};
  }
}

export function lastReadOf(dossierId: string): LastRead | null {
  const kept = readAll()[dossierId] as Partial<LastRead> | undefined;
  if (!kept || typeof kept.act !== 'string' || typeof kept.article !== 'string') return null;
  return { act: kept.act, article: kept.article, offset: Math.max(0, Number(kept.offset) || 0) };
}

export function keepLastRead(dossierId: string, read: LastRead): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [dossierId]: read }));
  } catch {
    // Private mode or a full storage: the next opening starts with every row closed.
  }
}
