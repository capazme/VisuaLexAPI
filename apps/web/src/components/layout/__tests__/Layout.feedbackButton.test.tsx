import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../ui/ChangelogNotification', () => ({
  ChangelogNotification: ({ inBar }: { inBar?: boolean }) => <span data-testid={inBar ? 'news-in-bar' : 'news-floating'} />,
}));
vi.mock('../../ui/Toast', () => ({ NotificationHost: () => null }));
// The planner's host reads the tasks from the server: not under test here.
vi.mock('../../features/planner/PlannerHost', () => ({ PlannerHost: () => null }));
vi.mock('../../ui/SyncErrorToast', () => ({ SyncErrorToast: () => null }));
vi.mock('../../../hooks/useServiceHealth', () => ({ useServiceHealth: () => ({ snapshot: { overall: 'online', services: [], checkedAt: '' }, refresh: vi.fn() }) }));
vi.mock('../../features/compare/CompareView', () => ({ CompareView: () => null }));
vi.mock('../../../plugins/PluginSlot', () => ({ PluginSlot: () => null }));
const auth = vi.hoisted(() => ({ isAuthenticated: true }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../../../hooks/useTour', () => ({
  useTour: () => ({ startTour: vi.fn(), tryStartTour: vi.fn(), hasSeenTour: () => true, resetAndStartTour: vi.fn() }),
}));

import { Layout } from '../Layout';
import { appStore } from '../../../store/useAppStore';

const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><Layout /></MemoryRouter>);

const noComments = () => expect(screen.queryByRole('button', { name: /Commenti|Segnala un problema/ })).toBeNull();

// LC92: «Commenti» left the top right for the bug beside «Impostazioni» in the sidebar, at every width.
describe('Layout — no «Commenti» at the top right (LC92)', () => {
  afterEach(() => {
    auth.isAuthenticated = true;
  });

  it.each(['/', '/learn/ripasso', '/learn/ripasso/sessione?materia=DIRITTO_CIVILE', '/learn/valida', '/learn/schede', '/pratiche'])(
    'draws no «Commenti» on %s, below lg',
    (path) => {
      at(path);
      noComments();
      expect(screen.getByRole('button', { name: 'Tutto schermo' })).toBeInTheDocument();
    },
  );

  it('keeps the top rows clear of «Tutto schermo» in full screen below lg', () => {
    const before = appStore.getState().settings;
    appStore.setState({ settings: { ...before, focusMode: true } });
    try {
      at('/pratiche');
      noComments();
      expect(screen.getByTestId('layout-content')).toHaveClass('md:[--focus-button-room:11rem]');
    } finally {
      appStore.setState({ settings: before });
    }
  });

  // LC21: from lg the controls sit in the top bar (or the search page's bar), so no top row keeps room outside full screen.
  it('asks no room of the top rows outside full screen; the search page\'s field ends before the controls', () => {
    at('/pratiche');
    expect(screen.getByTestId('layout-content').className).not.toMatch(/--focus-button-room/);
    cleanup();
    at('/');
    expect(screen.getByTestId('layout-content').className).not.toMatch(/--focus-button-room/);
    expect(screen.getByTestId('search-bar')).toHaveClass('md:pr-[10.5rem]', 'lg:pr-[17rem]');
  });

  it("leaves the page's foot its own padding: nothing floats there any more", () => {
    at('/pratiche');
    expect(screen.getByTestId('layout-content').className).not.toMatch(/page-foot/);
  });

  // The services pill covered the foot of the page on a phone: it is the user menu's «Stato dei servizi» (S1).
  it.each(['/', '/learn/ripasso', '/learn/ripasso/sessione', '/learn/valida', '/pratiche'])('draws no services pill on %s', (path) => {
    at(path);
    expect(screen.queryByText(/Servizi operativi|Controllo servizi/)).toBeNull();
  });
});

// LC21: from lg the controls that floated sit in a bar: the top bar on every page but the search page, the lesson and
// full screen; the search page's own bar on `/`.
describe('Layout — the top bar from lg (LC21)', () => {
  const original = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = ((query: string) => ({ ...original(query), matches: query === '(min-width: 1024px)' })) as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = original;
    appStore.setState((s) => ({ settings: { ...s.settings, focusMode: false } }));
  });

  it.each(['/pratiche', '/work/scadenziario', '/forum', '/learn/schede'])('draws the bar on %s, with the path, the search and its controls, none floating, and no «Commenti»', (path) => {
    at(path);
    const bar = screen.getByTestId('top-bar');
    expect(within(bar).getByRole('navigation', { name: 'Percorso' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Apri il menu di ricerca' })).toBeInTheDocument();
    noComments();
    expect(within(bar).getByTestId('news-in-bar')).toBeInTheDocument();
    const fullScreen = within(bar).getByRole('button', { name: 'Tutto schermo' });
    expect(fullScreen).toHaveAttribute('aria-pressed', 'false');
    expect(fullScreen).not.toHaveClass('fixed');
    // One of each: nothing left floating over the page.
    expect(screen.getAllByRole('button', { name: 'Tutto schermo' })).toHaveLength(1);
    expect(screen.queryByTestId('news-floating')).toBeNull();
  });

  it('opens the command palette from the bar\'s search', () => {
    appStore.setState({ commandPaletteOpen: false });
    at('/pratiche');
    fireEvent.click(within(screen.getByTestId('top-bar')).getByRole('button', { name: 'Apri il menu di ricerca' }));
    expect(appStore.getState().commandPaletteOpen).toBe(true);
    appStore.setState({ commandPaletteOpen: false });
  });

  it('opens full screen from the bar', () => {
    at('/pratiche');
    fireEvent.click(within(screen.getByTestId('top-bar')).getByRole('button', { name: 'Tutto schermo' }));
    expect(appStore.getState().settings.focusMode).toBe(true);
  });

  it('on the search page draws the top bar too, with the path «Work › Ricerca» and the field, compact, in the search\'s place (anti-slop FAIL, 15 Nov)', () => {
    at('/');
    expect(screen.queryByTestId('search-bar')).toBeNull();
    const bar = screen.getByTestId('top-bar');
    expect(within(bar).getByRole('navigation', { name: 'Percorso' })).toHaveTextContent('WorkRicerca');
    expect(within(bar).getByRole('search', { name: 'Ricerca' })).toBeInTheDocument();
    noComments();
    expect(within(bar).getByRole('button', { name: 'Tutto schermo' })).toBeInTheDocument();
    expect(within(bar).getByTestId('news-in-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('news-floating')).toBeNull();
    // The practice's columns are the viewport less this bar, 52 px.
    expect(document.querySelector('main')).toHaveClass('[--search-bar-height:3.25rem]');
  });

  it('draws no top bar under the lesson', () => {
    at('/learn/ripasso/sessione?materia=DIRITTO_CIVILE');
    expect(screen.queryByTestId('top-bar')).toBeNull();
  });

  // LC27 (Luca, 15 Nov: «il passaggio a full screen è veramente brutto»): the bar stays in full screen, its controls in it.
  it('keeps the bar in full screen, with its controls in it and «Tutto schermo» pressed', () => {
    appStore.setState((s) => ({ settings: { ...s.settings, focusMode: true } }));
    at('/pratiche');
    const bar = screen.getByTestId('top-bar');
    noComments();
    expect(within(bar).getByRole('button', { name: 'Tutto schermo' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('news-floating')).toBeNull();
    expect(screen.getByTestId('layout-content')).not.toHaveClass('md:[--focus-button-room:11rem]');
  });
});

describe('Layout — below lg the controls float as before', () => {
  it('draws no top bar, and the news floats', () => {
    at('/pratiche');
    expect(screen.queryByTestId('top-bar')).toBeNull();
    noComments();
    expect(screen.getByTestId('news-floating')).toBeInTheDocument();
    expect(screen.queryByTestId('news-in-bar')).toBeNull();
  });

  // LC92 (Papiniano, 390 px): the news covered the drawer's foot and took its clicks; it hides while the drawer is open.
  it("hides the news while the phone's drawer is open, and shows it again once it closes", () => {
    at('/pratiche');
    const host = screen.getByTestId('news-floating-host');
    expect(host).not.toHaveAttribute('hidden');
    fireEvent.click(within(screen.getByTestId('phone-top-bar')).getByRole('button', { name: 'Apri il menu' }));
    expect(host).toHaveAttribute('hidden');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(host).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('news-floating')).toBeInTheDocument();
  });
});

// LC141 (Luca, 19 Nov): «Dicci cosa ti serve», the bug at the top right in every bar; it opens `/impostazioni#segnala`.
describe('Layout — «Dicci cosa ti serve» at the top right (LC141)', () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
    auth.isAuthenticated = true;
  });
  const Where = () => {
    const { pathname, hash } = useLocation();
    return <p data-testid="where">{pathname + hash}</p>;
  };
  const withWhere = (path: string) => render(<MemoryRouter initialEntries={[path]}><Layout /><Where /></MemoryRouter>);

  it('sits in the top bar from lg, beside «Tutto schermo», outlined, with its words, and opens the part', () => {
    window.matchMedia = ((query: string) => ({ ...original(query), matches: query === '(min-width: 1024px)' })) as typeof window.matchMedia;
    withWhere('/pratiche');
    const button = within(screen.getByTestId('top-bar')).getByRole('button', { name: 'Dicci cosa ti serve' });
    expect(button).toHaveAttribute('title', 'Dicci cosa ti serve');
    expect(button).toHaveTextContent('Dicci cosa ti serve');
    expect(button).toHaveClass('border');
    expect(button).not.toHaveClass('bg-toga-600');
    fireEvent.click(button);
    expect(screen.getByTestId('where')).toHaveTextContent('/impostazioni#segnala');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each(['/pratiche', '/'])("sits in the phone's bar on %s, the icon alone below md, 44 px", (path) => {
    at(path);
    const bar = screen.getByTestId(path === '/' ? 'search-bar' : 'phone-top-bar');
    const button = within(bar).getByRole('button', { name: 'Dicci cosa ti serve' });
    expect(button).toHaveAttribute('title', 'Dicci cosa ti serve');
    expect(button).toHaveClass('min-h-11', 'max-md:w-11', 'max-md:px-0');
    expect(within(button).getByText('Dicci cosa ti serve')).toHaveClass('max-md:sr-only');
  });

  it('is not drawn for a guest, who has no part to reach', () => {
    auth.isAuthenticated = false;
    at('/pratiche');
    expect(screen.queryByRole('button', { name: 'Dicci cosa ti serve' })).toBeNull();
  });
});
