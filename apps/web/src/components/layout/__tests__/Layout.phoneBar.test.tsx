// The phone's bar with the drawer and the keyboard (M1): it comes back when the focus lands in it and never hides with
// the focus inside, and closing the drawer gives the focus to its menu button.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../Sidebar', () => ({
  // The drawer's copy: a link that closes it, as a NavItem does.
  Sidebar: ({ layout, closeMobile }: { layout?: string; closeMobile: () => void }) =>
    layout === 'drawer' ? <aside><button type="button" onClick={closeMobile}>Voce del menu</button></aside> : null,
}));
vi.mock('../../ui/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('../../ui/FeedbackButton', () => ({ FeedbackButton: () => null }));
vi.mock('../../ui/FeedbackModal', () => ({ FeedbackModal: () => null }));
vi.mock('../../ui/ChangelogNotification', () => ({ ChangelogNotification: () => null }));
vi.mock('../../ui/Toast', () => ({ UndoToastContainer: () => null }));
vi.mock('../../ui/SyncErrorToast', () => ({ SyncErrorToast: () => null }));
// The planner's host reads the tasks from the server: not under test here.
vi.mock('../../features/planner/PlannerHost', () => ({ PlannerHost: () => null }));
vi.mock('../../ui/KeyboardShortcutsModal', () => ({ KeyboardShortcutsModal: () => null }));
vi.mock('../../features/search/GlobalSearch', () => ({ GlobalSearch: () => null }));
vi.mock('../../../hooks/useServiceHealth', () => ({ useServiceHealth: () => ({ snapshot: { overall: 'online', services: [], checkedAt: '' }, refresh: vi.fn() }) }));
vi.mock('../../features/compare/CompareView', () => ({ CompareView: () => null }));
vi.mock('../../../plugins/PluginSlot', () => ({ PluginSlot: () => null }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock('../../../hooks/useTour', () => ({
  useTour: () => ({ startTour: vi.fn(), hasSeenTour: () => true, resetAndStartTour: vi.fn(), tryStartTour: vi.fn() }),
}));

import { appStore } from '../../../store/useAppStore';
import { Layout } from '../Layout';

const original = window.matchMedia;
beforeEach(() => {
  appStore.setState((s) => ({ settings: { ...s.settings, focusMode: false } }));
  // A phone: below md, where the bar moves.
  window.matchMedia = ((query: string) => ({ ...original(query), matches: query === '(max-width: 767.98px)' })) as typeof window.matchMedia;
});
afterEach(() => {
  window.matchMedia = original;
});

function page() {
  render(<MemoryRouter initialEntries={['/forum']}><Layout /></MemoryRouter>);
  const scroller = screen.getByTestId('layout-content').parentElement!;
  let top = 0;
  Object.defineProperty(scroller, 'scrollTop', { get: () => top, configurable: true });
  Object.defineProperty(scroller, 'scrollHeight', { value: 4000, configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { value: 800, configurable: true });
  const scrollTo = (value: number) => act(() => {
    top = value;
    scroller.dispatchEvent(new Event('scroll'));
  });
  return { bar: screen.getByTestId('phone-top-bar'), scrollTo };
}

describe('Layout — the phone\'s bar and the keyboard', () => {
  it('comes back when the focus lands inside it, and does not hide again while the focus stays there', () => {
    const { bar, scrollTo } = page();
    scrollTo(300);
    expect(bar).toHaveClass('max-md:-translate-y-full');

    act(() => within(bar).getByRole('button', { name: 'Apri il menu di ricerca' }).focus());
    expect(bar).not.toHaveClass('max-md:-translate-y-full');

    scrollTo(900);
    scrollTo(1500);
    expect(bar).not.toHaveClass('max-md:-translate-y-full');

    act(() => (document.activeElement as HTMLElement).blur());
    scrollTo(2100);
    expect(bar).toHaveClass('max-md:-translate-y-full');
  });

  it('gives the focus to the menu button when the drawer closes from inside it', () => {
    const { bar } = page();
    const toggle = within(bar).getByRole('button', { name: 'Apri il menu' });
    fireEvent.click(toggle);
    const entry = screen.getByRole('button', { name: 'Voce del menu' });
    entry.focus();
    fireEvent.click(entry);
    expect(within(bar).getByRole('button', { name: 'Apri il menu' })).toHaveFocus();
  });

  it('closes the drawer with Esc and gives the focus to the menu button, from the button itself', () => {
    const { bar } = page();
    const toggle = within(bar).getByRole('button', { name: 'Apri il menu' });
    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(toggle, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });

  it('closes the drawer with Esc and gives the focus to the menu button, from inside the drawer', () => {
    const { bar } = page();
    fireEvent.click(within(bar).getByRole('button', { name: 'Apri il menu' }));
    const entry = screen.getByRole('button', { name: 'Voce del menu' });
    entry.focus();

    fireEvent.keyDown(entry, { key: 'Escape' });
    const toggle = within(bar).getByRole('button', { name: 'Apri il menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });

  it('leaves an Esc a control inside the drawer took', () => {
    const { bar } = page();
    fireEvent.click(within(bar).getByRole('button', { name: 'Apri il menu' }));
    const entry = screen.getByRole('button', { name: 'Voce del menu' });
    entry.addEventListener('keydown', (e) => e.preventDefault());

    fireEvent.keyDown(entry, { key: 'Escape' });
    expect(within(bar).getByRole('button', { name: 'Chiudi il menu' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('focuses the magnifier it opens the search menu from, which Safari\'s click does not, so the menu gives it back', () => {
    const { bar } = page();
    const lens = within(bar).getByRole('button', { name: 'Apri il menu di ricerca' });
    // fireEvent's click, like Safari's, moves no focus.
    fireEvent.click(lens);
    expect(lens).toHaveFocus();
    expect(appStore.getState().commandPaletteOpen).toBe(true);
    act(() => appStore.getState().closeCommandPalette());
  });

  it('parks the focus on a button a section\'s new title may still take', () => {
    const { bar } = page();
    expect(within(bar).getByRole('button', { name: 'Apri il menu' })).toHaveAttribute('data-focus-parked');
  });
});
