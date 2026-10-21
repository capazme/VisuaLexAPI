import { useEffect, useState } from 'react';

const STORAGE_KEY = 'visualex.studia.visto';

/**
 * What this browser last drew of the progress (S2): the streak, and today's reviews and missions done. Gymnasium's
 * small motions play only for what grew since — a tally mark when the streak grows, a digit when the count does, the
 * ink when a mission is done — never at every visit. A convenience of this browser, never a number's source: the
 * numbers drawn are always the read's. With nothing stored (a first visit, private mode) nothing plays.
 */
interface Seen {
  serie?: number;
  /** The server's day of `ripassi` and `missioni`; another day starts them over. */
  giorno?: string;
  ripassi?: number;
  missioni?: string[];
}

function readSeen(): Seen | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Seen) : null;
  } catch {
    return null;
  }
}

/** Merges `patch` into what is stored; a patch for another day drops the day's values first. */
function writeSeen(patch: Seen) {
  const stored = readSeen() ?? {};
  const base = patch.giorno !== undefined && stored.giorno !== patch.giorno ? { serie: stored.serie } : stored;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...base, ...patch }));
  } catch {
    // Private mode or a full store: the next visit may play the motion again.
  }
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * The streak drawn before, when it was shorter than `attuale` (stored, or the previous value while mounted): the
 * tally then draws its new mark. Null when nothing grew. `enabled` false neither reads nor records it (the dense
 * strip draws no tally, and must not use up the growth «Oggi» shows).
 */
export function useStreakGrowth(attuale: number, enabled = true): number | null {
  const [state, setState] = useState(() => {
    const before = enabled ? readSeen()?.serie : undefined;
    return { value: attuale, from: isCount(before) && before < attuale ? before : null };
  });
  if (state.value !== attuale) setState({ value: attuale, from: enabled && attuale > state.value ? state.value : null });
  useEffect(() => {
    if (enabled) writeSeen({ serie: attuale });
  }, [attuale, enabled]);
  return state.from;
}

/**
 * Today's reviews drawn before, when fewer than `ripassi`: the digit then lands. A new day counts from 0. Null when
 * nothing grew, when nothing was ever stored, or without the day.
 */
export function useReviewsGrowth(giorno: string | undefined, ripassi: number): number | null {
  const [state, setState] = useState(() => {
    const seen = giorno ? readSeen() : null;
    const before = seen === null ? undefined : seen.giorno === giorno ? seen.ripassi : 0;
    return { value: ripassi, from: isCount(before) && before < ripassi ? before : null };
  });
  if (state.value !== ripassi) setState({ value: ripassi, from: giorno && ripassi > state.value ? state.value : null });
  useEffect(() => {
    if (giorno) writeSeen({ giorno, ripassi });
  }, [giorno, ripassi]);
  return state.from;
}

/**
 * The missions done that this browser had not yet drawn done today (`done`, their ids): their ink runs. Empty when
 * nothing was ever stored. Records `done`. Mounted with the day's read, so the first answer is not taken for growth.
 */
export function useFreshMissions(giorno: string, done: readonly string[]): ReadonlySet<string> {
  const key = done.join(' ');
  const [state, setState] = useState(() => {
    const seen = readSeen();
    const before = seen === null ? null : seen.giorno === giorno && Array.isArray(seen.missioni) ? seen.missioni : [];
    return { key, fresh: new Set(before === null ? [] : done.filter((id) => !before.includes(id))) };
  });
  if (state.key !== key) {
    const before = state.key.split(' ');
    setState({ key, fresh: new Set([...state.fresh].filter((id) => done.includes(id)).concat(done.filter((id) => !before.includes(id)))) });
  }
  useEffect(() => {
    writeSeen({ giorno, missioni: key ? key.split(' ') : [] });
  }, [giorno, key]);
  return state.fresh;
}
