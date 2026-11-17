import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const search = vi.hoisted(() => ({ focus: vi.fn() }));
// The setup mocks the hook for every other test (no guide over their pages): here it is the real one.
vi.mock('../../hooks/useTour', async (importOriginal) => importOriginal());
vi.mock('../../utils/searchFieldControl', () => ({ focusSearchFieldOrPalette: search.focus, PALETTE_SHORTCUT: '⌘K' }));

import { WelcomeGuide } from './WelcomeGuide';
import { useTour } from '../../hooks/useTour';
import { TOUR_STORAGE_KEY } from '../../config/tourConfig';
import { useWelcomeGuideOpen } from './welcomeGuideStore';

const seen = () => JSON.parse(localStorage.getItem(TOUR_STORAGE_KEY) ?? '{"completed":{}}').completed.welcome === true;

describe('the first-run guide', () => {
  beforeEach(() => {
    localStorage.removeItem(TOUR_STORAGE_KEY);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    search.focus.mockReset();
  });

  it('opens on the first visit with the three sections, and «Salta» marks it seen', () => {
    render(<WelcomeGuide />);
    const { result } = renderHook(() => useTour());
    act(() => result.current.tryStartTour('welcome'));
    expect(screen.getByRole('dialog', { name: /Le norme, le sentenze/ })).toBeInTheDocument();
    for (const name of ['Work', 'Learn', 'Forum']) expect(screen.getByText(name)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Salta' }));
    expect(seen()).toBe(true);
    const open = renderHook(() => useWelcomeGuideOpen());
    act(() => result.current.tryStartTour('welcome'));
    expect(open.result.current).toBe(false);
  });

  it('its second page opens the norm the reader picks in the search', () => {
    render(<WelcomeGuide />);
    const { result } = renderHook(() => useTour());
    act(() => result.current.startTour('welcome'));
    fireEvent.click(screen.getByRole('button', { name: 'Avanti' }));
    expect(screen.getByText('2 di 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Art. 2043 c.c.' }));
    act(() => vi.runAllTimers());
    expect(search.focus).toHaveBeenCalledWith('Art. 2043 c.c.');
    expect(seen()).toBe(true);
  });

  it('the pages\' own tours show nothing', () => {
    render(<WelcomeGuide />);
    const { result } = renderHook(() => useTour());
    act(() => result.current.tryStartTour('dossier'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
