import { describe, expect, it } from 'vitest';
import { MAX_QUERY_CHARS, searchWords } from '../rassegnaFilters';

describe('searchWords: the words the store searches for, read as the API reads them', () => {
  it('keeps letters and digits, drops one-character words, each once', () => {
    expect(searchWords('Danno, ingiusto: art. 2043 a')).toEqual({ kind: 'words', q: 'Danno ingiusto art 2043' });
    expect(searchWords('danno danno_x')).toEqual({ kind: 'words', q: 'danno' });
    expect(searchWords('responsabilità')).toEqual({ kind: 'words', q: 'responsabilità' });
  });

  it('is no search with no word of two characters', () => {
    expect(searchWords('')).toEqual({ kind: 'none' });
    expect(searchWords('a b c')).toEqual({ kind: 'none' });
    expect(searchWords('  ,; ')).toEqual({ kind: 'none' });
  });

  it('refuses more than eight words, or a text over the limit, as the API does', () => {
    expect(searchWords('uno due tre quattro cinque sei sette otto').kind).toBe('words');
    expect(searchWords('uno due tre quattro cinque sei sette otto nove')).toEqual({ kind: 'too_many' });
    expect(searchWords('x'.repeat(MAX_QUERY_CHARS + 1))).toEqual({ kind: 'too_many' });
  });
});
