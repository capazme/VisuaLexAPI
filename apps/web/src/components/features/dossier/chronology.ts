import type { DossierItem } from '../../../types';
import { notePlainText } from './noteMarkdown';

/**
 * «Cronologia» (LC137, P4): the facts of a dossier in date order, read from what it already holds. No date is stored
 * for a fact: a note gives its own by starting with it (day first, as Italian is written: 12/03/2025, 12.03.2025,
 * 12-03-2025, or ISO 2025-03-12), a decision by its date of filing (`data_deposito`) or, for the Union's courts, of
 * decision (`data_decisione`). An entry's `addedAt` is when it was filed in the dossier, never a fact's date.
 */

export type ChronologySource = 'nota' | 'sentenza';

export interface ChronologyEntry {
  /** The entry's own id. */
  id: string;
  /** ISO day, `yyyy-mm-dd`: kept as text, so no time zone moves it. */
  date: string;
  text: string;
  source: ChronologySource;
  /** The article a note is about, if any: where the note is read in «Fonti». */
  aboutItemId?: string | null;
}

export interface Chronology {
  /** By year, each year's entries in date order. */
  years: { year: string; entries: ChronologyEntry[] }[];
  /** Notes with no date at their start: they stay out. */
  undatedNotes: number;
}

// Markdown or list marks may come before the date (an application writes «**12/03/2025** — …»); `notePlainText`
// drops most, «•» is its list mark. Day first, one separator throughout, or ISO; never followed by another digit.
const LEADING_DATE = /^[\s•]*(?:(\d{1,2})([/.-])(\d{1,2})\2(\d{4})|(\d{4})-(\d{2})-(\d{2}))(?!\d)/;
/** What sits between the date and the words: a dash, a colon, a comma, spaces. */
const AFTER_DATE = /^[\s—–\-:,.]+/;

const pad = (n: number) => String(n).padStart(2, '0');

/** `yyyy-mm-dd` for a day that exists (no 31/02, no 29/02 out of a leap year), else null. */
export function isoDay(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (year < 1000 || d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The date a note starts with, and its words after it (the first line), or null. */
export function noteDate(text: string): { date: string; text: string } | null {
  const plain = notePlainText(text);
  const m = LEADING_DATE.exec(plain);
  if (!m) return null;
  const date = m[1] ? isoDay(+m[4], +m[3], +m[1]) : isoDay(+m[5], +m[6], +m[7]);
  if (!date) return null;
  const rest = plain.slice(m[0].length).replace(AFTER_DATE, '');
  return { date, text: rest.split('\n')[0].trim() };
}

/** The dossier's dated facts, oldest first (or newest first), grouped by year, and how many notes have no date. */
export function buildChronology(items: DossierItem[], newestFirst = false): Chronology {
  const entries: ChronologyEntry[] = [];
  let undatedNotes = 0;
  for (const item of items) {
    if (item.type === 'note') {
      const found = noteDate(item.data);
      if (found) entries.push({ id: item.id, date: found.date, text: found.text, source: 'nota', aboutItemId: item.aboutItemId });
      else undatedNotes++;
    } else if (item.type === 'sentenza') {
      const date = item.data.data_deposito ?? item.data.data_decisione;
      // Stored content is untrusted: only a plain ISO day sorts and groups right.
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) entries.push({ id: item.id, date, text: item.data.etichetta, source: 'sentenza' });
    }
  }
  // Stable: two facts of the same day keep the dossier's order.
  entries.sort((a, b) => (newestFirst ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)));
  const years: Chronology['years'] = [];
  for (const entry of entries) {
    const year = entry.date.slice(0, 4);
    if (years.at(-1)?.year !== year) years.push({ year, entries: [] });
    years.at(-1)!.entries.push(entry);
  }
  return { years, undatedNotes };
}
