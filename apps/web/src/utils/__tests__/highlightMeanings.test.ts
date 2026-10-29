import { describe, expect, it } from 'vitest';
import {
  HIGHLIGHT_COLOR_MEANINGS,
  normalizeHighlightMeaning,
  resolveHighlightMeanings,
  sanitizeHighlightMeanings,
} from '../highlightColors';

describe('a colour\'s meaning, as the user writes it', () => {
  it('is trimmed, and 1 to 40 characters', () => {
    expect(normalizeHighlightMeaning('  Termini e scadenze ')).toBe('Termini e scadenze');
    expect(normalizeHighlightMeaning('x')).toBe('x');
    expect(normalizeHighlightMeaning('a'.repeat(40))).toBe('a'.repeat(40));
    expect(normalizeHighlightMeaning('a'.repeat(41))).toBeNull();
    // Counted by characters, not UTF-16 units: an accented or astral letter is one.
    expect(normalizeHighlightMeaning('§'.repeat(40))).toBe('§'.repeat(40));
    expect(normalizeHighlightMeaning('𝒜'.repeat(40))).toBe('𝒜'.repeat(40));
  });

  it('is none when empty, blank or not a word', () => {
    for (const value of ['', '   ', null, undefined, 3, {}]) expect(normalizeHighlightMeaning(value)).toBeNull();
  });
});

describe('the meanings a save holds', () => {
  it('keeps a valid meaning of a known colour that is not the default', () => {
    expect(sanitizeHighlightMeanings({ yellow: ' Tesi ', blue: 'GDPR' })).toEqual({ yellow: 'Tesi', blue: 'GDPR' });
  });

  it('drops an unknown colour, an invalid meaning and one equal to the default', () => {
    expect(sanitizeHighlightMeanings({
      purple: 'Viola', green: '', red: 'x'.repeat(41), blue: 7, yellow: HIGHLIGHT_COLOR_MEANINGS.yellow,
    })).toEqual({});
  });

  it('is none for a save that is not an object', () => {
    for (const value of [null, undefined, 'giallo', 3, true]) expect(sanitizeHighlightMeanings(value)).toEqual({});
  });

  it('resolves to the four: the user\'s own where given, the default elsewhere', () => {
    expect(resolveHighlightMeanings({ green: 'Termini' })).toEqual({ ...HIGHLIGHT_COLOR_MEANINGS, green: 'Termini' });
    expect(resolveHighlightMeanings(undefined)).toEqual(HIGHLIGHT_COLOR_MEANINGS);
  });
});
