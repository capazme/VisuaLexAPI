import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadThread, saveThread, clearThread } from '../qaThreadStorage';
import type { QaTurnModel } from '../types';

// The project's test setup ships a partial localStorage mock; install a working
// in-memory Storage so this suite exercises the real read/write path.
function installMemoryStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length() { return store.size; },
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  } as Storage);
}

const answer = {
  trace_id: 't1', synthesis: 'S', mode: 'convergent',
  sources: [], retrieved_sources: [], experts_used: ['literal'],
  confidence: 0.8, execution_time_ms: 10,
};
const success = (id: string): QaTurnModel => ({
  id, question: 'q', state: { status: 'success', answer: { ...answer, trace_id: id } }, confirmed: {},
});
const loading = (id: string): QaTurnModel => ({
  id, question: 'q', state: { status: 'loading' }, confirmed: {},
});

beforeEach(() => installMemoryStorage());

describe('qaThreadStorage', () => {
  it('round-trips completed turns', () => {
    saveThread([success('a'), success('b')]);
    const loaded = loadThread();
    expect(loaded.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('drops loading/non-success turns on save+load', () => {
    saveThread([success('a'), loading('b')]);
    expect(loadThread().map((t) => t.id)).toEqual(['a']);
  });

  it('clearThread empties storage', () => {
    saveThread([success('a')]);
    clearThread();
    expect(loadThread()).toEqual([]);
  });

  it('returns [] when nothing stored or malformed', () => {
    expect(loadThread()).toEqual([]);
    localStorage.setItem('merlt-qa-thread-v1', 'not json');
    expect(loadThread()).toEqual([]);
  });
});
