import { describe, it, expect } from 'vitest';
import { extractCitations } from './citationMatcher';

// The in-text matcher feeds the citation preview popup. Article texts cite EU
// acts in their official spelling — "regolamento (UE) 2016/679" — so the
// marker in parentheses and the year-first pair must both be understood, or
// the popup asks EUR-Lex for a regulation that does not exist.
describe('extractCitations — EU acts', () => {
  it('reads "regolamento (UE) 2016/679, art. 5" as number 679 of 2016', () => {
    const [m, ...rest] = extractCitations('ai sensi del regolamento (UE) 2016/679, art. 5, il titolare');
    expect(rest).toHaveLength(0);
    expect(m.parsed).toMatchObject({ act_type: 'Regolamento UE', act_number: '679', date: '2016', article: '5' });
  });

  it('reads "Regolamento (UE) 2024/2847 art. 13" as number 2847 of 2024', () => {
    const [m] = extractCitations('secondo il Regolamento (UE) 2024/2847 art. 13');
    expect(m.parsed).toMatchObject({ act_type: 'Regolamento UE', act_number: '2847', date: '2024', article: '13' });
  });

  it('reads an old directive with the trailing "/CE" marker', () => {
    const [m] = extractCitations('la direttiva 2002/58/CE, art. 5, prevede');
    expect(m.parsed).toMatchObject({ act_type: 'Direttiva UE', act_number: '58', date: '2002', article: '5' });
  });

  it('still reads the Italian order number/year', () => {
    const [m] = extractCitations('vedi reg. ue 679/2016 art. 5');
    expect(m.parsed).toMatchObject({ act_type: 'Regolamento UE', act_number: '679', date: '2016', article: '5' });
  });

  it('leaves Italian acts on the number/year reading', () => {
    const [m] = extractCitations('come da legge 241/1990 art. 3');
    expect(m.parsed).toMatchObject({ act_type: 'legge', act_number: '241', date: '1990', article: '3' });
  });
});

describe('extractCitations — EU acts, hardening', () => {
  it('leaves a national regolamento without the EU marker alone', () => {
    expect(extractCitations('il regolamento n. 5/2020 art. 3 del consiglio comunale')).toEqual([]);
  });

  it('reads a three-letter trailing marker', () => {
    const [m] = extractCitations('la direttiva 93/13/CEE, art. 3, sulle clausole abusive');
    expect(m.parsed).toMatchObject({ act_type: 'Direttiva UE', act_number: '13', date: '1993', article: '3' });
  });

  it('reads an implementing regulation', () => {
    const [m] = extractCitations('regolamento di esecuzione (UE) 2015/2447, art. 3');
    expect(m.parsed).toMatchObject({ act_type: 'Regolamento UE', act_number: '2447', date: '2015', article: '3' });
  });

  it('yields nothing for an EU act cited without an article', () => {
    expect(extractCitations('ai sensi del regolamento (UE) 2016/679 il titolare')).toEqual([]);
  });

  it('does not truncate a list of articles that follows an EU act', () => {
    // The list still belongs to the current norma, as it did before the EU
    // pattern existed: what must not happen is art. 9 disappearing.
    const articles = extractCitations('regolamento (UE) 2016/679, articoli 8 e 9', { tipo_atto: 'codice civile' })
      .map(m => m.parsed.article);
    expect(articles).toEqual(['8', '9']);
  });

  it('expands a two-digit year on the same pivot as the backend', () => {
    const [m] = extractCitations('legge 89/35 art. 1');
    expect(m.parsed).toMatchObject({ act_type: 'legge', act_number: '89', date: '1935' });
  });
});
