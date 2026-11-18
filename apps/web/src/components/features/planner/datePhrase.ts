import { addDaysToIsoDate } from '../../../utils/dateUtils';
import { addMonths, holidayName } from '../../../features/deadlines/computeDeadline';
import { RECURRENCE_RULES, type RecurrenceFrom, type RecurrenceRule } from '../../../types/tasks';

/**
 * Dates written in words, Italian and English («venerdì alle 10», «tra 2 settimane», «20/11», «every workday at 9»),
 * read into the planner's fields. Pure: `today` is the server's Rome day (`TaskViewAnswer.today`), never the
 * browser's. A repetition is read only into the five rules the server keeps (`RECURRENCE_RULES`); any other «ogni …»
 * is not a date at all, so it stays in the title whole. Shared by the quick add (LC78) and the CSV import (LC80).
 */

export interface DatePhrase {
  /** The planned day: the first one for a repetition. */
  date: string;
  /** 'HH:MM', or null. */
  time: string | null;
  recurrence: RecurrenceRule | null;
  recurrenceFrom: RecurrenceFrom;
}

/** A phrase found in a line: `start`/`end` are offsets in the line, `raw` the words as written. */
export interface FoundPhrase {
  start: number;
  end: number;
  raw: string;
  value: DatePhrase;
}

const fold = (word: string) => word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const WEEKDAYS: Record<string, number> = {
  domenica: 0, lunedi: 1, martedi: 2, mercoledi: 3, giovedi: 4, venerdi: 5, sabato: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

const MONTHS: Record<string, number> = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
  gen: 1, feb: 2, mar: 3, apr: 4, mag: 5, giu: 6, lug: 7, ago: 8, set: 9, ott: 10, nov: 11, dic: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, dec: 12,
};

const NUMBER_WORDS: Record<string, number> = {
  un: 1, uno: 1, una: 1, a: 1, an: 1, one: 1, due: 2, two: 2, tre: 3, three: 3, quattro: 4, four: 4, cinque: 5, five: 5,
  sei: 6, six: 6, sette: 7, seven: 7, otto: 8, eight: 8, nove: 9, nine: 9, dieci: 10, ten: 10,
};

const EVERY = new Set(['ogni', 'every', 'ogni!', 'every!']);
const AND = new Set(['e', 'and']);

const pad = (n: number) => String(n).padStart(2, '0');

function realDay(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

/** The next `weekday` after today (1 to 7 days on), or from today on when `fromToday`. */
function nextWeekday(today: string, weekday: number, fromToday: boolean): string {
  const ahead = (weekday - weekdayOf(today) + 7) % 7;
  return addDaysToIsoDate(today, ahead === 0 && !fromToday ? 7 : ahead);
}

/** Today, or the next day that is not a Saturday, a Sunday or a national holiday (the server's «working day»). */
function firstWorkingDay(today: string): string {
  let day = today;
  while (holidayName(day) || weekdayOf(day) === 6) day = addDaysToIsoDate(day, 1);
  return day;
}

/** A day and month with no year: this year's, or next year's when this year's is past. */
function comingDay(today: string, month: number, day: number): string | null {
  const year = Number(today.slice(0, 4));
  const thisYear = realDay(year, month, day);
  if (thisYear && thisYear >= today) return thisYear;
  // 29 February with no year: the next one that exists.
  for (let y = year + 1; y <= year + 4; y++) {
    const next = realDay(y, month, day);
    if (next) return next;
  }
  return null;
}

type Read<T> = { value: T; end: number } | null;

/** «alle 10», «alle ore 16:30», «ore 9», «at 4pm», or a bare «10:00». A bare number is not a time. */
function readTime(words: string[], i: number): Read<string> {
  let j = i;
  const lead = ['alle', 'ore', 'at'].includes(words[j]);
  if (lead) {
    j++;
    if (words[i] === 'alle' && words[j] === 'ore') j++;
  }
  const match = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/.exec(words[j] ?? '');
  if (!match) return null;
  let meridiem = match[3];
  let end = j + 1;
  if (!meridiem && (words[end] === 'am' || words[end] === 'pm')) meridiem = words[end++];
  if (!lead && !meridiem && !(match[2] && words[j].includes(':'))) return null;
  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem === 'pm' ? 12 : 0);
  } else if (hours > 23) return null;
  return { value: `${pad(hours)}:${pad(minutes)}`, end };
}

function readNumber(word: string | undefined): number | null {
  if (word === undefined) return null;
  if (/^\d{1,3}$/.test(word)) return Number(word);
  return NUMBER_WORDS[word] ?? null;
}

/** A day of the month: «20», «1°», «20th». */
function readDate(word: string | undefined): number | null {
  const match = /^(\d{1,2})(?:°|st|nd|rd|th)?$/.exec(word ?? '');
  return match ? Number(match[1]) : null;
}

function readYear(word: string | undefined): number | null {
  return /^\d{4}$/.test(word ?? '') ? Number(word) : null;
}

/** A day: oggi, domani, a weekday, «venerdì prossimo», «tra 3 giorni», «20 novembre», «20/11/2026». */
function readDay(words: string[], start: number, today: string): Read<string> {
  let i = start;
  const article = words[i] === 'il' || words[i] === 'on';
  if (article) i++;
  const w = words[i];
  const next = words[i + 1];

  if (!article) {
    if (w === 'oggi' || w === 'today') return { value: today, end: i + 1 };
    if (w === 'domani' || w === 'tomorrow') return { value: addDaysToIsoDate(today, 1), end: i + 1 };
    if (w === 'dopodomani') return { value: addDaysToIsoDate(today, 2), end: i + 1 };
    if (w === 'day' && next === 'after' && words[i + 2] === 'tomorrow') return { value: addDaysToIsoDate(today, 2), end: i + 3 };
    const nextWeek = (w === 'prossima' && next === 'settimana') || (w === 'settimana' && next === 'prossima') || (w === 'next' && next === 'week');
    if (nextWeek) return { value: nextWeekday(today, 1, false), end: i + 2 };
    if ((w === 'prossimo' || w === 'prossima' || w === 'next') && next !== undefined && next in WEEKDAYS) {
      return { value: nextWeekday(today, WEEKDAYS[next], false), end: i + 2 };
    }
    if (w === 'tra' || w === 'fra' || w === 'in') {
      const count = readNumber(next);
      const unit = words[i + 2];
      if (count === null || count < 1 || unit === undefined) return null;
      if (['giorno', 'giorni', 'day', 'days'].includes(unit)) return { value: addDaysToIsoDate(today, count), end: i + 3 };
      if (['settimana', 'settimane', 'week', 'weeks'].includes(unit)) return { value: addDaysToIsoDate(today, count * 7), end: i + 3 };
      if (['mese', 'mesi', 'month', 'months'].includes(unit)) return { value: addMonths(today, count), end: i + 3 };
      return null;
    }
  }
  if (w !== undefined && w in WEEKDAYS && (!article || words[start] === 'on')) {
    const after = next === 'prossimo' || next === 'prossima' ? 2 : 1;
    return { value: nextWeekday(today, WEEKDAYS[w], false), end: i + after };
  }

  // «20 novembre [2026]» and «november 20 [2026]».
  const dayFirst = readDate(w);
  const monthAfter = next !== undefined ? MONTHS[next] : undefined;
  const monthBefore = w !== undefined ? MONTHS[w] : undefined;
  const pair = dayFirst !== null && monthAfter !== undefined ? [dayFirst, monthAfter]
    : monthBefore !== undefined && readDate(next) !== null ? [readDate(next)!, monthBefore] : null;
  if (pair) {
    const [day, month] = pair;
    const year = readYear(words[i + 2]);
    const value = year !== null ? realDay(year, month, day) : comingDay(today, month, day);
    return value ? { value, end: i + (year !== null ? 3 : 2) } : null;
  }

  // «20/11», «20/11/26», «20/11/2026»: day first, as in Italy.
  const slash = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(w ?? '');
  if (slash) {
    const [day, month] = [Number(slash[1]), Number(slash[2])];
    const year = slash[3] === undefined ? null : slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3]);
    const value = year !== null ? realDay(year, month, day) : comingDay(today, month, day);
    return value ? { value, end: i + 1 } : null;
  }
  return null;
}

/** «dopo il completamento», «dal completamento», «after completion»: the repetition counts from the day it is done. */
function readCompletion(words: string[], i: number): number | null {
  const at = (...expected: string[]) => expected.every((word, k) => words[i + k] === word);
  if (at('dopo', 'il', 'completamento')) return i + 3;
  if (at('dal', 'completamento') || at('da', 'completamento') || at('after', 'completion') || at('from', 'completion')) return i + 2;
  return null;
}

/** One of the five rules, with its first day: «ogni venerdì», «ogni! giorno», «tutti i giorni lavorativi», «weekly». */
function readRule(words: string[], i: number, today: string): Read<{ rule: RecurrenceRule; date: string; fromCompletion: boolean }> {
  const w = words[i];
  const single: Record<string, RecurrenceRule> = {
    daily: RECURRENCE_RULES.daily, giornalmente: RECURRENCE_RULES.daily,
    weekly: RECURRENCE_RULES.weekly, settimanalmente: RECURRENCE_RULES.weekly,
    monthly: RECURRENCE_RULES.monthly, mensilmente: RECURRENCE_RULES.monthly,
    yearly: RECURRENCE_RULES.yearly, annually: RECURRENCE_RULES.yearly, annualmente: RECURRENCE_RULES.yearly,
  };
  const working = { rule: RECURRENCE_RULES.workingDays, date: firstWorkingDay(today) };
  if (w in single) return { value: { rule: single[w], date: today, fromCompletion: false }, end: i + 1 };
  if (w === 'tutti' && words[i + 1] === 'i' && words[i + 2] === 'giorni') {
    if (words[i + 3] === 'lavorativi' || words[i + 3] === 'feriali') return { value: { ...working, fromCompletion: false }, end: i + 4 };
    return { value: { rule: RECURRENCE_RULES.daily, date: today, fromCompletion: false }, end: i + 3 };
  }
  if (!EVERY.has(w)) return null;
  const fromCompletion = w.endsWith('!');
  const unit = words[i + 1];
  const after = words[i + 2];
  const plain = (rule: RecurrenceRule, end: number, date = today) => ({ value: { rule, date, fromCompletion }, end });
  if (unit === 'giorno' && (after === 'lavorativo' || after === 'feriale')) return { value: { ...working, fromCompletion }, end: i + 3 };
  if ((unit === 'working' || unit === 'business') && after === 'day') return { value: { ...working, fromCompletion }, end: i + 3 };
  if (unit === 'workday' || unit === 'weekday') return { value: { ...working, fromCompletion }, end: i + 2 };
  if (unit === 'giorno' || unit === 'day') return plain(RECURRENCE_RULES.daily, i + 2);
  if (unit === 'settimana' || unit === 'week') return plain(RECURRENCE_RULES.weekly, i + 2);
  if (unit === 'mese' || unit === 'month') return plain(RECURRENCE_RULES.monthly, i + 2);
  if (unit === 'anno' || unit === 'year') return plain(RECURRENCE_RULES.yearly, i + 2);
  if (unit !== undefined && unit in WEEKDAYS) return plain(RECURRENCE_RULES.weekly, i + 2, nextWeekday(today, WEEKDAYS[unit], true));
  return null;
}

/** The phrase's words, folded (lower case, no accents), the whole of them or nothing. */
function readWords(words: string[], today: string): DatePhrase | null {
  if (words.length === 0) return null;
  const rule = readRule(words, 0, today);
  if (rule) {
    let i = rule.end;
    let time: string | null = null;
    let fromCompletion = rule.value.fromCompletion;
    // A time and «dopo il completamento», in either order, once each.
    for (let k = 0; k < 2 && i < words.length; k++) {
      const t: Read<string> = time === null ? readTime(words, i) : null;
      if (t) {
        time = t.value;
        i = t.end;
        continue;
      }
      const c = readCompletion(words, i);
      if (c === null) break;
      fromCompletion = true;
      i = c;
    }
    if (i !== words.length) return null;
    return { date: rule.value.date, time, recurrence: rule.value.rule, recurrenceFrom: fromCompletion ? 'completamento' : 'pianificata' };
  }
  let i = 0;
  let time: string | null = null;
  let date: string | null = null;
  const before = readTime(words, i);
  if (before) [time, i] = [before.value, before.end];
  const day = readDay(words, i, today);
  if (day) [date, i] = [day.value, day.end];
  if (time === null) {
    const after = readTime(words, i);
    if (after) [time, i] = [after.value, after.end];
  }
  if (i !== words.length || (date === null && time === null)) return null;
  // A time alone is today's.
  return { date: date ?? today, time, recurrence: null, recurrenceFrom: 'pianificata' };
}

interface Token {
  word: string;
  start: number;
  end: number;
}

/** Words with their offsets; a trailing comma, full stop or semicolon is not part of the word. */
function tokens(text: string): Token[] {
  const found: Token[] = [];
  for (const match of text.matchAll(/\S+/g)) {
    const raw = match[0].replace(/[,;.?)]+$/, '');
    if (!raw) continue;
    found.push({ word: fold(raw), start: match.index, end: match.index + raw.length });
  }
  return found;
}

/** A whole phrase as a date, or null: «domani alle 10», «every friday», a CSV's `DATE` column. */
export function parseDatePhrase(phrase: string, today: string): DatePhrase | null {
  return readWords(tokens(phrase).map((t) => t.word), today);
}

/** Whether a phrase is a repetition by its first word («ogni …», «every …», «tutti i …»), read or not: the CSV import
 *  tells a repetition outside the five rules from a date it did not understand. */
export function isRepetitionPhrase(phrase: string): boolean {
  const first = tokens(phrase)[0]?.word;
  return first !== undefined && (EVERY.has(first) || first === 'tutti' || first === 'tutte');
}

const LONGEST = 8;

/**
 * The longest date phrase in a line (the first of equal ones), or null. Nothing is read inside or across the
 * phrases in `blocked`, the ones the user turned back into text (so «domani» is not read again out of «domani alle 10»). Not read: words right after an «ogni»/«every» that is not one of the five
 * rules («ogni primo lunedì del mese», «ogni 2 settimane alle 10»), and a rule followed by another weekday («ogni
 * lunedì e giovedì»), which the five rules cannot hold.
 */
export function findDatePhrase(text: string, today: string, blocked: readonly string[] = []): FoundPhrase | null {
  const list = tokens(text);
  const ranges = blocked.flatMap((raw) => {
    const found: [number, number][] = [];
    for (let at = raw ? text.indexOf(raw) : -1; at >= 0; at = text.indexOf(raw, at + 1)) found.push([at, at + raw.length]);
    return found;
  });
  const words = list.map((t) => t.word);
  for (let length = Math.min(LONGEST, list.length); length >= 1; length--) {
    for (let i = 0; i + length <= list.length; i++) {
      const value = readWords(words.slice(i, i + length), today);
      if (!value) continue;
      if (value.recurrence === null && words.slice(Math.max(0, i - 3), i).some((w) => EVERY.has(w))) continue;
      if (value.recurrence !== null) {
        const [next, then] = [words[i + length], words[i + length + 1]];
        if ((next !== undefined && next in WEEKDAYS) || (next !== undefined && AND.has(next) && then !== undefined && then in WEEKDAYS)) continue;
      }
      const start = list[i].start;
      const end = list[i + length - 1].end;
      if (ranges.some(([from, to]) => start < to && end > from)) continue;
      return { start, end, raw: text.slice(start, end), value };
    }
  }
  return null;
}
