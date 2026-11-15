import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LexCraftLogo } from '../LexCraftLogo';
import { logoSweepDue, LOGO_SWEEP_KEY, markLogoSweep } from '../logoSweep';
import { CRAFT, LEX } from '../lexCraftLogoPaths';

function reducedMotion(reduce: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as unknown as MediaQueryList);
}

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('LexCraftLogo (D-136, D-201)', () => {
  it('is one image named «LexCraft», drawn from the design file\'s outlines in the app\'s tokens', () => {
    const { container } = render(<LexCraftLogo />);
    const logo = screen.getByRole('img', { name: 'LexCraft' });
    expect(logo.tagName.toLowerCase()).toBe('svg');
    const paths = [...container.querySelectorAll('path')].map((p) => p.getAttribute('d'));
    expect(paths).toContain(LEX);
    expect(paths).toContain(CRAFT);
    // No colour written out: every fill reads a token.
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });

  it('still: the still logo\'s box, no motion', () => {
    render(<LexCraftLogo />);
    const logo = screen.getByRole('img', { name: 'LexCraft' });
    expect(logo).toHaveAttribute('viewBox', '-11.0 -96.9 716.3 130.9');
    expect(logo.getAttribute('class')).not.toMatch(/vlx-logo-(sweep|intro)/);
  });

  it('sweep: only the cursor\'s run, inside the still logo\'s box', () => {
    reducedMotion(false);
    render(<LexCraftLogo motion="sweep" />);
    const logo = screen.getByRole('img', { name: 'LexCraft' });
    expect(logo).toHaveClass('vlx-logo-sweep');
    expect(logo).toHaveAttribute('viewBox', '-11.0 -96.9 716.3 130.9');
  });

  it('intro: the whole animation, in the design file\'s taller box', () => {
    reducedMotion(false);
    render(<LexCraftLogo motion="intro" />);
    const logo = screen.getByRole('img', { name: 'LexCraft' });
    expect(logo).toHaveClass('vlx-logo-intro');
    expect(logo).toHaveAttribute('viewBox', '-36 -176 772 290');
  });

  it('under reduced motion has no animation class, in either mode', () => {
    reducedMotion(true);
    const { rerender } = render(<LexCraftLogo motion="intro" />);
    expect(screen.getByRole('img', { name: 'LexCraft' }).getAttribute('class')).not.toMatch(/vlx-logo-(sweep|intro)/);
    rerender(<LexCraftLogo motion="sweep" />);
    expect(screen.getByRole('img', { name: 'LexCraft' }).getAttribute('class')).not.toMatch(/vlx-logo-(sweep|intro)/);
  });
});

describe('the shell\'s sweep, once per browser session', () => {
  it('is due until marked, then not again', () => {
    expect(logoSweepDue()).toBe(true);
    markLogoSweep();
    expect(sessionStorage.getItem(LOGO_SWEEP_KEY)).not.toBeNull();
    expect(logoSweepDue()).toBe(false);
  });

  it('is not due when the browser refuses its storage (it throws)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(logoSweepDue()).toBe(false);
    expect(() => markLogoSweep()).not.toThrow();
  });
});
