import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tryStartTour = vi.fn();
const seen = new Set<string>();

vi.mock('../../hooks/useTour', () => ({
  useTour: () => ({ tryStartTour, hasSeenTour: (type: string) => seen.has(type) }),
}));
vi.mock('../../components/features/search/SearchPanel', () => ({ SearchPanel: () => null }));

import { SearchPage } from '../SearchPage';

describe('SearchPage tour', () => {
  beforeEach(() => {
    tryStartTour.mockClear();
    seen.clear();
  });

  it('leaves the search tour to the welcome on a first visit', () => {
    render(<SearchPage />);
    expect(tryStartTour).not.toHaveBeenCalled();
  });

  it('asks for the search tour once the welcome has been seen', () => {
    seen.add('welcome');
    render(<SearchPage />);
    expect(tryStartTour).toHaveBeenCalledWith('search');
  });
});
