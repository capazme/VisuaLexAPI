import type { Dossier } from '../../../types';

export type SortKey = 'updated' | 'name' | 'created' | 'items';
export type SortDir = 'asc' | 'desc';
export type ListMode = 'schede' | 'lista';

export const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: 'updated', label: 'Più recenti' },
  { id: 'name', label: 'Nome A–Z' },
  { id: 'created', label: 'Creazione' },
  { id: 'items', label: 'Elementi' },
];

/** The way each order reads first: newest and largest on top, names from A. */
export const DEFAULT_DIR: Record<SortKey, SortDir> = { updated: 'desc', name: 'asc', created: 'desc', items: 'desc' };

const time = (value: string | undefined): number | null => {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(t) ? null : t;
};

/** The latest of its creation and the last item added; the API has no «updatedAt» for a pratica. */
export function lastTouched(d: Dossier): number | null {
  const stamps = [time(d.createdAt), ...d.items.map((i) => time(i.addedAt))].filter((t): t is number => t !== null);
  return stamps.length ? Math.max(...stamps) : null;
}

function valueOf(d: Dossier, key: SortKey): number | string | null {
  switch (key) {
    case 'name': return d.title;
    case 'items': return d.items.length;
    case 'created': return time(d.createdAt);
    default: return lastTouched(d);
  }
}

/** Pinned first, as before; then the chosen order, a missing value last in either direction. */
export function sortDossiers(list: Dossier[], key: SortKey, dir: SortDir): Dossier[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
    const x = valueOf(a, key);
    const y = valueOf(b, key);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const cmp = typeof x === 'string' ? x.localeCompare(y as string, 'it') : x - (y as number);
    return cmp * sign;
  });
}

const STORAGE_KEY = 'lexcraft.pratiche.vista';
export interface ListPrefs { mode: ListMode; sort: SortKey; dir: SortDir }
const FALLBACK: ListPrefs = { mode: 'schede', sort: 'updated', dir: 'desc' };

export function readListPrefs(): ListPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!raw) return FALLBACK;
    return {
      mode: raw.mode === 'lista' ? 'lista' : 'schede',
      sort: SORT_OPTIONS.some((o) => o.id === raw.sort) ? raw.sort : FALLBACK.sort,
      dir: raw.dir === 'asc' ? 'asc' : 'desc',
    };
  } catch {
    return FALLBACK;
  }
}

export function writeListPrefs(prefs: ListPrefs): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* storage blocked: the choice lasts the visit */ }
}
