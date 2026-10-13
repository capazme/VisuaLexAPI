import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../practice/ReadingRow', () => ({ ReadingRow: () => null }));
vi.mock('../practice/PracticeBar', () => ({ PracticeBar: () => null }));
vi.mock('../practice/PracticePhoneView', () => ({ PracticePhoneView: () => null }));
vi.mock('./ReadingBackControl', () => ({ ReadingBackControl: () => null }));

import { appStore } from '../../../store/useAppStore';
import { SearchPanel } from './SearchPanel';
import { resetSearchFieldControl, subscribeSearchField } from '../../../utils/searchFieldControl';

beforeEach(() => appStore.setState({ practices: [], activePracticeId: null, commandPaletteOpen: false, commandPaletteQuery: null }));
afterEach(() => resetSearchFieldControl());

// The page with no practice leads to the field above it (spec 2026-10-13-fixed-search-design.md),
// never to the palette's window.
describe('SearchPanel — the empty page', () => {
  it('an example fills the search field, ready for Enter', () => {
    const field = vi.fn();
    subscribeSearchField(field);
    render(<MemoryRouter><SearchPanel /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Art. 2043 c.c.' }));
    expect(field).toHaveBeenCalledWith({ text: 'Art. 2043 c.c.' });
    expect(appStore.getState().commandPaletteOpen).toBe(false);
  });

  it('with no field on screen (Focus mode), an example opens the palette with its words', () => {
    render(<MemoryRouter><SearchPanel /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Art. 5 GDPR' }));
    expect(appStore.getState().commandPaletteOpen).toBe(true);
    expect(appStore.getState().commandPaletteQuery).toBe('Art. 5 GDPR');
  });

  it('«Inizia una ricerca» puts the cursor in the field', () => {
    const field = vi.fn();
    subscribeSearchField(field);
    render(<MemoryRouter><SearchPanel /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Inizia una ricerca/ }));
    expect(field).toHaveBeenCalledWith({});
    expect(appStore.getState().commandPaletteOpen).toBe(false);
  });
});
