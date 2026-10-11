import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findCitationSpans, mergeMatches, readQueryCitation } from '../citationSearch';
import { findMatches } from '../findInText';

/**
 * The measured cases of spec §13.2 on two real decisions. Their texts carry personal data, so they
 * stay out of the repository: this suite reads them from a git-ignored folder and is skipped where
 * the folder is absent (as the API's `_local` freeze test is). Never copy their text into a test.
 */
const PRIVATE = join(__dirname, '..', '__fixtures__', 'private', 'decision-texts.json');
const present = existsSync(PRIVATE);
const texts: Record<string, string> = present ? JSON.parse(readFileSync(PRIVATE, 'utf8')) : {};
const CASS = 'd_cass5625.json';
const CORTE = 'd_cort242.json';

function spansFor(text: string, query: string): [number, number][] {
  const citation = readQueryCitation(query);
  expect(citation, query).not.toBeNull();
  return mergeMatches(findMatches(text, query).matches, findCitationSpans(text, citation!));
}

/** Every place `form` occurs in `text`, each of which a span must cover. */
function occurrences(text: string, form: RegExp): [number, number][] {
  return [...text.matchAll(new RegExp(form.source, 'giu'))].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
}

function uncovered(spans: [number, number][], places: [number, number][]): number {
  return places.filter(([s, e]) => !spans.some(([a, b]) => a <= s && e <= b)).length;
}

describe.skipIf(!present)('a citation in the query, on real decisions (local only)', () => {
  it('«art. 580 c.p.» finds the 4 «art. 580 del codice penale»', () => {
    const text = texts[CORTE];
    const places = occurrences(text, /art\.\s+580\s+del\s+codice\s+penale/);
    expect(places).toHaveLength(4);
    expect(uncovered(spansFor(text, 'art. 580 c.p.'), places)).toBe(0);
  });

  it('«l. 219/2017» and «legge 219/2017» find the 11 «legge n. 219 del 2017»', () => {
    const text = texts[CORTE];
    const places = occurrences(text, /legge\s+n\.\s+219\s+del\s+2017/);
    expect(places).toHaveLength(11);
    for (const q of ['l. 219/2017', 'legge 219/2017']) {
      const spans = spansFor(text, q);
      expect(uncovered(spans, places), q).toBe(0);
    }
  });

  it('«Cass. n. 219/2017» finds none of the 11 «legge n. 219 del 2017»: a law is not a decision', () => {
    const text = texts[CORTE];
    const places = occurrences(text, /legge\s+n\.\s+219\s+del\s+2017/);
    expect(places).toHaveLength(11);
    const citation = readQueryCitation('Cass. n. 219/2017');
    expect(citation).toEqual({ kind: 'decision', number: '219', year: '2017' });
    const spans = findCitationSpans(text, citation!);
    expect(places.filter(([s, e]) => spans.some(([a, b]) => a < e && s < b))).toHaveLength(0);
  });

  it('«art 110 cpa» finds «art. 110 c.p.a.»', () => {
    const text = texts[CASS];
    const places = occurrences(text, /art\.\s+110\s+c\.p\.a\./);
    expect(places.length).toBeGreaterThan(0);
    expect(uncovered(spansFor(text, 'art 110 cpa'), places)).toBe(0);
  });

  it('«Cass. n. 8980/2018» and «n. 8980/2018» find both «n 8980/2018» and «n. 8980/2018»', () => {
    const text = texts[CASS];
    const bare = occurrences(text, /(?<![a-z0-9])n\s+8980\/2018/);
    const dotted = occurrences(text, /(?<![a-z0-9])n\.\s*8980\/2018/);
    expect(bare.length).toBeGreaterThan(0);
    expect(dotted.length).toBeGreaterThan(0);
    for (const q of ['Cass. n. 8980/2018', 'n. 8980/2018']) {
      const spans = spansFor(text, q);
      expect(uncovered(spans, bare), q).toBe(0);
      expect(uncovered(spans, dotted), q).toBe(0);
    }
  });

  it('«Cass. n. 21748/2007» finds «n. 21748 del 2007»', () => {
    const text = texts[CORTE];
    const places = occurrences(text, /n\.\s+21748\s+del\s+2007/);
    expect(places.length).toBeGreaterThan(0);
    expect(uncovered(spansFor(text, 'Cass. n. 21748/2007'), places)).toBe(0);
  });

  it('«art. 13, comma 1-quater» finds both forms, with and without the comma', () => {
    const text = texts[CASS];
    expect(occurrences(text, /art\.\s+13,\s+comma\s+1-quater/)).toHaveLength(1);
    expect(occurrences(text, /art\.\s+13\s+comma\s+1-quater/)).toHaveLength(2);
    const places = occurrences(text, /art\.\s+13,?\s+comma\s+1-quater/);
    const { matches } = findMatches(text, 'art. 13, comma 1-quater');
    expect(matches).toHaveLength(3);
    expect(uncovered(matches, places)).toBe(0);
  });
});
