import { describe, expect, it } from 'vitest';
import { highlightColorName } from '../highlightColors';

describe('highlightColorName', () => {
  it('names each colour in Italian, and shows an unknown one as is', () => {
    expect(['yellow', 'green', 'red', 'blue'].map(highlightColorName)).toEqual(['giallo', 'verde', 'rosso', 'blu']);
    expect(highlightColorName('purple')).toBe('purple');
  });
});
