import { useState } from 'react';

/** The text typed in a Forum space, by the space's key, for the session: a space closed to open another keeps it. */
const drafts = new Map<string, string>();

/**
 * A space's draft (LC145, «no silent loss»): one space at a time stays, but closing a space, by its own Esc or
 * «Annulla» or because another opened, keeps what was typed, found again when it reopens. `clear` after the server took
 * it. Another key reads that key's draft.
 */
export function useSpaceDraft(key: string): [string, (value: string) => void, () => void] {
  const [state, setState] = useState(() => ({ key, value: drafts.get(key) ?? '' }));
  const value = state.key === key ? state.value : drafts.get(key) ?? '';
  const set = (next: string) => {
    if (next) drafts.set(key, next);
    else drafts.delete(key);
    setState({ key, value: next });
  };
  const clear = () => set('');
  return [value, set, clear];
}
