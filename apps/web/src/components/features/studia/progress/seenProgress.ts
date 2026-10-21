import { useEffect, useState } from 'react';
import type { XpEsito } from '../../../../types/studia';

const STORAGE_KEY = 'visualex.studia.visto';

/**
 * Forgets what this browser drew, at a sign-in and a sign-out (`useAuth`): the record is the browser's, not the
 * user's, and the next person on it must not read the last one's points as «+N XP» or their level (G-316).
 */
export function forgetSeenProgress() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode: nothing was kept.
  }
}

/**
 * What this browser last drew of the progress (S2): the streak, today's reviews and missions done, and the points and
 * the level (G1c). Gymnasium's small motions play only for what grew since — a tally mark when the streak grows, a
 * digit when the count does, the ink when a mission is done, «+20 XP» and a new level — never at every visit. A
 * convenience of this browser, never a number's source: the numbers drawn are always the read's. With nothing stored
 * (a first visit, private mode) nothing plays.
 */
interface Seen {
  serie?: number;
  /** The total of points and the level last drawn: not a day's, they never start over. */
  xp?: number;
  livello?: number;
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
  const base = patch.giorno !== undefined && stored.giorno !== patch.giorno ? { serie: stored.serie, xp: stored.xp, livello: stored.livello } : stored;
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

/**
 * Records what a surface showed itself (the lesson's «+20 XP», a proposal's or a vote's message), so «Oggi» does not
 * show it again: only this event's credits, and the level only when this event crossed it. Credits written silently
 * before (a session read's) stay for «Oggi» to show, and a level they crossed to be pressed in there.
 */
export function recordXpSeen(xp: XpEsito) {
  const seen = readSeen();
  const earned = xp.crediti.reduce((sum, credit) => sum + credit.punti, 0);
  const before = seen?.xp;
  const level = seen?.livello;
  writeSeen({
    xp: isCount(before) ? Math.min(before + earned, xp.livello.totale) : xp.livello.totale,
    livello: xp.nuovoLivello || !isCount(level) ? xp.livello.livello : level,
  });
}

/**
 * The points and the level drawn before, when they were lower (stored, or the previous values while mounted): `gain`,
 * the points earned since, and `levelUp`, a level this browser has not yet shown. Null and false when nothing grew,
 * or when nothing was ever stored (a first visit, or the first since points exist). Records what it is given.
 */
export function useXpGrowth(totale: number, livello: number): { gain: number | null; levelUp: boolean } {
  const [state, setState] = useState(() => {
    const seen = readSeen();
    const before = seen?.xp;
    const level = seen?.livello;
    return {
      totale,
      livello,
      gain: isCount(before) && before < totale ? totale - before : null,
      levelUp: isCount(level) && level < livello,
    };
  });
  if (state.totale !== totale || state.livello !== livello) {
    setState({
      totale,
      livello,
      gain: totale > state.totale ? totale - state.totale : null,
      levelUp: livello > state.livello,
    });
  }
  useEffect(() => {
    writeSeen({ xp: totale, livello });
  }, [totale, livello]);
  return { gain: state.gain, levelUp: state.levelUp };
}
