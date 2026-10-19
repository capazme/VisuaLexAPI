import type { QaTurnModel } from './types';

/**
 * localStorage persistence for the active Q&A thread (Loop β #1, option A).
 *
 * Keeps the conversation across a page reload. Only completed turns are kept —
 * a turn that was still loading (or errored) when the page closed has no live
 * request to resume, so it is dropped on hydration. Capped to the most recent
 * turns to bound localStorage size.
 */

const STORAGE_KEY = 'merlt-qa-thread-v1';
const MAX_PERSISTED_TURNS = 30;

export function loadThread(): QaTurnModel[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Keep only well-formed, completed turns, and DEDUPE by id (keep the last
    // occurrence): older builds could persist a fresh turn under a reused
    // `turn-N` id, leaving duplicate ids in storage → React duplicate-key
    // errors on render. This heals already-corrupted threads on load.
    const byId = new Map<string, QaTurnModel>();
    for (const t of parsed as QaTurnModel[]) {
      if (t && typeof t.id === 'string' && t.state?.status === 'success') {
        byId.set(t.id, t);
      }
    }
    return [...byId.values()];
  } catch (err) {
    console.error('qaThreadStorage.loadThread failed:', err);
    return [];
  }
}

export function saveThread(turns: QaTurnModel[]): void {
  try {
    const completed = turns.filter((t) => t.state.status === 'success').slice(-MAX_PERSISTED_TURNS);
    if (completed.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(completed));
  } catch (err) {
    console.error('qaThreadStorage.saveThread failed:', err);
  }
}

export function clearThread(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.error('qaThreadStorage.clearThread failed:', err);
  }
}
