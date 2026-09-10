import { describe, it, expect } from 'vitest';
import { FULL_ACT_NAMES, formatParsedCitation, isSearchReady, parseLegalCitation } from './citationParser';
import type { CustomAlias } from '../types';

describe('formatParsedCitation — date shown in a citation', () => {
  it('shows the year when the resolver answered with a full ISO date', () => {
    // The server resolver returns "2012-06-28" for acts it knows by name; a
    // citation names the year. The full date stays in the search params.
    expect(formatParsedCitation({ article: '18', act_type: 'legge', act_number: '92', date: '2012-06-28', confidence: 1 }))
      .toBe('Art. 18 L. 92/2012');
  });

  it('leaves a year-only date alone', () => {
    expect(formatParsedCitation({ article: '5', act_type: 'regolamento ue', act_number: '679', date: '2016', confidence: 1 }))
      .toBe('Art. 5 Reg. UE 679/2016');
  });

  it('keeps a codice without number or date unchanged', () => {
    expect(formatParsedCitation({ article: '2043', act_type: 'codice civile', confidence: 1 }))
      .toBe('Art. 2043 C.C.');
  });
});

// EU acts are cited "year/number" since 2015 ("Regolamento (UE) 2016/679",
// "Regolamento (UE) 2024/2847"), and Italian practice also writes the pair
// the other way round ("reg. ue 679/2016"). The parser must accept both, and
// the "(UE)" marker in parentheses is the official spelling, not noise.
describe('parseLegalCitation — EU acts', () => {
  const parse = (input: string) => parseLegalCitation(input);

  it('reads "Regolamento (UE) 2024/2847 art. 1" as number 2847 of 2024', () => {
    const r = parse('Regolamento (UE) 2024/2847 art. 1');
    expect(r).toMatchObject({ act_type: 'Regolamento UE', act_number: '2847', date: '2024', article: '1' });
    expect(isSearchReady(r)).toBe(true);
  });

  it('recognises the act even without an article', () => {
    const r = parse('Regolamento (UE) 2024/2847');
    expect(r).toMatchObject({ act_type: 'Regolamento UE', act_number: '2847', date: '2024' });
    expect(r?.article).toBeUndefined();
  });

  it('accepts the "Reg. UE" abbreviation without parentheses', () => {
    expect(parse('Reg. UE 2024/2847 art. 1'))
      .toMatchObject({ act_type: 'Regolamento UE', act_number: '2847', date: '2024', article: '1' });
  });

  it('still accepts the Italian order number/year', () => {
    expect(parse('reg. ue 2847/2024 art. 1'))
      .toMatchObject({ act_type: 'Regolamento UE', act_number: '2847', date: '2024', article: '1' });
  });

  it('tolerates "n." before the pair', () => {
    expect(parse('Regolamento (UE) n. 2016/679 art. 5'))
      .toMatchObject({ act_type: 'Regolamento UE', act_number: '679', date: '2016', article: '5' });
  });

  it('places the article before the act', () => {
    expect(parse('art. 5 regolamento (ue) 2016/679'))
      .toMatchObject({ act_type: 'Regolamento UE', act_number: '679', date: '2016', article: '5' });
  });

  it('maps a pre-Lisbon "(CE)" regulation to the same EU type', () => {
    expect(parse('Regolamento (CE) n. 1/2003 art. 3'))
      .toMatchObject({ act_type: 'Regolamento UE', act_number: '1', date: '2003', article: '3' });
  });

  it('expands a two-digit year in the old "(CEE)" numbering', () => {
    expect(parse('Regolamento (CEE) n. 2913/92 art. 4'))
      .toMatchObject({ act_type: 'Regolamento UE', act_number: '2913', date: '1992', article: '4' });
  });

  it('keeps number-first when both halves look like years before 2015', () => {
    // Regulation (EC) No 2006/2004: number 2006, year 2004.
    expect(parse('Regolamento (CE) n. 2006/2004 art. 3'))
      .toMatchObject({ act_type: 'Regolamento UE', act_number: '2006', date: '2004', article: '3' });
  });

  it('reads a directive in the new numbering', () => {
    expect(parse('Direttiva (UE) 2016/680 art. 3'))
      .toMatchObject({ act_type: 'Direttiva UE', act_number: '680', date: '2016', article: '3' });
  });

  it('reads an old directive with the trailing "/CE" marker', () => {
    expect(parse('Direttiva 2002/58/CE art. 5'))
      .toMatchObject({ act_type: 'Direttiva UE', act_number: '58', date: '2002', article: '5' });
  });

  it('expands a two-digit year in an old directive', () => {
    expect(parse('Direttiva 95/46/CE art. 6'))
      .toMatchObject({ act_type: 'Direttiva UE', act_number: '46', date: '1995', article: '6' });
  });

  it('accepts the Italian order for a directive abbreviation', () => {
    expect(parse('dir. ue 2555/2022 art. 21'))
      .toMatchObject({ act_type: 'Direttiva UE', act_number: '2555', date: '2022', article: '21' });
  });

  it('leaves Italian acts on the number/year reading', () => {
    expect(parse('l. 241/1990 art. 1'))
      .toMatchObject({ act_type: 'legge', act_number: '241', date: '1990', article: '1' });
  });
});

describe('parseLegalCitation — EU acts, hardening', () => {
  const parse = (input: string) => parseLegalCitation(input);

  it('does not read a day/month/year date as an EU pair', () => {
    const r = parse('direttiva 1/2/2016 art. 1');
    expect(r?.act_type).toBeUndefined();
    expect(isSearchReady(r)).toBe(false);
  });

  it('refuses a pair in which no half can be the year', () => {
    const r = parse('reg. ue 123/456 art. 1');
    expect(r?.date).toBeUndefined();
    expect(isSearchReady(r)).toBe(false);
  });

  it('keeps a (CE) act on the old numbering even when the first half reads as a recent year', () => {
    expect(parse('Regolamento (CE) n. 2015/2006 art. 1'))
      .toMatchObject({ act_type: 'Regolamento UE', act_number: '2015', date: '2006', article: '1' });
  });

  it('reads an implementing regulation', () => {
    expect(parse('regolamento di esecuzione (UE) 2015/2447 art. 3'))
      .toMatchObject({ act_type: 'Regolamento UE', act_number: '2447', date: '2015', article: '3' });
  });

  it('reads a delegated regulation', () => {
    expect(parse('Regolamento delegato (UE) 2015/2446 art. 1'))
      .toMatchObject({ act_type: 'Regolamento UE', act_number: '2446', date: '2015', article: '1' });
  });

  it('reads a three-letter trailing marker', () => {
    expect(parse('Direttiva 93/13/CEE art. 3'))
      .toMatchObject({ act_type: 'Direttiva UE', act_number: '13', date: '1993', article: '3' });
  });

  it('strips parentheses for every act, not only EU ones', () => {
    expect(parse('art. 2043 (codice civile)')).toMatchObject({ act_type: 'codice civile', article: '2043' });
  });

  it('expands a two-digit year on the same pivot as the backend', () => {
    expect(parse('l. 89/35 art. 1')).toMatchObject({ act_type: 'legge', act_number: '89', date: '1935' });
    expect(parse('d.lgs. 36/23 art. 1')).toMatchObject({ act_type: 'decreto legislativo', act_number: '36', date: '2023' });
  });

  it('does not take a three-digit second half for a year', () => {
    const r = parse('legge 241/456 art. 1');
    expect(r?.act_type).toBe('legge');
    expect(r?.date).toBeUndefined();
  });

  it('does not throw on a custom alias trigger that carries regex characters', () => {
    const alias = (trigger: string): CustomAlias => ({
      id: 'a1', trigger, type: 'reference', expandTo: 'GDPR', createdAt: '', usageCount: 0,
      searchParams: { act_type: 'Regolamento UE', act_number: '679', date: '2016' },
    });
    // "c++" once built the regex /\bc++\b/, which throws on construction.
    expect(() => parseLegalCitation('art. 5 gdpr', [alias('c++')])).not.toThrow();
    expect(parseLegalCitation('art. 5 reg+ue', [alias('reg+ue')]))
      .toMatchObject({ act_type: 'Regolamento UE', act_number: '679', date: '2016', article: '5', fromAlias: true });
  });

  it('matches a custom alias trigger written with parentheses', () => {
    const alias: CustomAlias = {
      id: 'a2', trigger: 'reg (ue)', type: 'reference', expandTo: 'GDPR', createdAt: '', usageCount: 0,
      searchParams: { act_type: 'Regolamento UE', act_number: '679', date: '2016' },
    };
    expect(parseLegalCitation('art. 5 reg (ue)', [alias]))
      .toMatchObject({ act_type: 'Regolamento UE', act_number: '679', date: '2016', article: '5', fromAlias: true });
  });
});

describe('parseLegalCitation — full dates and article lists', () => {
  const parse = (input: string) => parseLegalCitation(input);

  it('reads a day/month/year date before the act number', () => {
    expect(parse('art. 1 legge 7/8/1990 n. 241'))
      .toMatchObject({ act_type: 'legge', act_number: '241', date: '1990-08-07', article: '1' });
  });

  it('reads an Italian long date', () => {
    expect(parse('legge 7 agosto 1990 n. 241 art. 1'))
      .toMatchObject({ act_type: 'legge', act_number: '241', date: '1990-08-07', article: '1' });
  });

  it('reads an ISO date', () => {
    expect(parse('art. 1 legge 1990-08-07 n. 241'))
      .toMatchObject({ act_type: 'legge', act_number: '241', date: '1990-08-07', article: '1' });
  });

  it('shows only the year of a full date in the preview', () => {
    expect(formatParsedCitation(parse('art. 1 legge 7/8/1990 n. 241')!)).toBe('Art. 1 L. 241/1990');
  });

  it('collects an "e"-separated list of articles', () => {
    expect(parse('artt. 5 e 6 cc')).toMatchObject({ act_type: 'codice civile', article: '5,6' });
  });

  it('collects a comma-and-e list without reading a member as the act number', () => {
    const r = parse('artt. 1, 2 e 3 cc');
    expect(r).toMatchObject({ act_type: 'codice civile', article: '1,2,3' });
    expect(r?.act_number).toBeUndefined();
  });

  it('keeps a range', () => {
    expect(parse('artt. 1-10 cc')).toMatchObject({ act_type: 'codice civile', article: '1-10' });
  });

  it('collects a list on an EU act', () => {
    expect(parse('reg. ue 2016/679 artt. 5 e 6'))
      .toMatchObject({ act_type: 'Regolamento UE', act_number: '679', date: '2016', article: '5,6' });
  });

  it('still separates the act from the article on a comma', () => {
    expect(parse('d.lgs. 196/2003, art. 7'))
      .toMatchObject({ act_type: 'decreto legislativo', act_number: '196', date: '2003', article: '7' });
  });
});

describe('parseLegalCitation — comma clauses', () => {
  const parse = (input: string) => parseLegalCitation(input);

  it('does not read "comma 1" as the act number', () => {
    const r = parse('art. 5, comma 1, cc');
    expect(r).toMatchObject({ act_type: 'codice civile', article: '5' });
    expect(r?.act_number).toBeUndefined();
  });

  it('skips a comma and letter clause before a numbered act', () => {
    expect(parse('art. 2, co. 3, lett. b) d.lgs. 196/2003'))
      .toMatchObject({ act_type: 'decreto legislativo', act_number: '196', date: '2003', article: '2' });
  });
});

describe('parseLegalCitation — date sanity', () => {
  const parse = (input: string) => parseLegalCitation(input);

  it('rejects an impossible month and does not feed it to the number/year pair', () => {
    expect(parse('art. 1 legge 31/13/1990 n. 400'))
      .toMatchObject({ act_type: 'legge', act_number: '400', date: '1990' });
  });

  it('keeps searching after an impossible date', () => {
    expect(parse('art. 1 legge 31/13/1990 del 12 agosto 1991 n. 400')?.date).toBe('1991-08-12');
  });
});

describe('FULL_ACT_NAMES', () => {
  it('lists the acts a text can name in full, without the numbered ones or the abbreviations', () => {
    const names = FULL_ACT_NAMES.map(([name]) => name);
    expect(names).toEqual(expect.arrayContaining(['codice civile', 'codice penale', 'costituzione', 'codice del consumo']));
    for (const excluded of ['legge', 'decreto legislativo', 'cc', 'cost', 'c.c.', 'tue']) {
      expect(names).not.toContain(excluded);
    }
  });

  it('maps every name to the act type the palette resolves it to', () => {
    expect(Object.fromEntries(FULL_ACT_NAMES)).toMatchObject({ 'codice civile': 'codice civile', 'costituzione': 'costituzione' });
  });
});
