import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../ui/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('../../ui/FeedbackButton', () => ({ FeedbackButton: () => null }));
vi.mock('../../ui/ChangelogNotification', () => ({ ChangelogNotification: () => null }));
vi.mock('../../ui/Toast', () => ({ UndoToastContainer: () => null }));
vi.mock('../../ui/SyncErrorToast', () => ({ SyncErrorToast: () => null }));
vi.mock('../../ui/KeyboardShortcutsModal', () => ({ KeyboardShortcutsModal: () => null }));
vi.mock('../../../hooks/useServiceHealth', () => ({ useServiceHealth: () => ({ snapshot: { overall: 'online', services: [], checkedAt: '' }, refresh: vi.fn() }) }));
vi.mock('../../features/compare/CompareView', () => ({ CompareView: () => null }));
vi.mock('../../../plugins/PluginSlot', () => ({ PluginSlot: () => null }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock('../../../hooks/useTour', () => ({
  useTour: () => ({ startTour: vi.fn(), hasSeenTour: () => true, resetAndStartTour: vi.fn(), tryStartTour: vi.fn() }),
}));

import { appStore } from '../../../store/useAppStore';
import { Layout } from '../Layout';

const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><Layout /></MemoryRouter>);
const INSET = ['pt-[calc(4.5rem+env(safe-area-inset-top))]', 'md:pt-[calc(4.5rem+env(safe-area-inset-top))]', 'lg:pt-8'];

beforeEach(() => {
  appStore.setState((s) => ({ settings: { ...s.settings, focusMode: false }, commandPaletteOpen: false }));
});

describe('Layout — the phone\'s bar below lg (M1)', () => {
  it.each(['/dossier', '/dossier?dossier=d1', '/history', '/forum', '/studia/schede', '/documents'])(
    'draws the bar with the menu button and starts the content under it on %s',
    (path) => {
      at(path);
      const bar = screen.getByTestId('phone-top-bar');
      expect(within(bar).getByRole('button', { name: 'Apri il menu' })).toBeInTheDocument();
      expect(bar).toHaveClass('lg:hidden', 'absolute', 'top-0');
      expect(screen.getByTestId('layout-content')).toHaveClass(...INSET);
    },
  );

  it.each([
    ['/studia/ripasso', 'Oggi'],
    ['/forum/community', 'Community'],
    ['/collega-app', 'Collega un’app AI'],
  ])('names the page in the middle on %s', (path, title) => {
    at(path);
    expect(within(screen.getByTestId('phone-top-bar')).getByText(title)).toBeInTheDocument();
  });

  it('opens the search menu from its magnifier', async () => {
    at('/dossier');
    await userEvent.click(within(screen.getByTestId('phone-top-bar')).getByRole('button', { name: 'Apri il menu di ricerca' }));
    expect(appStore.getState().commandPaletteOpen).toBe(true);
  });

  it('sets where sticky rows pin under it, and clears it once the bar slides away scrolling down', () => {
    const original = window.matchMedia;
    // A phone: the bar moves below md only.
    window.matchMedia = ((query: string) => ({ ...original(query), matches: query === '(max-width: 767.98px)' })) as typeof window.matchMedia;
    try {
      at('/studia/schede');
      const main = document.querySelector('main')!;
      expect(main).toHaveClass('max-lg:[--phone-bar-offset:calc(3.5rem+env(safe-area-inset-top))]');
      expect(main).not.toHaveClass('max-md:[--phone-bar-offset:0px]');
      const scroller = screen.getByTestId('layout-content').parentElement!;
      Object.defineProperty(scroller, 'scrollHeight', { value: 4000, configurable: true });
      Object.defineProperty(scroller, 'clientHeight', { value: 800, configurable: true });
      Object.defineProperty(scroller, 'scrollTop', { value: 400, configurable: true });
      act(() => {
        scroller.dispatchEvent(new Event('scroll'));
      });
      expect(screen.getByTestId('phone-top-bar')).toHaveClass('max-md:-translate-y-full');
      expect(main).toHaveClass('max-md:[--phone-bar-offset:0px]');
    } finally {
      window.matchMedia = original;
    }
  });

  it('stops what the focus or an anchor scrolls to under the bar (WCAG 2.4.11), and only where the bar is', () => {
    const { unmount } = at('/forum');
    const PADDING = 'max-lg:scroll-pt-[calc(3.5rem+env(safe-area-inset-top)+0.5rem)]';
    expect(screen.getByTestId('layout-content').parentElement).toHaveClass(PADDING);
    unmount();
    at('/');
    expect(screen.getByTestId('layout-content').parentElement).not.toHaveClass(PADDING);
  });

  it('leaves the search page to its own bar: the field, with the menu button beside it', () => {
    at('/');
    expect(screen.queryByTestId('phone-top-bar')).toBeNull();
    expect(within(screen.getByTestId('search-bar')).getByRole('button', { name: 'Apri il menu' })).toBeInTheDocument();
    for (const cls of INSET) expect(screen.getByTestId('layout-content')).not.toHaveClass(cls);
  });

  it('draws no bar under Gymnasium\'s lesson, which covers the shell', () => {
    at('/studia/ripasso/sessione?materia=DIRITTO_CIVILE');
    expect(screen.queryByTestId('phone-top-bar')).toBeNull();
  });

  it('names the bar for a section change, so the page\'s picture passes under it (T1)', () => {
    at('/forum');
    expect(screen.getByTestId('phone-top-bar')).toHaveClass('vlx-phone-bar');
  });

  it('adds nothing in focus mode, where neither the bar nor the button is drawn', () => {
    appStore.setState((s) => ({ settings: { ...s.settings, focusMode: true } }));
    at('/dossier');
    expect(screen.queryByTestId('phone-top-bar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apri il menu' })).toBeNull();
    for (const cls of INSET) expect(screen.getByTestId('layout-content')).not.toHaveClass(cls);
  });
});

describe('Layout — what a section change animates (T1)', () => {
  it('names the content area only, so the bars and the floating buttons hold still; <main> keeps its stacking context', () => {
    at('/dossier');
    const area = screen.getByTestId('layout-content').parentElement!;
    expect(area).toHaveClass('vlx-page');
    expect(document.querySelectorAll('.vlx-page')).toHaveLength(1);
    const main = document.querySelector('main')!;
    expect(main).not.toHaveClass('vlx-page');
    expect(main).toHaveClass('isolate');
  });
});
