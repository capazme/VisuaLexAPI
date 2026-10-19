import { describe, it, expect } from 'vitest';
import { extractArticleIdsFromTree, normalizeArticleId } from './treeUtils';

// The article tree spells every suffix with a space ("25 undecies"), and
// Normattiva goes far past "decies": tests/test_article_existence.py records
// the spellings captured live from the tree of c.p.c., c.p., c.c. and
// d.lgs. 231/2001. A node whose suffix the reader could not recognise was
// dropped from the index altogether, so the article never appeared in it.
describe('extractArticleIdsFromTree — suffixes past decies', () => {
  it('keeps the long suffixes the live tree returns', () => {
    const tree = [
      '25', '25 bis', '25 undecies', '25 quinquiesdecies', '25 septiesdecies', '25 undevicies',
      '669 terdecies', '2409 octiesdecies', '2409 noviesdecies',
    ];
    expect(extractArticleIdsFromTree(tree)).toEqual(tree);
  });

  it('keeps the hyphenated spelling too', () => {
    expect(extractArticleIdsFromTree(['25-terdecies', '452-quaterdecies'])).toEqual(['25-terdecies', '452-quaterdecies']);
  });

  it('still skips section titles', () => {
    expect(extractArticleIdsFromTree(['TITOLO I - Disposizioni generali', '1'])).toEqual(['1']);
  });

  it('reads a roman numeral with a long suffix', () => {
    expect(extractArticleIdsFromTree(['II terdecies'])).toEqual(['II terdecies']);
  });

  it('normalises the spaced spelling', () => {
    expect(normalizeArticleId('25 terdecies')).toBe('25-terdecies');
  });
});
