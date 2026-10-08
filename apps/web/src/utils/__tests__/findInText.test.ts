import { describe, it, expect } from 'vitest';
import {
  foldForSearch,
  findMatches,
  collectSearchableText,
  rangesForMatches,
} from '../findInText';

describe('foldForSearch', () => {
  it('keeps the length for every kind of input', () => {
    for (const s of ['Perché', 'PERCHÈ', 'ß', 'İstanbul', 'a😀b', 'a b', 'é', 'dell’articolo']) {
      expect(foldForSearch(s).length).toBe(s.length);
    }
  });

  it('ignores case and accents', () => {
    expect(foldForSearch('PERCHÉ')).toBe('perche');
    expect(foldForSearch('Perchè')).toBe('perche');
  });

  it('reads typographic apostrophes and Unicode spaces as ASCII', () => {
    expect(foldForSearch('dell’articolo')).toBe("dell'articolo");
    expect(foldForSearch('a b c')).toBe('a b c');
  });

  it('leaves ß and astral characters as they are; İ folds to one unit', () => {
    expect(foldForSearch('ß')).toBe('ß');
    expect(foldForSearch('İ')).toBe('i');
    expect(foldForSearch('😀')).toBe('😀');
  });
});

describe('findMatches', () => {
  it('finds accented forms with an unaccented query, at the original offsets', () => {
    const text = 'Perché no? PERCHÉ sì. Perchè.';
    const { matches, truncated } = findMatches(text, 'perche');
    expect(truncated).toBe(false);
    expect(matches.map(([s, e]) => text.slice(s, e))).toEqual(['Perché', 'PERCHÉ', 'Perchè']);
  });

  it('finds an apostrophe across typographies', () => {
    const text = 'dell’articolo';
    expect(findMatches(text, "dell'articolo").matches).toEqual([[0, text.length]]);
  });

  it('matches a whitespace run in the query against any run in the text', () => {
    const text = 'il danno    ingiusto';
    expect(findMatches(text, 'danno ingiusto').matches).toEqual([[3, text.length]]);
    expect(findMatches('danno ingiusto', 'danno    ingiusto').matches).toHaveLength(1);
  });

  it('trims the query and finds nothing under two characters', () => {
    expect(findMatches('a b a', 'a').matches).toEqual([]);
    expect(findMatches('a b a', '  a ').matches).toEqual([]);
    expect(findMatches('ab', ' ab ').matches).toEqual([[0, 2]]);
    expect(findMatches('ab', '').matches).toEqual([]);
  });

  it('treats regex characters as plain text', () => {
    expect(findMatches('a.b axb', 'a.b').matches).toEqual([[0, 3]]);
    expect(findMatches('(x)', '(x)').matches).toEqual([[0, 3]]);
  });

  it('caps at the limit and says so', () => {
    const text = 'ab '.repeat(1500);
    const r = findMatches(text, 'ab');
    expect(r.matches).toHaveLength(1000);
    expect(r.truncated).toBe(true);
    const exact = findMatches('ab '.repeat(3), 'ab', { limit: 3 });
    expect(exact.matches).toHaveLength(3);
    expect(exact.truncated).toBe(false);
  });
});

describe('DOM collection', () => {
  function root(html: string): HTMLElement {
    const el = document.createElement('div');
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
  }

  it('turns a match split by a mark and a sign into one range of the original words', () => {
    const el = root('<p>Il danno <mark>ingiusto</mark><span class="vlx-sign"></span> e grave</p>');
    const { nodes, text } = collectSearchableText(el);
    expect(text).toBe('Il danno ingiusto e grave');
    const { matches } = findMatches(text, 'danno INGIUSTO e');
    const ranges = rangesForMatches(nodes, matches);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].toString()).toBe('danno ingiusto e');
    el.remove();
  });

  it('skips text inside a display:none element, up to the root', () => {
    const el = root('<p>visibile</p><div style="display:none"><p>nascosto <b>qui</b></p></div>');
    const { text } = collectSearchableText(el);
    expect(text).toBe('visibile');
    el.remove();
  });

  it('does not change the root', () => {
    const el = root('<p>Il danno <mark>ingiusto</mark></p>');
    const before = el.innerHTML;
    const { nodes, text } = collectSearchableText(el);
    rangesForMatches(nodes, findMatches(text, 'danno').matches);
    expect(el.innerHTML).toBe(before);
    el.remove();
  });
});
