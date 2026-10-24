import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../hooks/useTour', () => ({
  useTour: () => ({ tryStartTour: vi.fn(), startTour: vi.fn(), hasSeenTour: () => true }),
}));

import { CompareView } from './CompareView';
import { CommandPalette } from '../search/CommandPalette';
import { closeCompare, getCompareState, setCompareState } from '../../../hooks/useCompare';
import { appStore } from '../../../store/useAppStore';

/**
 * ⌘K over the comparison (`Layout` opens the search menu whatever covers the page): the palette's box is portalled to
 * the body, outside the comparison's dialog, so the comparison's trap must leave its Tab and Esc to it — the palette
 * takes its place on `dialogStack` while open.
 */

function asDesktop(desktop: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: desktop, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ presets: {}, known_acts: [] }) })));
  appStore.setState({ quickNorms: [], customAliases: [] });
  // jsdom lays nothing out: every element is «visible» to the comparison's trap, as in a browser.
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
    return this.parentElement;
  });
  closeCompare();
  setCompareState({ isOpen: true });
});

afterEach(() => {
  cleanup();
  closeCompare();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CompareView — the search menu opened over it', () => {
  it.each([['on a computer', true], ['on a phone', false]])('%s, leaves Tab, Shift+Tab and Esc to the menu', async (_, desktop) => {
    asDesktop(desktop);
    const onClose = vi.fn();
    render(<><CompareView /><CommandPalette isOpen onClose={onClose} onSearch={vi.fn()} /></>);
    // Under the menu, which hides the rest of the page from a screen reader while it is open.
    const comparison = screen.getByRole('dialog', { name: 'Confronta articoli', hidden: true });
    const menu = screen.getByRole('dialog', { name: 'Menu di ricerca' });
    expect(comparison).not.toContainElement(menu);
    const field = screen.getByRole('combobox');
    await waitFor(() => expect(field).toHaveFocus());
    // The comparison's own first focus (50 ms after it opens) is given before the keys below.
    await new Promise((resolve) => setTimeout(resolve, 60));
    field.focus();

    // The comparison's trap would take the key and send the focus to its own first control.
    const intoComparison = vi.fn();
    comparison.addEventListener('focusin', intoComparison);
    for (const shiftKey of [false, true]) {
      const tab = createEvent.keyDown(field, { key: 'Tab', shiftKey });
      fireEvent(field, tab);
      expect(tab.defaultPrevented).toBe(false);
      expect(intoComparison).not.toHaveBeenCalled();
      expect(menu).toContainElement(document.activeElement as HTMLElement);
    }

    // Esc closes the menu, not the comparison under it.
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(getCompareState().isOpen).toBe(true);
  });
});
