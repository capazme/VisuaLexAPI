import { useCallback, useState } from 'react';

/**
 * Page-local "dev mode" toggle for the Q&A view — reveals the pipeline trace
 * (process details) under each answer. Persisted in localStorage so it survives
 * reloads; available to any Q&A user (opt-in, off by default).
 */

const STORAGE_KEY = 'merlt_qa_dev_mode';

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function useQaDevMode(): [boolean, () => void] {
  const [enabled, setEnabled] = useState<boolean>(read);
  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* localStorage unavailable — keep the in-memory value */
      }
      return next;
    });
  }, []);
  return [enabled, toggle];
}
