import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  clampColumnWidth,
  COLUMN_WIDTH_DEFAULT,
  COLUMN_WIDTH_MAX,
  COLUMN_WIDTH_MIN,
  COLUMN_WIDTH_STORAGE_KEY,
  readStoredColumnWidth,
} from '../columnWidth';

// The project's test setup ships a partial localStorage mock (see
// qaThreadStorage.test.ts) — install a working in-memory Storage so this
// suite exercises the real read/write path.
function installMemoryStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length() {
      return store.size;
    },
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  } as Storage);
}

describe('clampColumnWidth', () => {
  it('passes a value already in range through unchanged', () => {
    expect(clampColumnWidth(450)).toBe(450);
  });

  it('clamps below the minimum', () => {
    expect(clampColumnWidth(100)).toBe(COLUMN_WIDTH_MIN);
  });

  it('clamps above the maximum', () => {
    expect(clampColumnWidth(9999)).toBe(COLUMN_WIDTH_MAX);
  });

  it('falls back to the default for NaN/Infinity', () => {
    expect(clampColumnWidth(Number.NaN)).toBe(COLUMN_WIDTH_DEFAULT);
    expect(clampColumnWidth(Number.POSITIVE_INFINITY)).toBe(COLUMN_WIDTH_DEFAULT);
  });

  it('rounds fractional widths', () => {
    expect(clampColumnWidth(420.6)).toBe(421);
  });
});

describe('readStoredColumnWidth', () => {
  beforeEach(() => installMemoryStorage());

  it('returns the default when nothing is stored', () => {
    expect(readStoredColumnWidth()).toBe(COLUMN_WIDTH_DEFAULT);
  });

  it('returns the clamped stored value', () => {
    localStorage.setItem(COLUMN_WIDTH_STORAGE_KEY, '9999');
    expect(readStoredColumnWidth()).toBe(COLUMN_WIDTH_MAX);
  });

  it('returns a valid in-range stored value as-is', () => {
    localStorage.setItem(COLUMN_WIDTH_STORAGE_KEY, '500');
    expect(readStoredColumnWidth()).toBe(500);
  });
});
