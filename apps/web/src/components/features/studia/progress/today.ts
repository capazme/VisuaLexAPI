import type { ConteggiStati, Materia, Progressi, TappaIstituto } from '../../../../types/studia';
import { MATERIA_LABEL } from '../studiaLabels';
import { addDays, formatDayLong } from './layout';

/** «Oggi»'s pure decisions (Gymnasium spec §5.1, §5.2): what the action card says, and the road's order. */

type Stop = Progressi['materie'][number];

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The order of the road (Gymnasium spec §5.2 as corrected): what still asks for work first — the cards
 * new and in learning — then by name. It stays so with the institute read of G5, which answers later and
 * would otherwise move the stops under the reader's hand.
 */
export function orderStops(materie: readonly Stop[]): Stop[] {
  const open = (stop: Stop) => stop.nuove + stop.apprendimento;
  return [...materie].sort((a, b) => open(b) - open(a) || MATERIA_LABEL[a.materia].localeCompare(MATERIA_LABEL[b.materia], 'it'));
}

/** «3 nuove · 5 in apprendimento · 2 consolidate»: the bar's three states in words, never by colour alone. */
export function stopStates(stop: ConteggiStati): string {
  return [
    count(stop.nuove, 'nuova', 'nuove'),
    `${stop.apprendimento} in apprendimento`,
    count(stop.consolidate, 'consolidata', 'consolidate'),
  ].join(' · ');
}

/**
 * The institutes of one subject on the road (Gymnasium spec §5.2, G5): the most cards due first, then by name
 * as an Italian reader sorts it. Free stops: the order says where the work is, it locks nothing.
 */
export function orderInstitutes(stops: readonly TappaIstituto[], materia: Materia): TappaIstituto[] {
  return stops.filter((stop) => stop.materia === materia).sort((a, b) => b.dovute - a.dovute || a.istituto.localeCompare(b.istituto, 'it'));
}

/** The cards due today by subject, the sum of its institutes': what the subject's stop says. */
export function dueBySubject(stops: readonly TappaIstituto[]): Map<Materia, number> {
  const due = new Map<Materia, number>();
  for (const stop of stops) due.set(stop.materia, (due.get(stop.materia) ?? 0) + stop.dovute);
  return due;
}

/** «3 da ripassare», or «Niente da ripassare» (new cards are not «da ripassare»: the bar says them). */
export function dueLabel(dovute: number): string {
  return dovute === 0 ? 'Niente da ripassare' : `${dovute} da ripassare`;
}

/** The session narrowed to one institute of a subject, the institute spelt as the read gave it (`GET /lingo/srs/sessione`). */
export function instituteSessionPath(materia: Materia, istituto: string): string {
  return `/studia/ripasso/sessione?${new URLSearchParams({ materia, istituto }).toString()}`;
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
  const { oggi, stati } = data;
  if (oggi.dovute + oggi.nuove > 0) return 'todo';
  return !filtered && stati.nuove + stati.apprendimento + stati.consolidate === 0 ? 'empty' : 'done';
}
