import type { ConteggiStati, Materia, Progressi, TappaIstituto } from '../../../../types/studia';
import { MATERIA_LABEL } from '../studiaLabels';
import { addDays, formatCount, formatDayLong } from './layout';

/** «Oggi»'s pure decisions (Gymnasium spec §5.1, §5.2): what the day block says, and the subjects' order; and what the lesson's end offers (§5.4). */

type Stop = Progressi['materie'][number];

const count = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

/**
 * The order of the road (Gymnasium spec §5.2 as corrected): what still asks for work first — the cards
 * new and in learning — then by name. It stays so with the institute read of G5, which answers later and
 * would otherwise move the stops under the reader's hand.
 */
export function orderStops(materie: readonly Stop[]): Stop[] {
  const open = (stop: Stop) => stop.nuove + stop.apprendimento;
  return [...materie].sort((a, b) => open(b) - open(a) || MATERIA_LABEL[a.materia].localeCompare(MATERIA_LABEL[b.materia], 'it'));
}

/** «3 nuove · 5 in apprendimento · 2 consolidate»: the bar's three states in words, never by colour alone; «12.345» grouped. */
export function stopStates(stop: ConteggiStati): string {
  return [
    count(stop.nuove, 'nuova', 'nuove'),
    `${formatCount(stop.apprendimento)} in apprendimento`,
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

/**
 * The cards still on today in one institute of a subject (G5), for the lesson's end: those due in it, and its new
 * ones up to what the subject's read says today still allows (the new-card quota is the day's, not the institute's).
 * Nothing when the road's read does not list the institute.
 */
export function instituteCardsLeft(stops: readonly TappaIstituto[], materia: Materia, istituto: string, subject: Progressi): number {
  const stop = stops.find((s) => s.materia === materia && s.istituto === istituto);
  return stop ? stop.dovute + Math.min(stop.nuove, subject.oggi.nuove) : 0;
}

/** «12 da ripassare, 8 nuove», the day block's large line (G8); a part that is zero is left out. */
export function todaySentence(data: Progressi): string {
  return [
    data.oggi.dovute > 0 ? `${formatCount(data.oggi.dovute)} da ripassare` : null,
    data.oggi.nuove > 0 ? count(data.oggi.nuove, 'nuova', 'nuove') : null,
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * The subjects today's cards come from (G8, the line under the day block's sentence): those with cards due, the most
 * first, from the road's read by institute; then, when today still allows new cards, those that hold some. Null while
 * the road's read has not answered: the line waits for it rather than name a part. Never a guess at which new card
 * the server will pick: a subject with new cards is one they may come from.
 */
export function todaySubjects(materie: Progressi['materie'], stops: readonly TappaIstituto[] | null, newToday: number): Materia[] | null {
  if (stops === null) return null;
  const due = dueBySubject(stops);
  const byDue = [...due].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || MATERIA_LABEL[a[0]].localeCompare(MATERIA_LABEL[b[0]], 'it')).map(([materia]) => materia);
  const withNew = newToday > 0 ? orderStops(materie).filter((stop) => stop.nuove > 0 && !byDue.includes(stop.materia)).map((stop) => stop.materia) : [];
  return [...byDue, ...withNew];
}

/** «Diritto civile», «Diritto civile e Diritto penale», «Diritto civile, Diritto penale e altre 2»: two names at most. */
export function subjectsPhrase(subjects: readonly Materia[]): string | null {
  const names = subjects.map((materia) => MATERIA_LABEL[materia]);
  if (names.length === 0) return null;
  if (names.length <= 2) return names.join(' e ');
  const rest = names.length - 2;
  return `${names[0]}, ${names[1]} e ${rest === 1 ? 'un’altra' : `altre ${rest}`}`;
}

/**
 * What the day block says under «Hai finito per oggi.» (G8): «Domani: 9 da ripassare», the next day with cards by name
 * further on, «domani» with no count while new cards wait (`prossimi` counts only cards already studied), or none in
 * the fortnight. The server's days, formatted; never one computed here.
 */
export function nextDayLine(data: Progressi): string {
  const tomorrow = addDays(data.oggi.giorno, 1);
  const next = data.prossimi.find((day) => day.giorno > data.oggi.giorno && day.schede > 0);
  if (next && next.giorno === tomorrow) return `Domani: ${formatCount(next.schede)} da ripassare.`;
  if (data.stati.nuove > 0) return 'Domani: altre schede nuove da imparare.';
  if (next) return `Le prossime: ${formatDayLong(next.giorno)}, ${formatCount(next.schede)} da ripassare.`;
  return 'Nessuna scheda in programma nei prossimi 14 giorni.';
}
