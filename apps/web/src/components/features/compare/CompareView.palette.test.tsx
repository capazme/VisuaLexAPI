import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../hooks/useTour', () => ({
  useTour: () => ({ tryStartTour: vi.fn(), startTour: vi.fn(), hasSeenTour: () => true }),
}));

import { CompareView } from './CompareView';
import { CommandPalette } from '../search/CommandPalette';
import { Modal } from '../../ui/Modal';
import { closeCompare, getCompareState, setCompareState } from '../../../hooks/useCompare';
import { appStore } from '../../../store/useAppStore';
import { openSearchMenu } from '../../../utils/searchFieldControl';

/**
 * The search menu and the dialogs: under the comparison (a modal dialog over the page) ⌘K opens nothing, the menu being
 * a band in the page (L-75); a dialog opened over the menu keeps its own Esc (`dialogStack`).
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
  // L-75: the menu is a band in the page, under the comparison, which covers the page: ⌘K there would open it unseen.
  it.each([['on a computer', true], ['on a phone', false]])('%s, ⌘K opens nothing while the comparison covers the page', (_, desktop) => {
    asDesktop(desktop);
    render(<CompareView />);
    expect(screen.getByRole('dialog', { name: 'Confronta articoli', hidden: true })).toHaveAttribute('aria-modal', 'true');
    appStore.setState({ commandPaletteOpen: false });
    openSearchMenu();
    expect(appStore.getState().commandPaletteOpen).toBe(false);
    expect(getCompareState().isOpen).toBe(true);
  });

  it('leaves Esc to a dialog opened over the menu', () => {
    asDesktop(true);
    const onClose = vi.fn();
    const onModalClose = vi.fn();
    render(<><CommandPalette isOpen onClose={onClose} onSearch={vi.fn()} /><Modal isOpen onClose={onModalClose} title="Sopra" /></>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onModalClose).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
