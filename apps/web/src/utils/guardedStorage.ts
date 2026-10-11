import type { StateStorage } from 'zustand/middleware';

/** A write the browser refused: the key, the size of the value (UTF-16, as browsers count the
 *  quota) and what was thrown. */
export interface StorageFailure {
  name: string;
  bytes: number;
  error: unknown;
}

/**
 * `target` for zustand's `persist` (spec §10, T20): reads and removals pass through; a write that
 * throws — a full `localStorage`, a browser that refuses storage — is caught and handed to
 * `onFail`, never thrown. zustand writes inside every `set`, so an uncaught throw here would come
 * out of every store action.
 */
export function guardedStorage(target: Storage, onFail: (info: StorageFailure) => void): StateStorage {
  return {
    getItem: (name) => target.getItem(name),
    removeItem: (name) => target.removeItem(name),
    setItem: (name, value) => {
      try {
        target.setItem(name, value);
      } catch (error) {
        onFail({ name, bytes: value.length * 2, error });
      }
    },
  };
}
