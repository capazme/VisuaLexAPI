import { afterEach, describe, expect, it } from 'vitest';
import { isFindWindowScopedTo, reportFindWindowScope } from '../findWindowControl';

afterEach(() => reportFindWindowScope(null));

describe('isFindWindowScopedTo', () => {
  it('is false for another practice, or a surface with no host', () => {
    reportFindWindowScope('a', 'k1');
    expect(isFindWindowScopedTo('b', 'k1')).toBe(false);
    expect(isFindWindowScopedTo(undefined, 'k1')).toBe(false);
  });

  it('a window pointed at one text covers that text only', () => {
    reportFindWindowScope('a', 'k1');
    expect(isFindWindowScopedTo('a', 'k1')).toBe(true);
    expect(isFindWindowScopedTo('a', 'k2')).toBe(false);
    expect(isFindWindowScopedTo('a')).toBe(true);
  });

  it('a window on the practice with no text pointed at covers every text of it, except when asked exactly (R3)', () => {
    reportFindWindowScope('a', null);
    expect(isFindWindowScopedTo('a', 'k1')).toBe(true);
    expect(isFindWindowScopedTo('a', 'k1', true)).toBe(false);
    reportFindWindowScope('a', 'k1');
    expect(isFindWindowScopedTo('a', 'k1', true)).toBe(true);
  });
});
