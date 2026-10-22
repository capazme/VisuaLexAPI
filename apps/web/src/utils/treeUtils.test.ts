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

// Normattiva writes an ordinal in two words in the tree and in the AKN export («135 sex decies», codice del consumo)
// and in one in the URN («135sexdecies»): one article, as the API's `comparable_article_key` reads it (#270).
describe('normalizeArticleId — an ordinal split in two words', () => {
  it('reads every spelling of art. 135-sexdecies as one', () => {
    for (const spelling of [
      '135 sex decies', '135-sex-decies', '135 sex-decies', // split
      '135sexdecies', '135 sexdecies', // attached, spaced
      '135-sexdecies', // with the dash
      '135 SEX DECIES', '135-SexDecies', ' 135 Sex  Decies ', // capitals and stray spaces
    ]) {
      expect(normalizeArticleId(spelling), spelling).toBe('135-sexdecies');
    }
  });

  it('joins the other two-word ordinals the table holds joined', () => {
    expect(normalizeArticleId('25 quinquies decies')).toBe('25-quinquiesdecies');
    expect(normalizeArticleId('2409 octies decies')).toBe('2409-octiesdecies');
    expect(normalizeArticleId('25 ter decies')).toBe('25-terdecies');
  });

  it('keeps a dotted sub-number after the joined ordinal', () => {
    expect(normalizeArticleId('135 sex decies.1')).toBe('135-sexdecies.1');
  });

  it('leaves two words the table does not hold joined', () => {
    expect(normalizeArticleId('135 vicies semel')).toBe('135-vicies-semel');
    expect(normalizeArticleId('25 bis ter')).toBe('25-bis-ter');
  });

  it('puts the dash in a suffix written against its number, and only a suffix', () => {
    expect(normalizeArticleId('2bis')).toBe('2-bis');
    expect(normalizeArticleId('270bis.1')).toBe('270-bis.1');
    expect(normalizeArticleId('2043')).toBe('2043');
    expect(normalizeArticleId('314/2')).toBe('314/2');
    expect(normalizeArticleId('all2:3 bis')).toBe('all2:3-bis');
  });
});
