import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const account = vi.hoisted(() => ({ isAdmin: false, devMode: false, isValidator: false }));
const notices = vi.hoisted(() => ({ normaChanges: 0 }));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'tester' }, isAdmin: account.isAdmin, devMode: account.devMode, isValidator: account.isValidator, logout: vi.fn() }),
}));
vi.mock('../../hooks/useForumNotifications', () => ({
  useForumNotifications: () => ({ count: { total: 3, normaChanges: notices.normaChanges }, markRead: vi.fn(), refetch: vi.fn() }),
}));

import { Sidebar, SIDEBAR_SMALL_TEXT, SIDEBAR_TOGGLE_TEXT } from './Sidebar';
import { appStore } from '../../store/useAppStore';
import { subscribeSearchField } from '../../utils/searchFieldControl';
import { sectionStore } from '../../features/sections/useSection';

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

function cleanupAndRender(path: string, before: () => void) {
  cleanup();
  before();
  renderSidebar(path);
}

const openUserMenu = () => fireEvent.click(screen.getByRole('button', { name: /Menu utente/ }));

beforeEach(() => {
  account.isAdmin = false;
  account.devMode = false;
  account.isValidator = false;
  sectionStore.setState({ section: 'opus' });
  notices.normaChanges = 0;
  Object.values(handlers).forEach((fn) => fn.mockClear());
});

describe('Sidebar — accessible names', () => {
  it('names every link', () => {
    renderSidebar();
    for (const name of [/Ricerca/, /Dossier/, /Analizza documento/]) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    // «Ambienti» went into the Forum (spec 2026-10-13-environments-into-forum, D13).
    expect(screen.queryByRole('link', { name: /Ambienti/ })).toBeNull();
  });

  it('has no «Ricerca Veloce» and no «Sentenze»: «Ricerca» leads to the field, ⌘K opens the palette', () => {
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

  it('«Ricerca» goes to the search page with the cursor in its field, no window over it (the owner, D1)', () => {
    const field = vi.fn();
    const unsubscribe = subscribeSearchField(field);
    renderSidebar('/dossier');
    fireEvent.click(screen.getByRole('link', { name: 'Ricerca' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
    expect(field).toHaveBeenCalledWith({});
    expect(appStore.getState().commandPaletteOpen).toBe(false);
    unsubscribe();
  });

  it('gives «Ricerca» the id the tours point at', () => {
    renderSidebar();
    expect(document.getElementById('tour-nav-search')).toBe(screen.getByRole('link', { name: 'Ricerca' }));
    expect(document.getElementById('tour-quick-search')).toBeNull();
  });

  it('folds the notification count into the link name', () => {
    renderSidebar('/forum');
    // A badge announced on its own says "3" without saying 3 of what.
    expect(screen.getByRole('link', { name: /Forum, 3 notifiche/ })).toBeInTheDocument();
  });

  it('has the section switcher and the user menu as its only buttons, with no system buttons beside them', () => {
    renderSidebar();
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Sezione: Opus, cambia sezione, nuove attività nel Forum',
      'Menu utente',
    ]);
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

const hrefs = () => screen.getAllByRole('link').map((a) => a.getAttribute('href'));

describe('Sidebar — the entries of each section (sections spec S6)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('starts every section with the Corpus entries, «Ricerca» and «Analizza documento»', () => {
    for (const path of ['/', '/studia/ripasso', '/forum']) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[path]}>
          <Sidebar theme="light" isOpen {...handlers} />
        </MemoryRouter>,
      );
      expect(hrefs().slice(0, 2)).toEqual(['/', '/documents']);
      unmount();
    }
  });

  it('Opus: the dossiers', () => {
    renderSidebar('/');
    expect(hrefs()).toEqual(['/', '/documents', '/dossier']);
    expect(screen.getByRole('group', { name: 'Opus' })).toContainElement(screen.getByRole('link', { name: 'Dossier' }));
  });

  it('Gymnasium: «Studia» holds Oggi and the dossiers, «Contribuisci» Le mie schede and, for a validator only, «Da validare» (Gymnasium spec §4)', () => {
    renderSidebar('/studia/schede');
    expect(hrefs()).toEqual(['/', '/documents', '/studia/ripasso', '/dossier', '/studia/schede']);
    expect(screen.getByRole('link', { name: 'Le mie schede' })).toHaveAttribute('aria-current', 'page');
    const study = screen.getByRole('group', { name: 'Studia' });
    expect(within(study).getAllByRole('link').map((a) => a.getAttribute('aria-label'))).toEqual(['Oggi', 'Dossier']);
    expect(screen.getByRole('group', { name: 'Gymnasium' })).toContainElement(study);
    cleanupAndRender('/studia/schede', () => { account.isValidator = true; });
    expect(hrefs()).toEqual(['/', '/documents', '/studia/ripasso', '/dossier', '/studia/schede', '/studia/valida']);
    const contribute = screen.getByRole('group', { name: 'Contribuisci' });
    expect(within(contribute).getAllByRole('link').map((a) => a.getAttribute('aria-label'))).toEqual(['Le mie schede', 'Da validare']);
    // The tours still find the dossiers.
    expect(document.getElementById('tour-nav-dossier')).toBe(screen.getByRole('link', { name: 'Dossier' }));
  });

  it('keeps the section on a Corpus page after it', () => {
    sectionStore.setState({ section: 'gymnasium' });
    renderSidebar('/dossier');
    expect(screen.getByRole('group', { name: 'Gymnasium' })).toBeInTheDocument();
  });

  it('Forum: the Forum, with its count', () => {
    renderSidebar('/forum');
    expect(hrefs()).toEqual(['/', '/documents', '/forum']);
  });

  it('Academia: «Assistente» and «Grafo», with the development mode only (S12)', () => {
    account.devMode = true;
    renderSidebar('/merlt');
    expect(hrefs()).toEqual(['/', '/documents', '/merlt', '/grafo']);
    // Without the mode the section is not offered: a stored Academia falls back to Opus.
    cleanupAndRender('/', () => { account.devMode = false; sectionStore.setState({ section: 'academia' }); });
    expect(hrefs()).toEqual(['/', '/documents', '/dossier']);
    expect(screen.queryByRole('link', { name: /Grafo|Assistente/ })).toBeNull();
  });

  it('Academia follows the MERL-T flags: only «Assistente» with the graph off, nothing with MERL-T off', () => {
    account.devMode = true;
    vi.stubEnv('VITE_FEATURE_MERLT_GRAPH', 'false');
    renderSidebar('/merlt');
    expect(hrefs()).toEqual(['/', '/documents', '/merlt']);
    cleanupAndRender('/merlt', () => vi.stubEnv('VITE_FEATURE_MERLT', 'false'));
    expect(hrefs()).toEqual(['/', '/documents']);
  });

  it('offers no Gymnasium when VITE_FEATURE_STUDIA is off', () => {
    vi.stubEnv('VITE_FEATURE_STUDIA', 'false');
    sectionStore.setState({ section: 'gymnasium' });
    renderSidebar('/');
    expect(hrefs()).toEqual(['/', '/documents', '/dossier']);
  });

  it("is the same list in the phone's copy, closed off-canvas or open (spec D8)", () => {
    renderSidebar('/', { isOpen: false });
    expect(hrefs()).toEqual(['/', '/documents', '/dossier']);
    openUserMenu();
    expect(screen.getByRole('menuitem', { name: /Impostazioni/ })).toBeInTheDocument();
  });

  it("closes the phone's menu when a section is chosen", () => {
    renderSidebar('/');
    fireEvent.click(screen.getByRole('button', { name: /^Sezione:/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Forum/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/forum');
    expect(handlers.closeMobile).toHaveBeenCalled();
    expect(hrefs()).toEqual(['/', '/documents', '/forum']);
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

// The rail showed icons alone; the owners asked for words (Gymnasium spec §4): from `xl` a bar with icon
// and word, on a phone a drawer of 44 px rows. The rail stays between `lg` and `xl`.
describe('Sidebar — the words', () => {
  function renderLayout(layout: 'rail' | 'wide' | 'drawer', path = '/', onToggleWide?: () => void) {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Sidebar theme="light" isOpen layout={layout} onToggleWide={onToggleWide} {...handlers} />
      </MemoryRouter>,
    );
  }

  it.each(['wide', 'drawer'] as const)('writes each entry beside its icon (%s), with the same names and ids', (layout) => {
    renderLayout(layout, '/forum');
    for (const name of ['Ricerca', 'Analizza documento']) {
      expect(screen.getByRole('link', { name })).toHaveTextContent(name);
    }
    expect(document.getElementById('tour-nav-search')).toBe(screen.getByRole('link', { name: 'Ricerca' }));
    // The count rides the name and sits at the end of the row.
    const forum = screen.getByRole('link', { name: 'Forum, 3 notifiche' });
    expect(forum).toHaveTextContent(/^Forum3$/);
    // The section is named beside its mark; the button keeps its name.
    expect(screen.getByRole('button', { name: /^Sezione: Forum/ })).toHaveTextContent('Forum');
    // The username is shown, so the name carries it (label in name).
    expect(screen.getByRole('button', { name: 'Menu utente di tester' })).toHaveTextContent('tester');
  });

  it('writes the group headings: the section, or Gymnasium\'s «Studia» and «Contribuisci»', () => {
    renderLayout('wide', '/dossier');
    expect(within(screen.getByRole('group', { name: 'Opus' })).getByText('Opus')).toBeInTheDocument();
    cleanup();
    renderLayout('wide', '/studia/ripasso');
    expect(within(screen.getByRole('group', { name: 'Studia' })).getByText('Studia')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Contribuisci' })).getByText('Contribuisci')).toBeInTheDocument();
    cleanup();
    // The rail has no room for them.
    renderLayout('rail', '/studia/ripasso');
    expect(screen.queryByText('Studia')).toBeNull();
    expect(screen.getByRole('link', { name: 'Oggi' }).textContent).toBe('');
  });

  it('draws its 11 px texts, the headings and the shortcut, in the colour that keeps AA (theme.test.ts)', () => {
    renderLayout('wide', '/studia/ripasso');
    expect(within(screen.getByRole('group', { name: 'Studia' })).getByText('Studia')).toHaveClass(...SIDEBAR_SMALL_TEXT.split(' '));
    const shortcut = screen.getByRole('link', { name: 'Ricerca' }).querySelector('kbd') as HTMLElement;
    expect(shortcut).toHaveClass('text-[11px]', ...SIDEBAR_SMALL_TEXT.split(' '));
  });

  it('shows no hover label where the word is written', () => {
    renderLayout('wide');
    pointerOver(screen.getByRole('link', { name: 'Dossier' }), MOUSE);
    expect(label()).toBeNull();
  });

  it('shows the palette\'s shortcut beside «Ricerca» on the desktop, as the keyboard writes it, not in the phone\'s drawer', () => {
    renderLayout('wide');
    // Read once when the module loads, from `navigator.platform`: «⌘K» on a Mac, «Ctrl K» elsewhere.
    expect(screen.getByRole('link', { name: 'Ricerca' })).toHaveTextContent(/^Ricerca(⌘K|Ctrl K)$/);
    cleanup();
    renderLayout('drawer');
    expect(screen.getByRole('link', { name: 'Ricerca' })).toHaveTextContent(/^Ricerca$/);
  });

  it('gives the drawer rows of 44 px and a foot clear of the home indicator', () => {
    renderLayout('drawer');
    for (const link of screen.getAllByRole('link')) expect(link).toHaveClass('h-11', 'w-full');
    expect(screen.getByRole('complementary')).toHaveClass('w-[17rem]');
    expect(screen.getByRole('button', { name: 'Menu utente di tester' }).parentElement).toHaveClass('pb-[max(1rem,env(safe-area-inset-bottom))]');
  });

  it('opens the user menu over the wide button, not beside it', () => {
    renderLayout('drawer');
    const button = screen.getByRole('button', { name: 'Menu utente di tester' });
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ top: 700, bottom: 744, left: 10, right: 262 } as DOMRect);
    openUserMenu();
    const menu = screen.getByRole('menu', { name: 'Menu utente' });
    expect(menu.style.left).toBe('10px');
    expect(menu.style.bottom).toBe(`${window.innerHeight - 700 + 8}px`);
  });

  it('offers the toggle that narrows or widens the bar only when the layout gives one, never in the drawer', () => {
    const toggle = vi.fn();
    renderLayout('wide', '/', toggle);
    // In the entries' words' colour, never fainter (theme.test.ts measures it).
    expect(screen.getByRole('button', { name: 'Riduci la barra laterale' })).toHaveClass(...SIDEBAR_TOGGLE_TEXT.split(' '));
    fireEvent.click(screen.getByRole('button', { name: 'Riduci la barra laterale' }));
    expect(toggle).toHaveBeenCalledTimes(1);
    cleanup();
    renderLayout('rail', '/', toggle);
    const widen = screen.getByRole('button', { name: 'Allarga la barra laterale' });
    // In the rail it is an icon, labelled on hover as the entries are.
    pointerOver(widen, MOUSE);
    expect(label()).toHaveTextContent('Allarga la barra laterale');
    cleanup();
    renderLayout('drawer', '/', toggle);
    expect(screen.queryByRole('button', { name: /la barra laterale/ })).toBeNull();
  });
});
