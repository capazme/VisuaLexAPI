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
import { plannerStore } from '../features/planner/plannerStore';

/** Work's six entries (D-315, LC47): Scadenziario, Ricerca, Dossier, Atti, then the two features with an AI model behind them,
 *  «Analizza documento» and the Pseudonimizzatore. The planner's other two views are tabs of Work's page. */
const OPUS_HREFS = ['/work/scadenziario', '/', '/dossier', '/work/atti', '/documents', '/work/pseudonimizzatore', '/work/grafo-pratiche'];
import type { ServiceHealthState } from '../../services/healthService';

/** `Layout`'s one probe of the services, handed to the sidebar (S1). */
const serviceHealth = {
  snapshot: {
    overall: 'online' as ServiceHealthState,
    services: [
      { name: 'Backend dati utente', state: 'online' as ServiceHealthState, latencyMs: 12 },
      { name: 'API normativa e fonti', state: 'degraded' as ServiceHealthState, latencyMs: 340 },
    ],
    checkedAt: '',
  },
  refresh: vi.fn(() => Promise.resolve()),
};

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
      <Sidebar theme={props.theme ?? 'light'} isOpen={props.isOpen ?? true} serviceHealth={serviceHealth} {...handlers} />
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
  serviceHealth.snapshot.overall = 'online';
  serviceHealth.refresh.mockClear();
  Object.values(handlers).forEach((fn) => fn.mockClear());
});

describe('Sidebar — accessible names', () => {
  it('names every link', () => {
    renderSidebar('/forum');
    for (const name of [/Ricerca/, /Dossier/, /Analizza documento/]) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    // «Ambienti» went into the Forum (spec 2026-10-13-environments-into-forum, D13).
    expect(screen.queryByRole('link', { name: /Ambienti/ })).toBeNull();
  });

  it('has no «Ricerca Veloce» and no «Sentenze»: «Ricerca» leads to the field, ⌘K opens the palette', () => {
    renderSidebar('/forum');
    expect(screen.queryByRole('button', { name: /Ricerca Veloce/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Ricerca Veloce/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Sentenze/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Sentenze/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Ricerca' })).toHaveAttribute('href', '/');
  });

  it('draws no mark for the quick norms under «Ricerca» (M1: an orange dash that said nothing)', () => {
    appStore.setState({ quickNorms: [{ id: 'q1' } as never] });
    renderSidebar();
    expect(screen.queryByTitle(/preferiti/)).toBeNull();
    appStore.setState({ quickNorms: [] });
  });

  it('«Ricerca» goes to the search page with the cursor in its field, no window over it (the owner, D1)', () => {
    const field = vi.fn();
    const unsubscribe = subscribeSearchField(field);
    renderSidebar('/forum');
    fireEvent.click(screen.getByRole('link', { name: 'Ricerca' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
    expect(field).toHaveBeenCalledWith({ focus: true });
    expect(appStore.getState().commandPaletteOpen).toBe(false);
    unsubscribe();
  });

  it('gives «Ricerca» the id the tours point at', () => {
    renderSidebar('/forum');
    expect(document.getElementById('tour-nav-search')).toBe(screen.getByRole('link', { name: 'Ricerca' }));
    expect(document.getElementById('tour-quick-search')).toBeNull();
  });

  it('folds the notification count into the link name', () => {
    renderSidebar('/forum');
    // A badge announced on its own says "3" without saying 3 of what.
    expect(screen.getByRole('link', { name: /Dossier pubblici, 3 notifiche/ })).toBeInTheDocument();
  });

  it('has the section switcher and the user menu as its only buttons, with no system buttons beside them', () => {
    renderSidebar();
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Sezione: Work, cambia sezione, nuove attività nel Forum',
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
    expect(entries.map((e) => e.textContent?.trim())).toEqual(['Impostazioni', 'Cronologia', "Collega un'app AI", 'Crediti', 'Stato dei servizi: Servizi operativi', 'Tema scuro', 'Scorciatoie', 'Esci']);
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

// The entries' addresses: the logo's link home, over them, is not an entry.
const hrefs = () => screen.getAllByRole('link').filter((a) => a.getAttribute('aria-label') !== 'LexCraft').map((a) => a.getAttribute('href'));

describe('Sidebar — the entries of each section (sections spec S6)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('starts every section but Work with the Corpus entries, «Ricerca» and «Analizza documento» (Work has its own «Ricerca»)', () => {
    for (const path of ['/learn/ripasso', '/forum']) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[path]}>
          <Sidebar theme="light" isOpen serviceHealth={serviceHealth} {...handlers} />
        </MemoryRouter>,
      );
      expect(hrefs().slice(0, 3)).toEqual(['/', '/documents', '/rassegne']);
      unmount();
    }
  });

  it('Work: exactly Scadenziario, Ricerca, Dossier, Atti, then «Analizza documento» and the Pseudonimizzatore, in this order (LC47)', () => {
    renderSidebar('/');
    expect(hrefs()).toEqual(OPUS_HREFS);
    const opus = screen.getByRole('group', { name: 'Work' });
    const names = within(opus).getAllByRole('link').map((a) => a.getAttribute('aria-label'));
    expect(names).toEqual(['Scadenziario', 'Ricerca', 'Dossier', 'Atti', 'Analizza documento, in sviluppo', 'Pseudonimizzatore, in arrivo', 'Grafo delle pratiche, in arrivo']);
    // The two apart, in a group named for a screen reader, with no heading written over them.
    const tools = within(opus).getByRole('group', { name: "Strumenti sul documento" });
    expect(within(tools).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/documents', '/work/pseudonimizzatore', '/work/grafo-pratiche']);
    expect(screen.queryByText("Strumenti sul documento")).toBeNull();
    // Work's way to the search is its own «Ricerca», once.
    expect(screen.getAllByRole('link', { name: 'Ricerca' })).toHaveLength(1);
  });

  it('Work: «Ricerca» leads to the search with the cursor in its field, and carries the id the tours point at', () => {
    const field = vi.fn();
    const unsubscribe = subscribeSearchField(field);
    renderSidebar('/dossier');
    const corpus = screen.getByRole('link', { name: 'Ricerca' });
    expect(document.getElementById('tour-nav-search')).toBe(corpus);
    expect(document.getElementById('tour-nav-dossier')).toBe(screen.getByRole('link', { name: 'Dossier' }));
    fireEvent.click(corpus);
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
    expect(field).toHaveBeenCalledWith({ focus: true });
    unsubscribe();
  });

  it.each(['wide', 'drawer'] as const)('Work: «Analizza documento» says «in sviluppo» and the Pseudonimizzatore «in arrivo» under the word (%s, LC47)', (layout) => {
    render(
      <MemoryRouter initialEntries={['/work/scadenziario']}>
        <Where />
        <Sidebar theme="light" isOpen layout={layout} serviceHealth={serviceHealth} {...handlers} />
      </MemoryRouter>,
    );
    const review = screen.getByRole('link', { name: 'Analizza documento, in sviluppo' });
    expect(review).toHaveTextContent(/^Analizzain sviluppo$/);
    expect(screen.getByRole('link', { name: 'Pseudonimizzatore, in arrivo' })).toHaveTextContent(/^Pseudonimizzain arrivo$/);
    expect(screen.getByRole('link', { name: 'Grafo delle pratiche, in arrivo' })).toHaveTextContent(/^Grafo pratichein arrivo$/);
    // «in sviluppo» is still a working entry: it leads to the page.
    fireEvent.click(review);
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/documents$/);
  });

  it('Work, in the rail: the hover label says «in sviluppo» (LC47)', () => {
    render(
      <MemoryRouter initialEntries={['/work/scadenziario']}>
        <Sidebar theme="light" isOpen layout="rail" serviceHealth={serviceHealth} {...handlers} />
      </MemoryRouter>,
    );
    pointerOver(screen.getByRole('link', { name: 'Analizza documento, in sviluppo' }), MOUSE);
    expect(document.body.querySelector('[data-sidebar-tooltip]')).toHaveTextContent(/Analizza documento.*in sviluppo/);
  });

  it('Elsewhere «Analizza documento» stays a Corpus tool, with no label (LC47)', () => {
    for (const path of ['/learn/ripasso', '/forum']) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[path]}>
          <Sidebar theme="light" isOpen layout="wide" serviceHealth={serviceHealth} {...handlers} />
        </MemoryRouter>,
      );
      expect(screen.getByRole('link', { name: 'Analizza documento' })).toHaveTextContent(/^Analizza$/);
      expect(screen.queryByText('in sviluppo')).toBeNull();
      unmount();
    }
  });

  it('Work: «Atti» is a full entry since Luca\'s decision of 15 November (no «in arrivo»), and opens its page', () => {
    render(
      <MemoryRouter initialEntries={['/work/scadenziario']}>
        <Sidebar theme="light" isOpen layout="wide" serviceHealth={serviceHealth} {...handlers} />
      </MemoryRouter>,
    );
    const acts = screen.getByRole('link', { name: 'Atti' });
    expect(acts).toHaveAttribute('href', '/work/atti');
    expect(acts).toHaveTextContent(/^Atti$/);
  });

  // LC27 (Luca, 15 Nov: «la mini colonnina … va tolta»): no sliding column in any layout; the active entry is its tile.
  it.each(['rail', 'wide'] as const)('marks the active entry with its tile alone, no column (%s)', (layout) => {
    render(
      <MemoryRouter initialEntries={['/work/scadenziario']}>
        <Sidebar theme="light" isOpen layout={layout} serviceHealth={serviceHealth} {...handlers} />
      </MemoryRouter>,
    );
    const today = screen.getByRole('link', { name: 'Scadenziario' });
    expect(today).toHaveClass('bg-primary-50');
    expect(document.getElementById('tour-sidebar')!.querySelectorAll('svg.vlx-book')).toHaveLength(0);
  });

  // LC21: with words the active row is its tile alone; the sliding column is the rail's.
  it.each(['wide', 'drawer'] as const)('draws no column with words (%s): the active row is marked by its tile', (layout) => {
    render(
      <MemoryRouter initialEntries={['/work/scadenziario']}>
        <Sidebar theme="light" isOpen layout={layout} serviceHealth={serviceHealth} {...handlers} />
      </MemoryRouter>,
    );
    const today = screen.getByRole('link', { name: 'Scadenziario' });
    expect(today).toHaveAttribute('aria-current', 'page');
    expect(today).toHaveClass('bg-primary-50');
    expect(document.getElementById('tour-sidebar')!.querySelectorAll('svg.vlx-book')).toHaveLength(0);
  });

  it('keeps «Scadenziario» lit on the planner\'s other views and the trash, «Ricerca» on the search tools, in Work', () => {
    for (const path of ['/work/prossimi', '/work/ingresso', '/work/cestino']) {
      renderSidebar(path);
      const today = screen.getByRole('link', { name: 'Scadenziario' });
      // Lit for a page of its own, not its address: «true», so a screen reader says «current page» once, on the tab (#448).
      expect(today, path).toHaveAttribute('aria-current', 'true');
      expect(today, path).toHaveClass('bg-primary-50');
      cleanup();
    }
    renderSidebar('/rassegne');
    expect(screen.getByRole('link', { name: 'Ricerca' })).toHaveAttribute('aria-current', 'true');
    cleanup();
    // «Analizza documento» has its own entry in Work (LC47): lit there, «Ricerca» not.
    renderSidebar('/documents');
    expect(screen.getByRole('link', { name: 'Ricerca' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Analizza documento, in sviluppo' })).toHaveAttribute('aria-current', 'page');
    cleanup();
    // Elsewhere nothing changes: «Ricerca» is not lit on «Analizza documento», which is.
    sectionStore.setState({ section: 'forum' });
    renderSidebar('/documents');
    expect(screen.getByRole('link', { name: 'Ricerca' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Analizza documento' })).toHaveAttribute('aria-current', 'page');
  });

  it('says «page» only on the entry\'s own address, «true» when it is lit for a page under it or of its own', () => {
    renderSidebar('/work/scadenziario');
    expect(screen.getByRole('link', { name: 'Scadenziario' })).toHaveAttribute('aria-current', 'page');
    cleanup();
    renderSidebar('/work/prossimi');
    expect(screen.getByRole('link', { name: 'Scadenziario' })).toHaveAttribute('aria-current', 'true');
    cleanup();
    sectionStore.setState({ section: 'gymnasium' });
    renderSidebar('/learn/schede/42');
    expect(screen.getByRole('link', { name: 'Le mie schede' })).toHaveAttribute('aria-current', 'true');
  });

  // Papiniano, #448 note 8: each entry was two Tab stops, the second (the icon's box, given `tabindex="0"` by
  // framer-motion's `whileTap`) with the browser's blue ring.
  it('is one Tab stop per entry, and one for the avatar: nothing focusable inside them', () => {
    for (const layout of ['wide', 'rail', 'drawer'] as const) {
      render(
        <MemoryRouter initialEntries={['/work/scadenziario']}>
          <Sidebar theme="light" isOpen layout={layout} serviceHealth={serviceHealth} {...handlers} />
        </MemoryRouter>,
      );
      const controls = [...screen.getAllByRole('link'), screen.getByRole('button', { name: /Menu utente/ })];
      for (const control of controls) {
        expect(control.querySelectorAll('[tabindex]:not([tabindex="-1"]), a, button'), control.getAttribute('aria-label') ?? '').toHaveLength(0);
      }
      cleanup();
    }
  });

  it('draws no lone rule over Work\'s entries, where the Corpus ones were', () => {
    renderSidebar('/work/scadenziario');
    expect(screen.getByRole('group', { name: 'Work' })).not.toHaveClass('border-t');
    cleanup();
    renderSidebar('/forum');
    expect(screen.getByRole('group', { name: 'Forum' })).toHaveClass('border-t');
  });

  it('writes «in arrivo» under no Work entry but the Pseudonimizzatore and the Grafo delle pratiche (LC47, LC48)', () => {
    render(
      <MemoryRouter initialEntries={['/work/scadenziario']}>
        <Sidebar theme="light" isOpen layout="wide" serviceHealth={serviceHealth} {...handlers} />
      </MemoryRouter>,
    );
    expect(within(document.getElementById('tour-sidebar')!).getAllByText('in arrivo')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Atti' })).toHaveTextContent(/^Atti$/);
  });

  it('counts the overdue and today\'s tasks beside «Scadenziario», and says it in words (row 16)', () => {
    plannerStore.setState({ todayCount: 3 });
    try {
      renderSidebar('/work/scadenziario');
      const today = screen.getByRole('link', { name: 'Scadenziario, 3 compiti per oggi o scaduti' });
      expect(today).toHaveAttribute('aria-current', 'page');
      expect(today).toHaveTextContent('3');
      cleanupAndRender('/work/scadenziario', () => plannerStore.setState({ todayCount: 0 }));
      expect(screen.getByRole('link', { name: 'Scadenziario' })).not.toHaveTextContent(/\d/);
    } finally {
      plannerStore.setState({ todayCount: null });
    }
  });

  it('Gymnasium: «Studia» holds Oggi, Progressi and the dossiers, «Contribuisci» Le mie schede and, for a validator only, «Da validare» (Gymnasium spec §4)', () => {
    renderSidebar('/learn/schede');
    expect(hrefs()).toEqual(['/', '/documents', '/rassegne', '/learn/ripasso', '/learn/progressi', '/dossier', '/learn/schede']);
    expect(screen.getByRole('link', { name: 'Le mie schede' })).toHaveAttribute('aria-current', 'page');
    // One group reads «Learn» (LC4: the section's, its first heading's entries straight inside it), «Contribuisci» within.
    const section = screen.getByRole('group', { name: 'Learn' });
    expect(within(section).getAllByRole('link').map((a) => a.getAttribute('aria-label'))).toEqual(['Oggi', 'Progressi', 'Dossier', 'Le mie schede']);
    expect(section).toContainElement(screen.getByRole('group', { name: 'Contribuisci' }));
    cleanupAndRender('/learn/schede', () => { account.isValidator = true; });
    expect(hrefs()).toEqual(['/', '/documents', '/rassegne', '/learn/ripasso', '/learn/progressi', '/dossier', '/learn/schede', '/learn/valida']);
    const contribute = screen.getByRole('group', { name: 'Contribuisci' });
    expect(within(contribute).getAllByRole('link').map((a) => a.getAttribute('aria-label'))).toEqual(['Le mie schede', 'Da validare']);
    // The tours still find the dossiers.
    expect(document.getElementById('tour-nav-dossier')).toBe(screen.getByRole('link', { name: 'Dossier' }));
  });

  it('keeps the section on a Corpus page after it', () => {
    sectionStore.setState({ section: 'gymnasium' });
    renderSidebar('/dossier');
    expect(screen.getByRole('group', { name: 'Learn' })).toBeInTheDocument();
  });

  it('Forum: «Dossier pubblici» with its count, and «Community»; «Forum» is the group, written once', () => {
    renderSidebar('/forum');
    expect(hrefs()).toEqual(['/', '/documents', '/rassegne', '/forum', '/forum/community']);
    const forum = screen.getByRole('group', { name: 'Forum' });
    expect(within(forum).getAllByRole('link').map((a) => a.getAttribute('aria-label'))).toEqual(['Dossier pubblici, 3 notifiche', 'Community']);
    expect(screen.queryByRole('link', { name: /^Forum/ })).toBeNull();
    expect(screen.getByRole('link', { name: /^Dossier pubblici/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Community' })).not.toHaveAttribute('aria-current');
  });

  it('marks only «Community» on its page: «Dossier pubblici» is active on its own address, not under it', () => {
    renderSidebar('/forum/community');
    expect(screen.getByRole('group', { name: 'Forum' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Community' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /^Dossier pubblici/ })).not.toHaveAttribute('aria-current');
  });

  it('Academia: «Assistente» and «Grafo», with the development mode only (S12)', () => {
    account.devMode = true;
    renderSidebar('/labs');
    expect(hrefs()).toEqual(['/', '/documents', '/rassegne', '/labs', '/labs/grafo']);
    // «Assistente» stays lit on the hub's own pages, not on the graph's (#448).
    for (const path of ['/labs/contribuisci', '/labs/valida']) {
      cleanupAndRender(path, () => { account.devMode = true; });
      expect(screen.getByRole('link', { name: 'Assistente' }), path).toHaveAttribute('aria-current', 'true');
    }
    cleanupAndRender('/labs/grafo', () => { account.devMode = true; });
    expect(screen.getByRole('link', { name: 'Assistente' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Grafo' })).toHaveAttribute('aria-current', 'page');
    // Without the mode the section is not offered: a stored Academia falls back to Opus.
    cleanupAndRender('/', () => { account.devMode = false; sectionStore.setState({ section: 'academia' }); });
    expect(hrefs()).toEqual(OPUS_HREFS);
    expect(screen.queryByRole('link', { name: /^(Grafo|Assistente)$/ })).toBeNull();
  });

  it('Academia follows the MERL-T flags: only «Assistente» with the graph off, nothing with MERL-T off', () => {
    account.devMode = true;
    vi.stubEnv('VITE_FEATURE_MERLT_GRAPH', 'false');
    renderSidebar('/labs');
    expect(hrefs()).toEqual(['/', '/documents', '/rassegne', '/labs']);
    cleanupAndRender('/labs', () => vi.stubEnv('VITE_FEATURE_MERLT', 'false'));
    expect(hrefs()).toEqual(['/', '/documents', '/rassegne']);
  });

  it('offers no Gymnasium when VITE_FEATURE_STUDIA is off', () => {
    vi.stubEnv('VITE_FEATURE_STUDIA', 'false');
    sectionStore.setState({ section: 'gymnasium' });
    renderSidebar('/');
    expect(hrefs()).toEqual(OPUS_HREFS);
  });

  it("is the same list in the phone's copy, closed off-canvas or open (spec D8)", () => {
    renderSidebar('/', { isOpen: false });
    expect(hrefs()).toEqual(OPUS_HREFS);
    openUserMenu();
    expect(screen.getByRole('menuitem', { name: /Impostazioni/ })).toBeInTheDocument();
  });

  it("closes the phone's menu when a section is chosen", () => {
    renderSidebar('/');
    fireEvent.click(screen.getByRole('button', { name: /^Sezione:/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Forum/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/forum');
    expect(handlers.closeMobile).toHaveBeenCalled();
    expect(hrefs()).toEqual(['/', '/documents', '/rassegne', '/forum', '/forum/community']);
  });

  // Papiniano's pass on #457: from Work to Learn the column glided in from 41 px above. framer-motion's `LayoutGroup`
  // reads its `id` once, so every section shared the first one's and the columns of two sections were one shape.
  it('draws a new section\'s entries afresh, so its column appears in place instead of gliding from the old one', () => {
    renderSidebar('/');
    const work = screen.getByRole('group', { name: 'Work' });
    fireEvent.click(screen.getByRole('button', { name: /^Sezione:/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Forum/ }));
    expect(screen.getByRole('group', { name: 'Forum' })).not.toBe(work);
    expect(work.isConnected).toBe(false);
  });

  it('fades in the new section\'s entries only, never the Corpus ones above them (T1)', () => {
    // jsdom has no Web Animations: the spy records which elements fade in.
    const animate = vi.fn();
    Element.prototype.animate = animate as unknown as typeof Element.prototype.animate;
    try {
      renderSidebar('/');
      expect(animate).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: /^Sezione:/ }));
      fireEvent.click(screen.getByRole('menuitemradio', { name: /Forum/ }));
      // The switcher's own menu moves too (S6); the navigation's entries are what this counts.
      const nav = document.getElementById('tour-sidebar')!;
      const faded = (animate.mock.contexts as HTMLElement[]).filter((el) => nav.contains(el));
      expect(faded.length).toBeGreaterThan(0);
      const forum = screen.getByRole('group', { name: 'Forum' });
      for (const entry of faded) expect(forum).toContainElement(entry);
      expect(faded).toContain(screen.getByRole('link', { name: 'Community' }));
    } finally {
      delete (Element.prototype as Partial<Element>).animate;
    }
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
  it("holds Impostazioni, Cronologia, «Collega un'app AI», «Crediti», the services' status, the theme, Scorciatoie (no «(?)»: the key still opens it) and Esci; «Pannello Admin» only for an admin", () => {
    renderSidebar();
    openUserMenu();
    expect(screen.getByRole('menu', { name: 'Menu utente' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem').map((e) => e.textContent?.trim())).toEqual(['Impostazioni', 'Cronologia', "Collega un'app AI", 'Crediti', 'Stato dei servizi: Servizi operativi', 'Tema scuro', 'Scorciatoie', 'Esci']);
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

  it('opens «Crediti», the public page of the sources, and closes the menu (and the phone\'s menu)', () => {
    renderSidebar();
    openUserMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Crediti' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/crediti');
    expect(handlers.closeMobile).toHaveBeenCalled();
    expect(screen.queryByRole('menu', { name: 'Menu utente' })).toBeNull();
  });

  it('holds «Commenti» on a phone, after «Crediti», and opens the form from it (M1)', () => {
    const openFeedback = vi.fn();
    render(
      <MemoryRouter>
        <Sidebar theme="light" isOpen serviceHealth={serviceHealth} {...handlers} openFeedback={openFeedback} layout="drawer" />
      </MemoryRouter>,
    );
    openUserMenu();
    const names = screen.getAllByRole('menuitem').map((e) => e.textContent?.trim());
    expect(names.indexOf('Commenti')).toBe(names.indexOf('Crediti') + 1);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Commenti' }));
    expect(openFeedback).toHaveBeenCalledTimes(1);
    expect(handlers.closeMobile).toHaveBeenCalled();
    expect(screen.queryByRole('menu', { name: 'Menu utente' })).toBeNull();
  });

  it('takes the closed drawer out of reach (inert), and only the drawer', () => {
    const { container, rerender } = render(
      <MemoryRouter>
        <Sidebar theme="light" isOpen={false} serviceHealth={serviceHealth} {...handlers} layout="drawer" />
      </MemoryRouter>,
    );
    expect(container.querySelector('aside')).toHaveAttribute('inert');
    rerender(
      <MemoryRouter>
        <Sidebar theme="light" isOpen serviceHealth={serviceHealth} {...handlers} layout="drawer" />
      </MemoryRouter>,
    );
    expect(container.querySelector('aside')).not.toHaveAttribute('inert');
    rerender(
      <MemoryRouter>
        <Sidebar theme="light" isOpen={false} serviceHealth={serviceHealth} {...handlers} layout="rail" />
      </MemoryRouter>,
    );
    expect(container.querySelector('aside')).not.toHaveAttribute('inert');
  });

  it('leaves «Commenti» to the button at the top right from md', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ ...original(query), matches: query === '(min-width: 768px)' })) as typeof window.matchMedia;
    try {
      render(
        <MemoryRouter>
          <Sidebar theme="light" isOpen serviceHealth={serviceHealth} {...handlers} openFeedback={vi.fn()} />
        </MemoryRouter>,
      );
      openUserMenu();
      expect(screen.queryByRole('menuitem', { name: 'Commenti' })).toBeNull();
    } finally {
      window.matchMedia = original;
    }
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

// The services' status was a pill fixed at the bottom left, over the foot of the page on a phone (S1): it is an
// entry of the user menu, and a fault is a dot on the user button.
describe('Sidebar — the services\' status in the user menu (S1)', () => {
  const dot = () => document.querySelector('[data-service-health-dot]');

  it.each([
    ['online', 'Servizi operativi'],
    ['degraded', 'Alcune fonti non disponibili'],
    ['offline', 'Servizio non raggiungibile'],
    ['checking', 'Controllo servizi…'],
  ] as const)('writes the phrase of the state (%s), after «Crediti» and before the theme', (state, phrase) => {
    serviceHealth.snapshot.overall = state;
    renderSidebar();
    openUserMenu();
    const entry = screen.getByRole('menuitem', { name: `Stato dei servizi: ${phrase}` });
    expect(entry).toHaveTextContent(phrase);
    const entries = screen.getAllByRole('menuitem');
    expect(entries.indexOf(entry)).toBe(entries.indexOf(screen.getByRole('menuitem', { name: 'Crediti' })) + 1);
    expect(entries[entries.indexOf(entry) + 1]).toHaveTextContent('Tema scuro');
  });

  it('opens inside the menu with a tap, the services and their latency, and «Ricontrolla» probes again with the menu open', () => {
    renderSidebar();
    openUserMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stato dei servizi: Servizi operativi' }));
    const list = within(screen.getByRole('menu', { name: 'Menu utente' })).getByRole('group', { name: 'Stato dei servizi' });
    expect(list).toHaveTextContent('Backend dati utenteOK · 12 ms');
    expect(list).toHaveTextContent('API normativa e fontiDegradato · 340 ms');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ricontrolla' }));
    expect(serviceHealth.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('menu', { name: 'Menu utente' })).toBeInTheDocument();
    expect(handlers.closeMobile).not.toHaveBeenCalled();
  });

  it('is reached with the arrows, and so are its rows once open; Esc closes the menu, back to the avatar', () => {
    renderSidebar();
    openUserMenu();
    const menu = screen.getByRole('menu');
    for (let i = 0; i < 4; i++) fireEvent.keyDown(menu, { key: 'ArrowDown' });
    const entry = screen.getByRole('menuitem', { name: 'Stato dei servizi: Servizi operativi' });
    expect(entry).toHaveFocus();
    // Enter on a focused button is its click: the focus stays on the entry.
    fireEvent.click(entry);
    expect(entry).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: /Backend dati utente/ })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Ricontrolla' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Tema scuro' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: /Menu utente/ })).toHaveFocus();
  });

  it('opens folded every time', () => {
    renderSidebar();
    openUserMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stato dei servizi: Servizi operativi' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    openUserMenu();
    expect(screen.getByRole('menuitem', { name: 'Stato dei servizi: Servizi operativi' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'Stato dei servizi' })).toBeNull();
  });

  it.each(['rail', 'wide', 'drawer'] as const)('puts a dot on the user button (%s) when a source or a service is down, and says it in its name', (layout) => {
    const named = layout === 'rail' ? 'Menu utente' : 'Menu utente di tester';
    for (const [state, words] of [['degraded', 'alcune fonti non disponibili'], ['offline', 'servizio non raggiungibile']] as const) {
      cleanup();
      serviceHealth.snapshot.overall = state;
      render(<MemoryRouter><Sidebar theme="light" isOpen layout={layout} serviceHealth={serviceHealth} {...handlers} /></MemoryRouter>);
      const button = screen.getByRole('button', { name: `${named}, ${words}` });
      expect(button).toContainElement(dot() as HTMLElement);
    }
    for (const state of ['online', 'checking'] as const) {
      cleanup();
      serviceHealth.snapshot.overall = state;
      render(<MemoryRouter><Sidebar theme="light" isOpen layout={layout} serviceHealth={serviceHealth} {...handlers} /></MemoryRouter>);
      expect(screen.getByRole('button', { name: named })).toBeInTheDocument();
      expect(dot()).toBeNull();
    }
  });

  it('says the changed norms and the fault together, and keeps the dot clear of their count', () => {
    notices.normaChanges = 2;
    serviceHealth.snapshot.overall = 'degraded';
    renderSidebar();
    const button = screen.getByRole('button', { name: 'Menu utente, 2 norme salvate cambiate, alcune fonti non disponibili' });
    expect(within(button).getByText('2')).toBeInTheDocument();
    expect(dot()).toHaveClass('-bottom-0.5', '-right-0.5');
    expect(button.textContent?.trim()).toBe('T2');
  });

  it('lets the menu scroll rather than leave the top of a low window', () => {
    renderSidebar();
    const button = screen.getByRole('button', { name: /Menu utente/ });
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ top: 300, bottom: 344, left: 10, right: 54 } as DOMRect);
    openUserMenu();
    const menu = screen.getByRole('menu', { name: 'Menu utente' });
    expect(menu).toHaveClass('overflow-y-auto');
    // The rail's menu is aligned to the avatar's foot.
    expect(menu.style.maxHeight).toBe('336px');
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
        <Where />
        <Sidebar theme="light" isOpen layout={layout} onToggleWide={onToggleWide} serviceHealth={serviceHealth} {...handlers} />
      </MemoryRouter>,
    );
  }

  it.each(['wide', 'drawer'] as const)('writes each entry beside its icon (%s), with the same names and ids', (layout) => {
    renderLayout(layout, '/forum');
    expect(screen.getByRole('link', { name: 'Ricerca' })).toHaveTextContent('Ricerca');
    // «Analizza documento» would be cut in the 224 px bar: the word «Analizza», the name whole (it starts with it).
    expect(screen.getByRole('link', { name: 'Analizza documento' })).toHaveTextContent(/^Analizza$/);
    expect(document.getElementById('tour-nav-search')).toBe(screen.getByRole('link', { name: 'Ricerca' }));
    // The count rides the name and sits at the end of the row.
    const forum = screen.getByRole('link', { name: 'Dossier pubblici, 3 notifiche' });
    expect(forum).toHaveTextContent(/^Dossier pubblici3$/);
    expect(screen.getByRole('link', { name: 'Community' })).toHaveTextContent(/^Community$/);
    // The sections are a row of tabs (LC21); the active one says it goes to its home (S6). No switcher menu.
    const tabs = screen.getByRole('group', { name: 'Sezioni' });
    expect(within(tabs).getAllByRole('button').map((b) => b.textContent)).toEqual(['Work', 'Learn', 'Forum']);
    const current = within(tabs).getByRole('button', { name: 'Vai a Forum: Dossier pubblici' });
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(within(tabs).getAllByRole('button').filter((b) => b.hasAttribute('aria-current'))).toEqual([current]);
    expect(screen.queryByRole('button', { name: 'Cambia sezione' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Sezione:/ })).toBeNull();
    // Rows of 36 px (44 in the drawer, a touch target), icons of 18.
    const community = screen.getByRole('link', { name: 'Community' });
    expect(community).toHaveClass(layout === 'drawer' ? 'h-11' : 'h-9');
    expect(community.querySelector('svg')).toHaveAttribute('width', '18');
    // The username is shown, so the name carries it (label in name).
    expect(screen.getByRole('button', { name: 'Menu utente di tester' })).toHaveTextContent('tester');
  });

  it('writes no section name over its entries (it is on the tab above), only the other headings, as «Contribuisci»', () => {
    renderLayout('wide', '/dossier');
    expect(within(screen.getByRole('group', { name: 'Work' })).queryByText('Work')).toBeNull();
    cleanup();
    renderLayout('wide', '/forum');
    expect(within(screen.getByRole('group', { name: 'Forum' })).queryByText('Forum')).toBeNull();
    cleanup();
    renderLayout('wide', '/learn/ripasso');
    expect(within(screen.getByRole('group', { name: 'Learn' })).queryByText('Learn')).toBeNull();
    expect(within(screen.getByRole('group', { name: 'Contribuisci' })).getByText('Contribuisci')).toHaveClass('uppercase', 'text-[11px]');
    cleanup();
    // The rail has no room for them.
    renderLayout('rail', '/learn/ripasso');
    expect(screen.queryByText('Learn')).toBeNull();
    expect(screen.getByRole('link', { name: 'Oggi' }).textContent).toBe('');
  });

  it('labels the Forum\'s two areas in the rail, on hover and on keyboard focus', () => {
    renderLayout('rail', '/forum');
    const shared = screen.getByRole('link', { name: 'Dossier pubblici, 3 notifiche' });
    expect(shared.textContent).toBe('3');
    pointerOver(shared, MOUSE);
    expect(label()).toHaveTextContent('Dossier pubblici');
    cleanup();
    renderLayout('rail', '/forum');
    const realMatches = Element.prototype.matches;
    const matches = vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
      return selector === ':focus-visible' ? true : realMatches.call(this, selector);
    });
    fireEvent.focus(screen.getByRole('link', { name: 'Community' }));
    expect(label()).toHaveTextContent('Community');
    matches.mockRestore();
  });

  it('draws its 11 px texts, the headings and the shortcut, in the colour that keeps AA (theme.test.ts)', () => {
    renderLayout('wide', '/learn/ripasso');
    expect(within(screen.getByRole('group', { name: 'Contribuisci' })).getByText('Contribuisci')).toHaveClass('text-[11px]', ...SIDEBAR_SMALL_TEXT.split(' '));
    const shortcut = screen.getByRole('link', { name: 'Ricerca' }).querySelector('kbd') as HTMLElement;
    expect(shortcut).toHaveClass('text-[11px]', ...SIDEBAR_SMALL_TEXT.split(' '));
  });

  it('offers Labs as a fourth tab in the development mode only, and a tab goes to its section\'s home', () => {
    account.devMode = true;
    renderLayout('drawer', '/work/scadenziario');
    const tabs = screen.getByRole('group', { name: 'Sezioni' });
    expect(within(tabs).getAllByRole('button').map((b) => b.textContent)).toEqual(['Work', 'Learn', 'Forum', 'Labs']);
    expect(within(tabs).getByRole('button', { name: 'Vai a Work: Scadenziario' })).toHaveAttribute('aria-current', 'true');
    // 44 px in the drawer, a touch target.
    expect(within(tabs).getByRole('button', { name: 'Labs' })).toHaveClass('h-11');
    fireEvent.click(within(tabs).getByRole('button', { name: 'Learn' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/learn/ripasso');
    expect(handlers.closeMobile).toHaveBeenCalled();
  });

  it('keeps the one switcher button in the rail, which four words would not fit', () => {
    renderLayout('rail', '/forum');
    expect(screen.queryByRole('group', { name: 'Sezioni' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Sezione: Forum, cambia sezione/ })).toBeInTheDocument();
  });

  it.each(['wide', 'drawer'] as const)('keeps «Impostazioni» in sight at the foot (%s), between the user button and «Riduci»; it opens the settings and closes the drawer', (layout) => {
    renderLayout(layout, '/', layout === 'wide' ? vi.fn() : undefined);
    const settings = screen.getByRole('button', { name: 'Impostazioni' });
    expect(settings).toHaveClass(layout === 'drawer' ? 'h-11' : 'h-9');
    const user = screen.getByRole('button', { name: 'Menu utente di tester' });
    expect(user.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    if (layout === 'wide') {
      const narrow = screen.getByRole('button', { name: 'Riduci la barra laterale' });
      expect(settings.compareDocumentPosition(narrow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    fireEvent.click(settings);
    expect(handlers.openSettings).toHaveBeenCalledTimes(1);
    expect(handlers.closeMobile).toHaveBeenCalled();
  });

  it('draws no «Impostazioni» button in the rail, which keeps it in the user menu', () => {
    renderLayout('rail');
    expect(screen.queryByRole('button', { name: 'Impostazioni' })).toBeNull();
  });

  it('shows no hover label where the word is written', () => {
    renderLayout('wide');
    pointerOver(screen.getByRole('link', { name: 'Dossier' }), MOUSE);
    expect(label()).toBeNull();
  });

  it('shows the palette\'s shortcut beside «Ricerca» on the desktop, as the keyboard writes it, not in the phone\'s drawer', () => {
    renderLayout('wide', '/forum');
    // Read once when the module loads, from `navigator.platform`: «⌘K» on a Mac, «Ctrl K» elsewhere.
    expect(screen.getByRole('link', { name: 'Ricerca' })).toHaveTextContent(/^Ricerca(⌘K|Ctrl K)$/);
    cleanup();
    renderLayout('drawer', '/forum');
    expect(screen.getByRole('link', { name: 'Ricerca' })).toHaveTextContent(/^Ricerca$/);
  });

  it('gives the drawer rows of 44 px and a foot clear of the home indicator', () => {
    renderLayout('drawer');
    for (const link of within(screen.getByRole('navigation')).getAllByRole('link')) expect(link).toHaveClass('h-11', 'w-full');
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

  it.each(['wide', 'drawer'] as const)('heads the bar with the LexCraft logo (%s), a link home and its first Tab stop (LC16)', (layout) => {
    renderLayout(layout, '/forum');
    const home = screen.getAllByRole('link')[0];
    expect(home).toHaveAccessibleName('LexCraft');
    expect(home).toHaveAttribute('href', '/');
    // The wordmark, not the column alone; still unless the shell asks for its sweep.
    const logo = within(home).getByRole('img', { name: 'LexCraft' });
    expect(logo).toHaveClass('vlx-logo');
    expect(logo).not.toHaveClass('vlx-logo-sweep');
    // Its own row, over the switcher's (the tours still find the switcher).
    expect(home.compareDocumentPosition(document.getElementById('tour-section-switcher')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('in the rail keeps only the column, the same link, centred over the icons and still', () => {
    renderLayout('rail', '/forum');
    const home = screen.getAllByRole('link')[0];
    expect(home).toHaveAccessibleName('LexCraft');
    expect(home).toHaveAttribute('href', '/');
    expect(home.querySelector('.vlx-logo')).toBeNull();
    expect(home.querySelector('.vlx-book')).not.toBeNull();
    expect(home.parentElement).toHaveClass('justify-center');
  });

  it('sweeps the logo when the shell says it is due, never in the rail', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar theme="light" isOpen layout="wide" logoSweep serviceHealth={serviceHealth} {...handlers} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('img', { name: 'LexCraft' })).toHaveClass('vlx-logo-sweep');
    cleanup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar theme="light" isOpen layout="rail" logoSweep serviceHealth={serviceHealth} {...handlers} />
      </MemoryRouter>,
    );
    expect(document.querySelector('.vlx-logo-sweep')).toBeNull();
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
