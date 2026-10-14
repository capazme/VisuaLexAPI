import { daysBetween, romeDay } from './studyDay';

/**
 * When a card the user has reviewed counts as consolidated (Studia progress spec §4.2): its current
 * interval, the Rome days from the last review to the due day, is at least this long. The threshold Anki
 * calls «mature»; one constant, so the levels of a later round read the same split.
 */
export const CONSOLIDATED_DAYS = 21;

export type Maturity = 'apprendimento' | 'consolidate';

export function maturity(lastReviewAt: Date, dueAt: Date): Maturity {
  return daysBetween(romeDay(lastReviewAt), romeDay(dueAt)) >= CONSOLIDATED_DAYS ? 'consolidate' : 'apprendimento';
}
