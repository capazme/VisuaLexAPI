import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'tester' }, isAdmin: false, logout: vi.fn() }),
}));
vi.mock('../../hooks/useForumNotifications', () => ({
  useForumNotifications: () => ({ count: { total: 3 }, markRead: vi.fn(), refetch: vi.fn() }),
}));

import { Sidebar } from './Sidebar';
import { appStore } from '../../store/useAppStore';

/**
 * Every control in the sidebar is an icon. `label` reached the eye only: the
 * tooltip that carried it is `hidden md:block` and appears on hover, so it
 * never named the control for a screen reader or a keyboard user, and the
 * whole primary navigation announced as unnamed links and buttons.
 */
function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function renderSidebar(initialPath = '/') {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Where />
      <Sidebar
        theme="light"
        toggleTheme={vi.fn()}
        isOpen
        closeMobile={vi.fn()}
        openSettings={vi.fn()}
        openKeyboardShortcuts={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe('Sidebar — accessible names', () => {
  it('names every link', () => {
    renderSidebar();
    for (const name of [/Ricerca/, /Dossier/, /Ambienti/, /Cronologia/]) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
  });

  it('offers «Sentenze» as a button that opens the palette, not as a page link', () => {
    renderSidebar();
    expect(screen.queryByRole('link', { name: /Sentenze/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Sentenze/ })).toBeInTheDocument();
  });

  it('opens the palette and goes to the search page when «Sentenze» is pressed', () => {
    appStore.setState({ commandPaletteOpen: false });
    renderSidebar('/dossier');
    expect(screen.getByTestId('where')).toHaveTextContent('/dossier');
    fireEvent.click(screen.getByRole('button', { name: /Sentenze/ }));
    expect(appStore.getState().commandPaletteOpen).toBe(true);
    expect(screen.getByTestId('where').textContent).toBe('/');
    appStore.setState({ commandPaletteOpen: false });
  });

  it('folds the notification count into the link name', () => {
    renderSidebar();
    // A badge announced on its own says "3" without saying 3 of what.
    expect(screen.getByRole('link', { name: /Forum, 3 notifiche/ })).toBeInTheDocument();
  });

  it('names every button, including the user menu', () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: /Impostazioni/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Scorciatoie/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tema/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Menu utente/ })).toBeInTheDocument();
  });

  it('leaves nothing unnamed', () => {
    renderSidebar();
    // The sweep is the actual lock: a control added later without a name fails
    // here even if nobody remembers to add a case above.
    for (const el of [...screen.getAllByRole('link'), ...screen.getAllByRole('button')]) {
      expect(el).toHaveAccessibleName();
    }
  });

  it('says whether the user menu is open', () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: /Menu utente/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});

describe('Sidebar — MERL-T graph entry (Slice 4 Decision A)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('links to /grafo when both MERL-T flags are on (default)', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: /Grafo/ })).toHaveAttribute('href', '/grafo');
  });

  it('hides the entry when VITE_FEATURE_MERLT_GRAPH is off', () => {
    vi.stubEnv('VITE_FEATURE_MERLT_GRAPH', 'false');
    renderSidebar();
    expect(screen.queryByRole('link', { name: /Grafo/ })).not.toBeInTheDocument();
  });

  it('hides the entry when MERL-T itself is off', () => {
    vi.stubEnv('VITE_FEATURE_MERLT', 'false');
    renderSidebar();
    expect(screen.queryByRole('link', { name: /Grafo/ })).not.toBeInTheDocument();
  });
});

describe('Sidebar — Studia entry', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('links to /studia by default, after Dossier', () => {
    renderSidebar();
    const links = screen.getAllByRole('link');
    const studia = screen.getByRole('link', { name: /Studia/ });
    expect(studia).toHaveAttribute('href', '/studia');
    expect(links.indexOf(studia)).toBe(links.indexOf(screen.getByRole('link', { name: /Dossier/ })) + 1);
  });

  it('hides the entry when VITE_FEATURE_STUDIA is off', () => {
    vi.stubEnv('VITE_FEATURE_STUDIA', 'false');
    renderSidebar();
    expect(screen.queryByRole('link', { name: /Studia/ })).not.toBeInTheDocument();
  });
});

/** jsdom has no `PointerEvent`: React's enter/leave come from `pointerover`/`pointerout`, given the pointer's kind. */
const MOUSE = 'mouse';
const TOUCH = 'touch';
function pointerOver(el: Element, kind: string) {
  const event = new MouseEvent('pointerover', { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: kind });
  fireEvent(el, event);
}
function pointerOut(el: Element, kind: string) {
  const event = new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body });
  Object.defineProperty(event, 'pointerType', { value: kind });
  fireEvent(el, event);
}
const label = () => document.body.querySelector('[data-sidebar-tooltip]');

// 16 icons are 935 px tall: in a 706 px window the sidebar made the document scroll. The navigation is
// the part that scrolls, and because that overflow would clip a label hanging out of it, the labels are
// portalled to the body (gotcha 22). The geometry itself is for the browser pass.
describe('Sidebar — it fits a low window', () => {
  it('is never taller than its row on the desktop, and only the navigation scrolls', () => {
    renderSidebar();
    const aside = screen.getByRole('complementary');
    expect(aside).toHaveClass('lg:h-full');
    const nav = document.getElementById('tour-sidebar') as HTMLElement;
    expect(nav).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto');
    // A thin scrollbar, not a hidden one: a very low window shows there is more.
    expect(nav).toHaveClass('[scrollbar-width:thin]');
    expect(nav).not.toHaveClass('[scrollbar-width:none]');
    // The logo, the quick search, the system actions and the user menu keep their own height.
    expect(aside).not.toHaveClass('overflow-y-auto');
    expect(aside.querySelector('nav ~ div')).not.toHaveClass('overflow-y-auto');
  });

  it('draws a hover label outside the scrolling navigation and the aside, and removes it on leave', async () => {
    renderSidebar();
    const link = screen.getByRole('link', { name: 'Dossier' });
    pointerOver(link, MOUSE);
    const tooltip = document.body.querySelector('[data-sidebar-tooltip]') as HTMLElement;
    expect(tooltip).toHaveTextContent('Dossier');
    expect(document.getElementById('tour-sidebar')).not.toContainElement(tooltip);
    expect(screen.getByRole('complementary')).not.toContainElement(tooltip);
    expect(tooltip).toHaveClass('fixed', 'z-[1400]');
    pointerOut(link, MOUSE);
    await waitFor(() => expect(document.body.querySelector('[data-sidebar-tooltip]')).toBeNull());
  });

  it('does the same for a button of the bottom group', () => {
    renderSidebar();
    pointerOver(screen.getByRole('button', { name: 'Impostazioni' }), MOUSE);
    const tooltip = document.body.querySelector('[data-sidebar-tooltip]') as HTMLElement;
    expect(tooltip).toHaveTextContent('Impostazioni');
    expect(screen.getByRole('complementary')).not.toContainElement(tooltip);
  });
});

// A label that stays on screen after a tap, or over a dialog opened by the click, is worse than none.
describe.each([
  ['a link', () => screen.getByRole('link', { name: 'Dossier' })],
  ['a button', () => screen.getByRole('button', { name: 'Impostazioni' })],
])('Sidebar — when the label of %s shows', (_name, control) => {
  it('for a mouse pointer over it, not for a touch', () => {
    renderSidebar();
    pointerOver(control(), TOUCH);
    expect(label()).toBeNull();
    pointerOver(control(), MOUSE);
    expect(label()).not.toBeNull();
  });

  it('and not after a click, which has done its work', () => {
    renderSidebar();
    pointerOver(control(), MOUSE);
    expect(label()).not.toBeNull();
    fireEvent.click(control());
    return waitFor(() => expect(label()).toBeNull());
  });

  it('on keyboard focus (`:focus-visible` only), taken away by Esc and by blur', async () => {
    renderSidebar();
    // Only `:focus-visible` is answered; every other selector goes to the real `matches` (Testing Library's queries use it).
    const realMatches = Element.prototype.matches;
    let focusVisible = true;
    const matches = vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
      return selector === ':focus-visible' ? focusVisible : realMatches.call(this, selector);
    });
    fireEvent.focus(control());
    expect(label()).not.toBeNull();
    fireEvent.keyDown(control(), { key: 'Escape' });
    await waitFor(() => expect(label()).toBeNull());
    fireEvent.focus(control());
    expect(label()).not.toBeNull();
    fireEvent.blur(control());
    await waitFor(() => expect(label()).toBeNull());
    // A click focuses too, but not visibly.
    focusVisible = false;
    fireEvent.focus(control());
    expect(label()).toBeNull();
    matches.mockRestore();
  });

  it('and goes with a scroll of the navigation, or a resize of the window', async () => {
    renderSidebar();
    pointerOver(control(), MOUSE);
    fireEvent.scroll(document.getElementById('tour-sidebar') as HTMLElement);
    await waitFor(() => expect(label()).toBeNull());
    pointerOver(control(), MOUSE);
    expect(label()).not.toBeNull();
    fireEvent(window, new Event('resize'));
    await waitFor(() => expect(label()).toBeNull());
  });
});
