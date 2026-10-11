import { describe, it, expect, vi } from 'vitest';
import { guardedStorage } from '../guardedStorage';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (name: string) => data.get(name) ?? null,
    setItem: (name: string, value: string) => { data.set(name, value); },
    removeItem: (name: string) => { data.delete(name); },
  };
}

describe('guardedStorage', () => {
  it('passes reads, writes and removals through to the storage it wraps', () => {
    const target = memoryStorage();
    const onFail = vi.fn();
    const storage = guardedStorage(target, onFail);
    storage.setItem('k', 'v');
    expect(target.getItem('k')).toBe('v');
    expect(storage.getItem('k')).toBe('v');
    storage.removeItem('k');
    expect(target.getItem('k')).toBeNull();
    expect(storage.getItem('k')).toBeNull();
    expect(onFail).not.toHaveBeenCalled();
  });

  it('catches a write the storage refuses and reports the key, the size and the error', () => {
    const target = memoryStorage();
    const quota = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    target.setItem = () => { throw quota; };
    const onFail = vi.fn();
    const storage = guardedStorage(target, onFail);
    expect(() => storage.setItem('visualex-storage', 'abcd')).not.toThrow();
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onFail).toHaveBeenCalledWith({ name: 'visualex-storage', bytes: 8, error: quota });
  });

  it('catches any error a write throws, not only a full storage', () => {
    const target = memoryStorage();
    target.setItem = () => { throw new TypeError('denied'); };
    const onFail = vi.fn();
    expect(() => guardedStorage(target, onFail).setItem('k', 'v')).not.toThrow();
    expect(onFail.mock.calls[0][0].error).toBeInstanceOf(TypeError);
  });
});
