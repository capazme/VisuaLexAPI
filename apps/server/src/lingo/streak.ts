import { addDays, daysBetween } from './studyDay';

/**
 * The study streak (Studia progress spec D7, D8): the one definition of the current run, the best run,
 * the last seven days and the rest days. A pure function over Rome days ('YYYY-MM-DD'); the caller says
 * which stored days counted and whether today counts yet.
 *
 * Walking forward from the earliest counted day: a counted day adds one. Today, not counted yet, is open
 * and changes nothing, so a streak is never shown broken before the day is over. Any other missed day is
 * a rest when the run is going and no rest fell in the six days before it (rest days are at least seven
 * days apart); otherwise it breaks the run. A rest keeps the run and adds nothing to it.
 */

export type DayState = 'fatto' | 'riposo' | 'saltato' | 'oggi';

export interface Streak {
  /** Counted days in the current run, today included once it counts. */
  attuale: number;
  /** The longest run ever reached, the current one included. */
  record: number;
  /** The last seven days, oldest first; the last is today. */
  ultimiGiorni: { giorno: string; stato: DayState }[];
  /** Every rest day of the history, for the calendar. */
  riposi: Set<string>;
}

/** The least number of days from one rest to the next. */
export const REST_SPACING_DAYS = 7;
const LAST_DAYS = 7;

export function computeStreak(validDays: Iterable<string>, today: string, todayCounts: boolean): Streak {
  const counted = new Set<string>();
  for (const day of validDays) if (day < today) counted.add(day);
  if (todayCounts) counted.add(today);

  const states = new Map<string, DayState>();
  const riposi = new Set<string>();
  let run = 0;
  let record = 0;
  let lastRest: string | null = null;

  let first: string | null = null;
  for (const day of counted) if (first === null || day < first) first = day;

  if (first !== null) {
    for (let day = first; day <= today; day = addDays(day, 1)) {
      if (counted.has(day)) {
        run += 1;
        record = Math.max(record, run);
        states.set(day, 'fatto');
      } else if (day === today) {
        states.set(day, 'oggi');
      } else if (run > 0 && (lastRest === null || daysBetween(lastRest, day) >= REST_SPACING_DAYS)) {
        lastRest = day;
        riposi.add(day);
        states.set(day, 'riposo');
      } else {
        run = 0;
        lastRest = null;
        states.set(day, 'saltato');
      }
    }
  }

  const ultimiGiorni = [];
  for (let back = LAST_DAYS - 1; back >= 0; back--) {
    const giorno = addDays(today, -back);
    ultimiGiorni.push({ giorno, stato: states.get(giorno) ?? (giorno === today ? 'oggi' : 'saltato') });
  }
  return { attuale: run, record, ultimiGiorni, riposi };
}
