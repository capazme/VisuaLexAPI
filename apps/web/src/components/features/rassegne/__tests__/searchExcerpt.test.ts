import { describe, expect, it } from 'vitest';
import { anchorWord, excerptStart, findWords } from '../searchExcerpt';

const marked = (text: string, q: string) => findWords(text, q).map((s) => text.slice(s.start, s.end));

describe('findWords', () => {
  it('marks the whole word a searched start begins, case and accents folded', () => {
    expect(marked('La Responsabilità del vettore è contrattuale.', 'responsabilita')).toEqual(['Responsabilità']);
    expect(marked('Il danno ingiusto e i danni.', 'dann')).toEqual(['danno', 'danni']);
    expect(marked('PERDITA DI CHANCE', 'chance perdita')).toEqual(['PERDITA', 'CHANCE']);
  });

  it('only at the start of a word, a word being letters and digits', () => {
    expect(marked('Il condannato non è un danno.', 'dann')).toEqual(['danno']);
    expect(marked("dell'art. 2043, l'art2043", '2043')).toEqual(['2043']);
    expect(marked('sub_danno', 'danno')).toEqual(['danno']); // '_' separates, as in the index
  });

  it('merges words that overlap and keeps the text as it is', () => {
    const text = 'Quanto alla prescrizione e alla prescrittibilità.';
    expect(marked(text, 'prescri prescrizione')).toEqual(['prescrizione', 'prescrittibilità']);
    expect(findWords(text, '')).toEqual([]);
    expect(findWords('', 'danno')).toEqual([]);
  });

  it('maps a decomposed accent back to the text it marks', () => {
    const text = 'la libertà personale';
    expect(marked(text, 'liberta')).toEqual(['libertà']);
  });
});

describe('excerptStart', () => {
  it('starts at the beginning when the first word is near it, or none is found', () => {
    const text = 'Il danno ingiusto è risarcibile.';
    expect(excerptStart(text, findWords(text, 'ingiusto'))).toBe(0);
    expect(excerptStart(text, [])).toBe(0);
  });

  it('opens about a line before a word further in, at a word boundary', () => {
    const text = `${'parola '.repeat(60)}il danno da perdita di chance`;
    const spans = findWords(text, 'chance');
    const start = excerptStart(text, spans);
    expect(start).toBeGreaterThan(0);
    expect(spans[0].start - start).toBeGreaterThanOrEqual(70);
    expect(text[start - 1]).toBe(' ');
  });
});

describe('anchorWord', () => {
  it('is the longest word searched, the first on a tie', () => {
    expect(anchorWord('di chance perdita')).toBe('perdita');
    expect(anchorWord('di la')).toBe('di');
    expect(anchorWord('')).toBe('');
  });
});
