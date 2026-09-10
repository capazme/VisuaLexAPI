import { describe, it, expect } from 'vitest';
import { extractCitations, isSameCitationTarget, wrapCitationsInHtml } from './citationMatcher';

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

  it('gives every article of a list after an EU act to that act', () => {
    const ms = extractCitations('regolamento (UE) 2016/679, articoli 8 e 9', { tipo_atto: 'codice civile' });
    expect(ms.map(m => [m.parsed.article, m.parsed.act_type, m.parsed.act_number]))
      .toEqual([['8', 'Regolamento UE', '679'], ['9', 'Regolamento UE', '679']]);
  });

  it('reads "art. N del regolamento (UE) …" as an article of that act', () => {
    const [m, ...rest] = extractCitations("l'art. 5 del regolamento (UE) 2016/679 prevede", { tipo_atto: 'codice civile' });
    expect(rest).toHaveLength(0);
    expect(m.parsed).toMatchObject({ act_type: 'Regolamento UE', act_number: '679', date: '2016', article: '5' });
    expect(m.text).toBe('art. 5 del regolamento (UE) 2016/679');
  });

  it('tolerates the closing comma of a comma clause before "del"', () => {
    const [m] = extractCitations('vedi art. 5, comma 1, del regolamento (UE) 2016/679.', { tipo_atto: 'codice civile' });
    expect(m.parsed).toMatchObject({ act_type: 'Regolamento UE', act_number: '679', date: '2016', article: '5' });
  });

  it('gives every article of a list before an EU act to that act', () => {
    const ms = extractCitations('gli articoli 8 e 9 del regolamento (UE) 2016/679', { tipo_atto: 'codice civile' });
    expect(ms.map(m => [m.parsed.article, m.parsed.act_type])).toEqual([['8', 'Regolamento UE'], ['9', 'Regolamento UE']]);
  });

  it('expands a two-digit year on the same pivot as the backend', () => {
    const [m] = extractCitations('legge 89/35 art. 1');
    expect(m.parsed).toMatchObject({ act_type: 'legge', act_number: '89', date: '1935' });
  });
});

// The wrapper works on the article HTML, in which a citation may run across a
// tag: a link EUR-Lex left in the text, or the <mark> of a highlight. A span
// opened inside one element and closed outside it is not HTML.
describe('wrapCitationsInHtml', () => {
  it('wraps a plain citation in one span', () => {
    expect(wrapCitationsInHtml('vedi legge 241/1990 art. 3 e basta'))
      .toMatch(/^vedi <span class="citation-hover" data-citation="[^"]+" data-cache-key="[^"]+">legge 241\/1990 art\. 3<\/span> e basta$/);
  });

  it('keeps the markup balanced when a citation crosses a tag', () => {
    expect(wrapCitationsInHtml('<a href="/x">legge 241/1990</a>, art. 3 vale'))
      .toMatch(/^<a href="\/x"><span [^>]+>legge 241\/1990<\/span><\/a><span [^>]+>, art\. 3<\/span> vale$/);
  });

  it('keeps a highlighted citation hoverable on both sides of the mark', () => {
    expect(wrapCitationsInHtml('ai sensi del regolamento (UE) <mark>2016/679</mark>, art. 5, il'))
      .toMatch(/^ai sensi del <span [^>]+>regolamento \(UE\) <\/span><mark><span [^>]+>2016\/679<\/span><\/mark><span [^>]+>, art\. 5<\/span>, il$/);
  });
});

// Wrapping per segment yields several spans with the same cache key. The
// hover handler must not close the preview when the pointer merely crosses
// from one segment of a citation to the next.
describe('isSameCitationTarget', () => {
  it('is true when the pointer moves to another segment of the same citation', () => {
    document.body.innerHTML = wrapCitationsInHtml('<b>legge 241/1990</b>, art. 3');
    const [a, b] = Array.from(document.querySelectorAll('.citation-hover'));
    expect(b).toBeDefined();
    expect(isSameCitationTarget(a, b)).toBe(true);
  });

  it('is false when the pointer leaves to plain text or to another citation', () => {
    document.body.innerHTML = wrapCitationsInHtml('legge 241/1990 art. 3 e legge 241/1990 art. 4');
    const [a, b] = Array.from(document.querySelectorAll('.citation-hover'));
    expect(isSameCitationTarget(a, null)).toBe(false);
    expect(isSameCitationTarget(a, document.body)).toBe(false);
    expect(isSameCitationTarget(a, b)).toBe(false);
  });
});

// In prose the article usually comes first: "art. 7 del d.lgs. 196/2003".
// Left to the fallback pattern, that article was attributed to the act being
// read — a silent link to the wrong act.
describe('extractCitations — article before a numbered national act', () => {
  const inCodice = { tipo_atto: 'codice civile' };

  it('reads "art. 7 del d.lgs. 196/2003" as an article of that decree', () => {
    const [m, ...rest] = extractCitations("ai sensi dell'art. 7 del d.lgs. 196/2003", inCodice);
    expect(rest).toHaveLength(0);
    expect(m.parsed).toMatchObject({ act_type: 'decreto legislativo', act_number: '196', date: '2003', article: '7' });
  });

  it('reads the form without the preposition', () => {
    const [m] = extractCitations('vedi art. 7 d.lgs. 196/2003', inCodice);
    expect(m.parsed).toMatchObject({ act_type: 'decreto legislativo', act_number: '196', date: '2003', article: '7' });
  });

  it('gives every article of a list to the numbered act', () => {
    const ms = extractCitations('artt. 1, 2 e 3 del d.lgs. 196/2003', inCodice);
    expect(ms.map(m => [m.parsed.article, m.parsed.act_type, m.parsed.act_number]))
      .toEqual([['1', 'decreto legislativo', '196'], ['2', 'decreto legislativo', '196'], ['3', 'decreto legislativo', '196']]);
  });

  it('tolerates a comma clause before the act', () => {
    const [m] = extractCitations('art. 5, comma 1, della legge 241/1990', inCodice);
    expect(m.parsed).toMatchObject({ act_type: 'legge', act_number: '241', date: '1990', article: '5' });
  });

  it('reads an EU act after the article without a preposition', () => {
    const [m] = extractCitations('art. 5 direttiva (UE) 2016/680', inCodice);
    expect(m.parsed).toMatchObject({ act_type: 'Direttiva UE', act_number: '680', date: '2016', article: '5' });
  });
});

describe('extractCitations — clauses, ranges and unparsed acts', () => {
  const inCodice = { tipo_atto: 'codice civile' };

  it('skips a comma and letter clause before the act', () => {
    const [m] = extractCitations('art. 5, comma 1, lett. b), del d.lgs. 196/2003', inCodice);
    expect(m.parsed).toMatchObject({ act_type: 'decreto legislativo', act_number: '196', article: '5' });
  });

  it('skips a list of commi before the act', () => {
    const ms = extractCitations('artt. 5 e 6, commi 1 e 2, del d.lgs. 196/2003', inCodice);
    expect(ms.map(m => [m.parsed.article, m.parsed.act_type])).toEqual([['5', 'decreto legislativo'], ['6', 'decreto legislativo']]);
  });

  it('keeps a range on the numbered act', () => {
    const [m] = extractCitations('artt. 1-10 del d.lgs. 82/2005', inCodice);
    expect(m.parsed).toMatchObject({ act_type: 'decreto legislativo', act_number: '82', date: '2005', article: '1-10' });
  });

  it('does not attribute to the current norma an article the prose gives to another act', () => {
    // "legge 23 agosto 1988, n. 400" is a form no pattern reads yet: better no
    // link than a link to the codice civile.
    const ms = extractCitations('art. 17, comma 1, della legge 23 agosto 1988, n. 400', inCodice);
    expect(ms.filter(m => m.parsed.act_type === 'codice civile')).toHaveLength(0);
  });

  it('accepts the trailing marker of an old regulation', () => {
    const [m] = extractCitations('il regolamento 1049/2001/CE, art. 4, prevede', inCodice);
    expect(m.parsed).toMatchObject({ act_type: 'Regolamento UE', act_number: '1049', date: '2001', article: '4' });
  });
});

describe('extractCitations — an act written out in full is never the current norma', () => {
  const inCodice = { tipo_atto: 'codice civile' };

  it('sees past the parenthesis of "lett. b)"', () => {
    const ms = extractCitations('art. 5, lett. b), del d.lgs. 30 giugno 2003, n. 196', inCodice);
    expect(ms.filter(m => m.parsed.act_type === 'codice civile')).toHaveLength(0);
  });

  it('does not let the first article of a declined list fall back to the current norma', () => {
    const ms = extractCitations('articoli 8 e 9 del decreto legislativo 30 giugno 2003, n. 196', inCodice);
    expect(ms.filter(m => m.parsed.act_type === 'codice civile')).toHaveLength(0);
  });

  it('still links "del presente decreto" to the current norma', () => {
    const [m] = extractCitations('art. 5 del presente decreto', { tipo_atto: 'decreto legislativo', numero_atto: '196', data: '2003' });
    expect(m.parsed).toMatchObject({ act_type: 'decreto legislativo', article: '5' });
  });
});
