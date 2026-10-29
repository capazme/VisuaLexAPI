// The phone's bar with the drawer and the keyboard (M1): it comes back when the focus lands in it and never hides with
// the focus inside, and closing the drawer gives the focus to its menu button.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
vi.mock('../../ui/Toast', () => ({ NotificationHost: () => null }));
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

  it('leaves Esc to the page once the window is wide enough to hide the drawer', () => {
    window.matchMedia = ((query: string) => ({ ...original(query), matches: query === '(min-width: 1024px)' })) as typeof window.matchMedia;
    const { bar } = page();
    const toggle = within(bar).getByRole('button', { name: 'Apri il menu' });
    fireEvent.click(toggle);
    const taken = !fireEvent.keyDown(toggle, { key: 'Escape' });
    expect(taken).toBe(false);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('leaves an Esc to a sheet or an overlay over the drawer', () => {
    const { bar } = page();
    fireEvent.click(within(bar).getByRole('button', { name: 'Apri il menu' }));
    const sheet = document.createElement('div');
    sheet.setAttribute('data-find-overlay', '');
    document.body.appendChild(sheet);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    sheet.remove();
    expect(within(bar).getByRole('button', { name: 'Chiudi il menu' })).toHaveAttribute('aria-expanded', 'true');
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

/** A fake IntersectionObserver: the test says when the title is in sight. */
class FakeIntersectionObserver {
  static last: FakeIntersectionObserver | null = null;
  target: Element | null = null;
  private readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIntersectionObserver.last = this;
  }
  observe(target: Element) {
    this.target = target;
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
  say(isIntersecting: boolean) {
    act(() => this.callback([{ isIntersecting, target: this.target } as IntersectionObserverEntry], this as unknown as IntersectionObserver));
  }
}

describe('Layout — the phone bar\'s name, as iOS\'s large titles (G8)', () => {
  beforeEach(() => {
    FakeIntersectionObserver.last = null;
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function at(path: string) {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/forum" element={<h1>Dossier pubblici</h1>} />
            <Route path="/history" element={<h1>Cronologia</h1>} />
            <Route path="/documents" element={<p>Nessun titolo</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    return screen.getByTestId('phone-top-bar');
  }
  const name = (bar: HTMLElement) => bar.querySelector('p')!;

  it('shows no name while the page\'s title is in sight, and the page\'s once it has scrolled out, fading it in', () => {
    const bar = at('/forum');
    const observer = FakeIntersectionObserver.last!;
    // The page's own title, watched in the content scroller, under the bar.
    expect(observer.target).toHaveTextContent('Dossier pubblici');
    expect(observer.target?.tagName).toBe('H1');
    // Only the menu and the magnifier: no «Forum» over «Forum · il luogo…», no name under the large title.
    expect(name(bar)).toHaveTextContent(/^$/);
    expect(name(bar)).toHaveAttribute('aria-hidden', 'true');
    expect(within(bar).getAllByRole('button')).toHaveLength(2);

    observer.say(false);
    expect(name(bar)).toHaveTextContent(/^Dossier pubblici$/);
    expect(name(bar)).not.toHaveAttribute('aria-hidden');
    // A fade of 150 ms, only where motion is welcome: at once under reduced motion.
    expect(name(bar)).toHaveClass('motion-safe:animate-in', 'motion-safe:fade-in', 'motion-safe:duration-150');
    expect(name(bar).className).not.toMatch(/(^|\s)(animate-in|fade-in)(\s|$)/);

    observer.say(true);
    expect(name(bar)).toHaveTextContent(/^$/);
  });

  it('does the same on a Corpus page: the name comes with the scroll', () => {
    const bar = at('/history');
    expect(name(bar)).toHaveTextContent(/^$/);
    FakeIntersectionObserver.last!.say(false);
    expect(name(bar)).toHaveTextContent(/^Cronologia$/);
  });

  it('names at once a page with no title of its own', () => {
    const bar = at('/documents');
    expect(name(bar)).toHaveTextContent(/^Analizza documento$/);
  });
});
