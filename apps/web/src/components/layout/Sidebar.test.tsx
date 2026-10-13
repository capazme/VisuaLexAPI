import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const account = vi.hoisted(() => ({ isAdmin: false, devMode: false }));
const notices = vi.hoisted(() => ({ normaChanges: 0 }));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'tester' }, isAdmin: account.isAdmin, devMode: account.devMode, logout: vi.fn() }),
}));
vi.mock('../../hooks/useForumNotifications', () => ({
  useForumNotifications: () => ({ count: { total: 3, normaChanges: notices.normaChanges }, markRead: vi.fn(), refetch: vi.fn() }),
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

const handlers = { toggleTheme: vi.fn(), closeMobile: vi.fn(), openSettings: vi.fn(), openKeyboardShortcuts: vi.fn() };

function renderSidebar(initialPath = '/', props: { theme?: string; isOpen?: boolean } = {}) {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Where />
      <Sidebar theme={props.theme ?? 'light'} isOpen={props.isOpen ?? true} {...handlers} />
    </MemoryRouter>,
  );
}

const openUserMenu = () => fireEvent.click(screen.getByRole('button', { name: /Menu utente/ }));

beforeEach(() => {
  account.isAdmin = false;
  account.devMode = false;
  notices.normaChanges = 0;
  Object.values(handlers).forEach((fn) => fn.mockClear());
});

describe('Sidebar — accessible names', () => {
  it('names every link', () => {
    renderSidebar();
    for (const name of [/Ricerca/, /Dossier/, /Ambienti/, /Forum/]) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
  });

  it('has no «Ricerca Veloce» and no «Sentenze»: «Ricerca» and ⌘K open the palette', () => {
    renderSidebar();
    expect(screen.queryByRole('button', { name: /Ricerca Veloce/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Ricerca Veloce/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Sentenze/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Sentenze/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Ricerca' })).toHaveAttribute('href', '/');
  });

  it('keeps the quick norms dot, now under «Ricerca»', () => {
    appStore.setState({ quickNorms: [{ id: 'q1' } as never] });
    renderSidebar();
    const dot = screen.getByTitle('1 preferiti');
    const search = screen.getByRole('link', { name: 'Ricerca' });
    expect(search.compareDocumentPosition(dot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.getElementById('tour-sidebar')).toContainElement(dot);
    appStore.setState({ quickNorms: [] });
  });

  it('gives «Ricerca» the id the tours point at', () => {
    renderSidebar();
    expect(document.getElementById('tour-nav-search')).toBe(screen.getByRole('link', { name: 'Ricerca' }));
    expect(document.getElementById('tour-quick-search')).toBeNull();
  });

  it('folds the notification count into the link name', () => {
    renderSidebar();
    // A badge announced on its own says "3" without saying 3 of what.
    expect(screen.getByRole('link', { name: /Forum, 3 notifiche/ })).toBeInTheDocument();
  });

  it('has the user menu as its only button, with no system buttons beside it', () => {
    renderSidebar();
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Menu utente']);
  });

  it('leaves nothing unnamed', () => {
    renderSidebar();
    // The sweep is the actual lock: a control added later without a name fails
    // here even if nobody remembers to add a case above.
    for (const el of [...screen.getAllByRole('link'), ...screen.getAllByRole('button')]) {
      expect(el).toHaveAccessibleName();
    }
  });

  it('names every entry of the open user menu', () => {
    renderSidebar();
    openUserMenu();
    const entries = screen.getAllByRole('menuitem');
    expect(entries.map((e) => e.textContent?.trim())).toEqual(['Impostazioni', 'Cronologia', "Collega un'app AI", 'Tema scuro', 'Scorciatoie (?)', 'Esci']);
    for (const entry of entries) expect(entry).toHaveAccessibleName();
  });

  it('says whether the user menu is open', () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: /Menu utente/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});

describe('Sidebar — the development mode (spec D1–D3)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shows neither «Assistente» nor «Grafo» nor the «Sviluppo» group without the mode', () => {
    renderSidebar();
    expect(screen.queryByRole('link', { name: /Grafo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Assistente/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Sviluppo')).not.toBeInTheDocument();
  });

  it('shows both under a quiet «Sviluppo» separator, after the others, with the mode', () => {
    account.devMode = true;
    renderSidebar();
    const group = screen.getByRole('group', { name: 'Sviluppo' });
    expect(within(group).getByRole('link', { name: 'Assistente' })).toHaveAttribute('href', '/merlt');
    expect(within(group).getByRole('link', { name: 'Grafo' })).toHaveAttribute('href', '/grafo');
    expect(within(group).getAllByRole('link')).toHaveLength(2);
    const links = screen.getAllByRole('link');
    expect(links.indexOf(screen.getByRole('link', { name: /Analizza documento/ }))).toBeLessThan(links.indexOf(within(group).getByRole('link', { name: 'Assistente' })));
    expect(links.at(-1)).toBe(within(group).getByRole('link', { name: 'Grafo' }));
  });

  it('adds nothing for the mode when VITE_FEATURE_MERLT_GRAPH is off: only «Assistente»', () => {
    account.devMode = true;
    vi.stubEnv('VITE_FEATURE_MERLT_GRAPH', 'false');
    renderSidebar();
    expect(screen.queryByRole('link', { name: /Grafo/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Assistente' })).toBeInTheDocument();
  });

  it('never grants: with MERL-T itself off the mode shows no entry and no separator', () => {
    account.devMode = true;
    vi.stubEnv('VITE_FEATURE_MERLT', 'false');
    renderSidebar();
    expect(screen.queryByRole('link', { name: /Grafo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Assistente/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Sviluppo')).not.toBeInTheDocument();
  });
});

describe('Sidebar — Cronologia in the user menu (the owner, 13 Oct 2026)', () => {
  it('is not in the navigation: it is an entry of the user menu, after Impostazioni, that opens the history', () => {
    renderSidebar('/dossier');
    expect(screen.queryByRole('link', { name: /Cronologia/ })).toBeNull();
    openUserMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cronologia' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/history');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('counts the saved norms that changed on the avatar and beside the entry, in words for a screen reader', () => {
    notices.normaChanges = 2;
    renderSidebar();
    const avatar = screen.getByRole('button', { name: 'Menu utente, 2 norme salvate cambiate' });
    expect(within(avatar).getByText('2')).toBeInTheDocument();
    openUserMenu();
    const entry = screen.getByRole('menuitem', { name: 'Cronologia, 2 norme salvate cambiate' });
    expect(within(entry).getByText('2')).toBeInTheDocument();
  });

  it('says one norm in the singular', () => {
    notices.normaChanges = 1;
    renderSidebar();
    expect(screen.getByRole('button', { name: 'Menu utente, 1 norma salvata cambiata' })).toBeInTheDocument();
  });

  it('draws no count when nothing changed', () => {
    renderSidebar();
    const avatar = screen.getByRole('button', { name: 'Menu utente' });
    expect(avatar.textContent?.trim()).toBe('T');
    openUserMenu();
    expect(screen.getByRole('menuitem', { name: 'Cronologia' }).textContent?.trim()).toBe('Cronologia');
  });
});

describe('Sidebar — the user menu (spec D2)', () => {
  it("holds Impostazioni, Cronologia, «Collega un'app AI», the theme, Scorciatoie and Esci; «Pannello Admin» only for an admin", () => {
    renderSidebar();
    openUserMenu();
    expect(screen.getByRole('menu', { name: 'Menu utente' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem').map((e) => e.textContent?.trim())).toEqual(['Impostazioni', 'Cronologia', "Collega un'app AI", 'Tema scuro', 'Scorciatoie (?)', 'Esci']);
    expect(screen.queryByRole('menuitem', { name: /Pannello Admin/ })).toBeNull();
  });

  it('shows «Pannello Admin» to an admin, before Esci', () => {
    account.isAdmin = true;
    renderSidebar();
    openUserMenu();
    const admin = screen.getByRole('menuitem', { name: /Pannello Admin/ });
    expect(admin.compareDocumentPosition(screen.getByRole('menuitem', { name: /Esci/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('names the theme it would switch to', () => {
    renderSidebar('/', { theme: 'dark' });
    openUserMenu();
    expect(screen.getByRole('menuitem', { name: /Tema chiaro/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Tema scuro/ })).toBeNull();
  });

  it('opens Impostazioni and closes the menu (and the phone\'s menu)', () => {
    renderSidebar();
    openUserMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Impostazioni/ }));
    expect(handlers.openSettings).toHaveBeenCalledTimes(1);
    expect(handlers.closeMobile).toHaveBeenCalled();
    expect(screen.queryByRole('menuitem', { name: /Impostazioni/ })).toBeNull();
  });

  it("opens «Collega un'app AI» and closes the menu (and the phone's menu)", () => {
    renderSidebar();
    openUserMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Collega un'app AI/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/collega-app');
    expect(handlers.closeMobile).toHaveBeenCalled();
    expect(screen.queryByRole('menu', { name: 'Menu utente' })).toBeNull();
  });

  it('opens the shortcuts', () => {
    renderSidebar();
    openUserMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Scorciatoie/ }));
    expect(handlers.openKeyboardShortcuts).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menuitem', { name: /Scorciatoie/ })).toBeNull();
  });

  it('switches the theme', () => {
    renderSidebar();
    openUserMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Tema scuro/ }));
    expect(handlers.toggleTheme).toHaveBeenCalledTimes(1);
  });
});

describe('Sidebar — the user menu by keyboard', () => {
  const trigger = () => screen.getByRole('button', { name: /Menu utente/ });

  it('opens with ArrowDown on the first entry, and Enter on «Impostazioni» opens the settings', () => {
    renderSidebar();
    trigger().focus();
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: /Impostazioni/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: /Cronologia/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' });
    expect(screen.getByRole('menuitem', { name: /Impostazioni/ })).toHaveFocus();
    // Enter on a focused button is its click.
    fireEvent.click(document.activeElement as HTMLElement);
    expect(handlers.openSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('opens on the last entry with ArrowUp, and the arrows wrap, Home and End jump', () => {
    renderSidebar();
    trigger().focus();
    fireEvent.keyDown(trigger(), { key: 'ArrowUp' });
    expect(screen.getByRole('menuitem', { name: /Esci/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: /Impostazioni/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' });
    expect(screen.getByRole('menuitem', { name: /Esci/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Home' });
    expect(screen.getByRole('menuitem', { name: /Impostazioni/ })).toHaveFocus();
  });

  it('puts focus on the first entry when the button is clicked open', () => {
    renderSidebar();
    openUserMenu();
    expect(screen.getByRole('menuitem', { name: /Impostazioni/ })).toHaveFocus();
  });

  it('closes with Esc and gives focus back to the avatar', () => {
    renderSidebar();
    openUserMenu();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger()).toHaveFocus();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes with Tab, from the avatar on', () => {
    renderSidebar();
    openUserMenu();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('keeps its entries out of the tab order (the arrows move) and 44 px high on a phone', () => {
    renderSidebar();
    openUserMenu();
    for (const entry of screen.getAllByRole('menuitem')) {
      expect(entry).toHaveAttribute('tabindex', '-1');
      expect(entry).toHaveClass('min-h-[44px]', 'md:min-h-0');
    }
  });
});

describe('Sidebar — the phone\'s copy (spec D8)', () => {
  it('is the same reduced list and the same menu, closed off-canvas or open', () => {
    renderSidebar('/', { isOpen: false });
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(
      ['/', '/dossier', '/studia', '/environments', '/forum', '/documents'],
    );
    expect(screen.queryByRole('link', { name: /Grafo|Assistente/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Sentenze|Ricerca Veloce|Impostazioni/ })).toBeNull();
    openUserMenu();
    expect(screen.getByRole('menuitem', { name: /Impostazioni/ })).toBeInTheDocument();
  });

  it('follows the mode like the desktop one', () => {
    account.devMode = true;
    renderSidebar('/', { isOpen: false });
    expect(screen.getByRole('link', { name: 'Grafo' })).toBeInTheDocument();
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
    // The logo and the user menu keep their own height.
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
});

// A label that stays on screen after a tap, or over a dialog opened by the click, is worse than none.
describe.each([
  ['a link', () => screen.getByRole('link', { name: 'Dossier' })],
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
