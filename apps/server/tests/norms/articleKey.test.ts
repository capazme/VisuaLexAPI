import { describe, expect, it } from 'vitest';
import { articleKey } from '../../src/norms/resolveReference';

// The key the existence check compares the norm's number with the fingerprints' and the tree's.
describe('articleKey', () => {
  it.each([
    ['2645-bis', '2645-bis'], ['2645 bis', '2645-bis'], ['2645bis', '2645-bis'], ['2043', '2043'],
  ])('%s → %s', (raw, key) => expect(articleKey(raw)).toBe(key));

  // Normattiva's tree (and the codice del consumo's AKN export) writes «135 sex decies», its URN
  // «135sexdecies», and a reference either: both spellings are one article.
  it.each([
    ['135 sex decies'], ['135-sex-decies'], ['135-sexdecies'], ['135sexdecies'],
  ])('a split ordinal joins: %s', (raw) => expect(articleKey(raw)).toBe('135-sexdecies'));

  it('joins only a pair the ordinal table holds joined', () => {
    expect(articleKey('135 septies decies')).toBe('135-septiesdecies');
    expect(articleKey('2 quater decies.1')).toBe('2-quaterdecies.1');
    expect(articleKey('135 vicies semel')).toBe('135-vicies-semel');
  });
});
