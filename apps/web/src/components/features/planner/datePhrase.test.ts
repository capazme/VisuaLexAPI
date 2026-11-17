import { describe, expect, it } from 'vitest';
import { RECURRENCE_RULES } from '../../../types/tasks';
import { findDatePhrase, parseDatePhrase, type DatePhrase } from './datePhrase';

// Tuesday 17 November 2026, the server's Rome day.
const TODAY = '2026-11-17';
const { daily, workingDays, weekly, monthly, yearly } = RECURRENCE_RULES;

const day = (date: string, time: string | null = null): DatePhrase => ({ date, time, recurrence: null, recurrenceFrom: 'pianificata' });
const every = (recurrence: DatePhrase['recurrence'], date: string, time: string | null = null, fromCompletion = false): DatePhrase =>
  ({ date, time, recurrence, recurrenceFrom: fromCompletion ? 'completamento' : 'pianificata' });

const CASES: [string, DatePhrase, string?][] = [
  // Italian days
  ['oggi', day('2026-11-17')],
  ['domani', day('2026-11-18')],
  ['Dopodomani', day('2026-11-19')],
  ['lunedì', day('2026-11-23')],
  ['venerdi', day('2026-11-20')],
  // Today's weekday is next week's.
  ['martedì', day('2026-11-24')],
  ['venerdì prossimo', day('2026-11-20')],
  ['prossimo lunedì', day('2026-11-23')],
  ['prossima settimana', day('2026-11-23')],
  ['tra 3 giorni', day('2026-11-20')],
  ['fra 2 settimane', day('2026-12-01')],
  ['tra un mese', day('2026-12-17')],
  ['20 novembre', day('2026-11-20')],
  ['il 20 novembre 2027', day('2027-11-20')],
  // A day already past this year is next year's.
  ['10 novembre', day('2027-11-10')],
  ['1° dic', day('2026-12-01')],
  ['20/11', day('2026-11-20')],
  ['20/11/2026', day('2026-11-20')],
  ['20/11/27', day('2027-11-20')],
  ['3/1', day('2027-01-03')],
  // Times
  ['alle 10', day(TODAY, '10:00')],
  ['alle 16:30', day(TODAY, '16:30')],
  ['10:00', day(TODAY, '10:00')],
  ['domani alle 9', day('2026-11-18', '09:00')],
  ['venerdì alle ore 10', day('2026-11-20', '10:00')],
  ['alle 10 domani', day('2026-11-18', '10:00')],
  ['20/11 alle 12.15', day('2026-11-20', '12:15')],
  // Italian repetitions
  ['ogni giorno', every(daily, TODAY)],
  ['tutti i giorni', every(daily, TODAY)],
  ['ogni giorno lavorativo alle 9', every(workingDays, TODAY, '09:00')],
  ['tutti i giorni feriali', every(workingDays, TODAY)],
  // A Saturday starts on Monday; 8 December, a holiday, on the 9th.
  ['ogni giorno lavorativo', every(workingDays, '2026-11-23'), '2026-11-21'],
  ['ogni giorno lavorativo', every(workingDays, '2026-12-09'), '2026-12-08'],
  ['ogni settimana', every(weekly, TODAY)],
  ['ogni venerdì alle 10', every(weekly, '2026-11-20', '10:00')],
  // A repetition on today's weekday starts today.
  ['ogni martedì', every(weekly, TODAY)],
  ['ogni mese', every(monthly, TODAY)],
  ['ogni anno', every(yearly, TODAY)],
  ['ogni! giorno', every(daily, TODAY, null, true)],
  ['ogni settimana dopo il completamento', every(weekly, TODAY, null, true)],
  ['ogni mese dal completamento alle 8', every(monthly, TODAY, '08:00', true)],
  // English
  ['today', day(TODAY)],
  ['Tomorrow', day('2026-11-18')],
  ['day after tomorrow', day('2026-11-19')],
  ['friday', day('2026-11-20')],
  ['next monday', day('2026-11-23')],
  ['in 3 days', day('2026-11-20')],
  ['in two weeks', day('2026-12-01')],
  ['november 20', day('2026-11-20')],
  ['20 november 2026', day('2026-11-20')],
  ['at 4pm', day(TODAY, '16:00')],
  ['tomorrow at 10:30', day('2026-11-18', '10:30')],
  ['at 12 am', day(TODAY, '00:00')],
  ['every day', every(daily, TODAY)],
  ['daily', every(daily, TODAY)],
  ['every workday', every(workingDays, TODAY)],
  ['every weekday at 9', every(workingDays, TODAY, '09:00')],
  ['every friday at 10', every(weekly, '2026-11-20', '10:00')],
  ['every! week', every(weekly, TODAY, null, true)],
  ['every month after completion', every(monthly, TODAY, null, true)],
  ['every year', every(yearly, TODAY)],
];

const NOT_DATES = [
  'ogni tanto',
  'il 31 febbraio',
  '31/02',
  '29/02/2027',
  '10',
  '2026',
  'alle 25',
  'alle 10:75',
  'at 13pm',
  'ogni 2 settimane',
  'ogni lunedì e giovedì',
  'ogni primo lunedì del mese',
  'every other day',
  'every 3 days',
  'tra giorni',
  'tra 0 giorni',
  'il venerdì',
  '231/2001',
  '3/2024',
  '20/13',
  'domani domani',
  'udienza',
  '',
];

describe('parseDatePhrase', () => {
  it.each(CASES)('reads «%s»', (phrase, expected, today = TODAY) => {
    expect(parseDatePhrase(phrase, today)).toEqual(expected);
  });

  it.each(NOT_DATES)('does not read «%s»', (phrase) => {
    expect(parseDatePhrase(phrase, TODAY)).toBeNull();
  });

  it('has at least 40 cases, Italian and English', () => {
    expect(CASES.length + NOT_DATES.length).toBeGreaterThanOrEqual(40);
  });
});

describe('findDatePhrase', () => {
  it.each([
    ['Deposito memoria venerdì alle 10', 'venerdì alle 10'],
    ['Controllo PEC ogni giorno lavorativo alle 9', 'ogni giorno lavorativo alle 9'],
    ['Call cliente domani', 'domani'],
    ['Udienza il 20 novembre, portare fascicolo', 'il 20 novembre'],
    ['Every friday at 10 weekly review', 'Every friday at 10'],
  ])('finds the phrase in «%s»', (line, raw) => {
    const found = findDatePhrase(line, TODAY);
    expect(found?.raw).toBe(raw);
    expect(line.slice(found!.start, found!.end)).toBe(raw);
  });

  it.each([
    'Leggere d.lgs. 231/2001, art. 10',
    'RG 1234/2026 sentenza n. 3/2024',
    'Scrivere a mario@studio.it',
    'Riunione ogni primo lunedì del mese',
    'Rinnovo ogni 2 settimane alle 10',
    'Lezione ogni lunedì e giovedì',
    'Corso ogni lunedì, giovedì',
    'Telefonare ogni tanto',
  ])('reads nothing in «%s»', (line) => {
    expect(findDatePhrase(line, TODAY)).toBeNull();
  });

  it('reads nothing inside a phrase turned back into text', () => {
    expect(findDatePhrase('Riunione domani alle 10', TODAY, ['domani alle 10'])).toBeNull();
    expect(findDatePhrase('Riunione domani alle 10, poi venerdì', TODAY, ['domani alle 10'])?.raw).toBe('venerdì');
  });
});
