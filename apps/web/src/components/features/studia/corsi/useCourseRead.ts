import { useCallback, useEffect, useState } from 'react';
import { isNotFound, isUnreachable } from '../../../../services/corsiService';

export type CourseReadState<T> =
  | { status: 'loading'; data: T | null }
  | { status: 'error'; data: T | null; offline: boolean; notFound: boolean }
  | { status: 'ready'; data: T };

/** The reads on screen, read again when a write elsewhere changed a course («Annulla» after a deletion). */
const listeners = new Set<() => void>();

/** A course was written (restored from the trash, renamed, trimmed): every read of «Percorsi» on screen reads again. */
export function coursesChanged(): void {
  for (const listener of [...listeners]) listener();
}

interface Answer<T> {
  key: string;
  data: T | null;
  error: unknown;
}

/**
 * One read of «Percorsi» (the list, a course, «Oggi»'s row), read again when the user comes back to the page (spec
 * §6.3: the assistant may have added modules meanwhile), when the browser is back online and after `coursesChanged`.
 * While a new read of the same thing travels the last answer stays on screen, so the page does not jump; an answer for
 * another key is never shown. A failure says whether the browser was offline and whether the server answered 404.
 * With `enabled` false nothing is read.
 */
export function useCourseRead<T>(read: () => Promise<T>, key: string, enabled = true): CourseReadState<T> & { reload: () => void } {
  const [reads, setReads] = useState(0);
  const readKey = `${key}#${reads}`;
  const [answer, setAnswer] = useState<Answer<T>>({ key: '', data: null, error: null });

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    read().then(
      (data) => live && setAnswer({ key: readKey, data, error: null }),
      (error: unknown) => {
        if (!live) return;
        console.warn('[Percorsi] read failed', key, error);
        setAnswer((previous) => ({ key: readKey, data: previous.key.startsWith(`${key}#`) ? previous.data : null, error: error ?? new Error('failed') }));
      },
    );
    return () => {
      live = false;
    };
    // `read` is the caller's closure over `key`: the key says when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readKey, enabled]);

  const reload = useCallback(() => setReads((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', reload);
    listeners.add(reload);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', reload);
      listeners.delete(reload);
    };
  }, [enabled, reload]);

  const sameThing = answer.key.startsWith(`${key}#`);
  if (answer.key !== readKey) return { status: 'loading', data: sameThing ? answer.data : null, reload };
  if (answer.error !== null || answer.data === null) {
    return { status: 'error', data: answer.data, offline: isUnreachable(answer.error), notFound: isNotFound(answer.error), reload };
  }
  return { status: 'ready', data: answer.data, reload };
}
