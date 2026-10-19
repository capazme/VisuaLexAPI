import { describe, expect, it } from 'vitest';
import { addDaysToIsoDate, formatDateDashed, formatDateForCitation, todayInRome, withPreposition } from './dateUtils';

describe('formatDateDashed', () => {
  it('writes a day the way Normattiva does, padded', () => {
    expect(formatDateDashed('2007-12-29')).toBe('29-12-2007');
    expect(formatDateDashed('2003-02-01')).toBe('01-02-2003');
  });

  it('returns anything that is not an ISO day as it came', () => {
    expect(formatDateDashed('1990')).toBe('1990');
    expect(formatDateDashed('7 agosto 1990')).toBe('7 agosto 1990');
    expect(formatDateDashed('')).toBe('');
  });
});

describe('formatDateForCitation', () => {
  it('writes a day as a lawyer cites it', () => {
    expect(formatDateForCitation('2007-12-29')).toBe('29 dicembre 2007');
    expect(formatDateForCitation('2026-10-11')).toBe('11 ottobre 2026');
  });

  it('writes the first of the month with an ordinal', () => {
    expect(formatDateForCitation('2026-10-01')).toBe('1° ottobre 2026');
    expect(formatDateForCitation('2007-01-01')).toBe('1° gennaio 2007');
  });

  it('returns anything that is not an ISO day as it came', () => {
    expect(formatDateForCitation('2007')).toBe('2007');
    expect(formatDateForCitation('')).toBe('');
  });
});

describe('withPreposition', () => {
  const ELIDED = [
    ['il', "l'"],
    ['del', "dell'"],
    ['dal', "dall'"],
    ['al', "all'"],
    ['nel', "nell'"],
  ] as const;

  it.each(ELIDED)('elides "%s" before the 8th and the 11th, glued to the date', (preposition, elided) => {
    expect(withPreposition(preposition, '8 settembre 2014')).toBe(`${elided}8 settembre 2014`);
    expect(withPreposition(preposition, '11 giugno 1970')).toBe(`${elided}11 giugno 1970`);
  });

  it('writes the examples a lawyer expects', () => {
    expect(withPreposition('dal', '11 giugno 1970')).toBe("dall'11 giugno 1970");
    expect(withPreposition('al', '8 settembre 2014')).toBe("all'8 settembre 2014");
    expect(withPreposition('del', '11 settembre 2014')).toBe("dell'11 settembre 2014");
    expect(withPreposition('nel', '8 marzo 2010')).toBe("nell'8 marzo 2010");
    expect(withPreposition('il', '8 ottobre 2026')).toBe("l'8 ottobre 2026");
  });

  it.each(['1° gennaio 2010', '1 gennaio 2010', '18 aprile 2019', '28 dicembre 2000', '31 dicembre 2016', '80 maggio 2000', '111 maggio 2000'])(
    'keeps the plain preposition before "%s"', (date) => {
      expect(withPreposition('dal', date)).toBe(`dal ${date}`);
      expect(withPreposition('il', date)).toBe(`il ${date}`);
    },
  );

  it('keeps the plain preposition before a string that does not start with a day', () => {
    expect(withPreposition('al', '2014')).toBe('al 2014');
    expect(withPreposition('al', 'non leggibile')).toBe('al non leggibile');
    expect(withPreposition('al', '')).toBe('al ');
  });
});

describe('addDaysToIsoDate', () => {
  it('moves a day forward and back', () => {
    expect(addDaysToIsoDate('2014-09-12', 1)).toBe('2014-09-13');
    expect(addDaysToIsoDate('2007-12-30', -1)).toBe('2007-12-29');
  });

  it('crosses months, years and leap days', () => {
    expect(addDaysToIsoDate('2007-12-31', 1)).toBe('2008-01-01');
    expect(addDaysToIsoDate('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDaysToIsoDate('2023-02-28', 1)).toBe('2023-03-01');
  });

  it('returns what is not a real day unchanged', () => {
    expect(addDaysToIsoDate('2007-13-45', 1)).toBe('2007-13-45');
    expect(addDaysToIsoDate('2023-02-29', 1)).toBe('2023-02-29');
    expect(addDaysToIsoDate('ieri', 1)).toBe('ieri');
    expect(addDaysToIsoDate('', 1)).toBe('');
  });
});

describe('todayInRome', () => {
  it('is the day in Rome, which is ahead of UTC late in the evening', () => {
    expect(todayInRome(new Date('2026-10-01T10:00:00Z'))).toBe('2026-10-01');
    expect(todayInRome(new Date('2026-10-01T22:30:00Z'))).toBe('2026-10-02'); // CEST, UTC+2
    expect(todayInRome(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-16'); // CET, UTC+1
  });
});
