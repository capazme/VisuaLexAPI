import { describe, it, expect } from 'vitest';
import { authorityToStars } from '../authority';

describe('authorityToStars', () => {
  it('buckets authority (0..1) into 1/2/3 stars', () => {
    expect(authorityToStars(0)).toBe(1);
    expect(authorityToStars(0.2)).toBe(1);
    expect(authorityToStars(0.33)).toBe(2);
    expect(authorityToStars(0.5)).toBe(2);
    expect(authorityToStars(0.65)).toBe(2);
    expect(authorityToStars(0.66)).toBe(3);
    expect(authorityToStars(1)).toBe(3);
  });
});
