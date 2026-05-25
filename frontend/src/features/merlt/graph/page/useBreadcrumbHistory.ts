import { useCallback, useState } from 'react';

export const BREADCRUMB_STORAGE_KEY = 'merlt-graph-breadcrumb';
const CAP = 5;

export interface BreadcrumbEntry {
  urn: string;
  label: string;
}

function read(): BreadcrumbEntry[] {
  try {
    const raw = sessionStorage.getItem(BREADCRUMB_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(entries: BreadcrumbEntry[]): void {
  try {
    sessionStorage.setItem(BREADCRUMB_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* sessionStorage unavailable (private mode quota) — degrade silently */
  }
}

/**
 * Session-scoped navigation history of graph centers (max 5). Backed by
 * sessionStorage so it survives a /grafo refresh but not a new tab/session.
 * Consecutive pushes of the same urn update the label in place rather than
 * duplicating, so re-centering on the current node is a no-op visually.
 */
export function useBreadcrumbHistory() {
  const [entries, setEntries] = useState<BreadcrumbEntry[]>(read);

  const push = useCallback((entry: BreadcrumbEntry) => {
    setEntries((prev) => {
      const last = prev[prev.length - 1];
      let next: BreadcrumbEntry[];
      if (last && last.urn === entry.urn) {
        next = [...prev.slice(0, -1), entry];
      } else {
        next = [...prev, entry].slice(-CAP);
      }
      persist(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setEntries([]);
    persist([]);
  }, []);

  return { entries, push, clear };
}
