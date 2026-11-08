import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('knows the theme\'s frame and measure as max-widths: the later one wins (U1)', () => {
    expect(cn('max-w-measure', 'max-w-none')).toBe('max-w-none');
    expect(cn('max-w-prose', 'max-w-measure')).toBe('max-w-measure');
    expect(cn('max-w-frame', 'max-w-frame-full')).toBe('max-w-frame-full');
  });

  it('keeps a variant\'s width beside the base one, and the padding\'s sides beside its axes', () => {
    expect(cn('max-w-frame', 'has-[[data-page-width=full]]:max-w-frame-full')).toBe('max-w-frame has-[[data-page-width=full]]:max-w-frame-full');
    expect(cn('px-4 md:px-8 2xl:px-12 py-4 md:py-8', 'pt-8 md:pt-8 md:pb-[var(--page-foot)]')).toBe('px-4 md:px-8 2xl:px-12 py-4 md:py-8 pt-8 md:pt-8 md:pb-[var(--page-foot)]');
  });
});
