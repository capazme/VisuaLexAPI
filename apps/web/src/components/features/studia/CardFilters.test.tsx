import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CardFilters } from './CardFilters';
import { NO_FILTERS } from './useMyCards';

function renderFilters() {
  return render(<CardFilters value={NO_FILTERS} onChange={() => {}} search="" onSearchChange={() => {}} acts={[]} />);
}

/** A window `width` px wide, for `min-width` queries. */
function windowOf(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
    return { matches: width >= min, media: query, addEventListener: () => {}, removeEventListener: () => {} };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// Q1: on a phone the long hint was cut («Cerca per istituto o domanc…»).
describe('CardFilters — the search box', () => {
  it('says only «Cerca nelle schede» in the box below 640 px', () => {
    windowOf(390);
    renderFilters();
    expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', 'Cerca nelle schede');
  });

  it('says what it searches in the box from 640 px', () => {
    windowOf(1366);
    renderFilters();
    expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', 'Cerca per istituto o domanda');
  });

  it.each([390, 1366])('keeps its whole name and what it searches for a screen reader at %i px', (width) => {
    windowOf(width);
    renderFilters();
    const box = screen.getByRole('searchbox', { name: 'Cerca nelle schede' });
    expect(box).toHaveAccessibleDescription('Per istituto o domanda');
  });
});
