import type { Progressi } from '../../../../types/studia';
import { MATERIA_LABEL } from '../studiaLabels';
import { addDays, formatDayLong } from './layout';

/** «Oggi»'s pure decisions (Gymnasium spec §5.1, §5.2): what the action card says, and the road's order; and what the lesson's end offers (§5.4). */

type Stop = Progressi['materie'][number];

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The order of the road (Gymnasium spec §5.2 as corrected): what still asks for work first — the cards
 * new and in learning — then by name. «Da ripassare» by subject is not in the progress read; it comes with
 * the institute read of G5.
 */
export function orderStops(materie: readonly Stop[]): Stop[] {
  const open = (stop: Stop) => stop.nuove + stop.apprendimento;
  return [...materie].sort((a, b) => open(b) - open(a) || MATERIA_LABEL[a.materia].localeCompare(MATERIA_LABEL[b.materia], 'it'));
}

/** «3 nuove · 5 in apprendimento · 2 consolidate»: the bar's three states in words, never by colour alone. */
export function stopStates(stop: Stop): string {
  return [
    count(stop.nuove, 'nuova', 'nuove'),
    `${stop.apprendimento} in apprendimento`,
    count(stop.consolidate, 'consolidata', 'consolidate'),
  ].join(' · ');
}

/**
 * The next day with cards, from the coming days the server sent (today first): «domani», «martedì 21
 * ottobre», or null when none is due in the fortnight. `prossimi` counts the cards already studied: new
 * cards still waiting (today's quota of them used up) come tomorrow. The web formats the server's days,
 * never computes one.
 */
export function nextDueDay(data: Progressi): string | null {
  if (data.stati.nuove > 0) return 'domani';
  const next = data.prossimi.find((day) => day.giorno > data.oggi.giorno && day.schede > 0);
  if (!next) return null;
  return next.giorno === addDays(data.oggi.giorno, 1) ? 'domani' : formatDayLong(next.giorno);
}

/**
 * What the card shows: the first read travelling or failed, no card at all yet, done for today, or cards
 * to review. Narrowed to a subject, no card is «done» in that subject, never «no card at all».
 */
export type TodayState = 'loading' | 'unread' | 'empty' | 'done' | 'todo';

export function todayState(data: Progressi | null, failed: boolean, filtered: boolean): TodayState {
  if (data === null) return failed ? 'unread' : 'loading';
  const { stati } = data;
  if (cardsLeft(data) > 0) return 'todo';
  return !filtered && stati.nuove + stati.apprendimento + stati.consolidate === 0 ? 'empty' : 'done';
}

/**
 * The cards still on today in a read's scope: those still due and the new ones today still allows. The lesson's
 * end offers «Continua» when there are any (the session carries at most 500 due cards, and the settings may have
 * raised the new ones meanwhile); never a count the server did not give.
 */
export function cardsLeft(data: Progressi): number {
  return data.oggi.dovute + data.oggi.nuove;
}
