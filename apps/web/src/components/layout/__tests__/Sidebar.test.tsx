import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ---- mocks (hoisted) ----
const isMerltEnabledMock = vi.fn();
const account = vi.hoisted(() => ({ devMode: false }));

vi.mock('../../../features/merlt/featureFlag', () => ({
  isMerltEnabled: () => isMerltEnabledMock(),
}));

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { username: 'test', email: 'test@example.com' },
    isAdmin: false,
    devMode: account.devMode,
    logout: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useForumNotifications', () => ({
  useForumNotifications: () => ({ count: { total: 0 }, markRead: vi.fn(), refetch: vi.fn() }),
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector: (s: unknown) => unknown) =>
    selector({ quickNorms: [] }),
}));

// The pages loaded with their route: what the entries ask to fetch ahead.
const prepared = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock('../../../pageCode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../pageCode')>()),
  preparePage: (path: string) => { prepared.paths.push(path); },
}));

import { Sidebar } from '../Sidebar';
import { coursesSwitchStore } from '../../features/studia/corsi/coursesSwitch';

function renderSidebar(path = '/merlt') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar
        theme="light"
        toggleTheme={vi.fn()}
        isOpen={true}
        closeMobile={vi.fn()}
        openSettings={vi.fn()}
        openKeyboardShortcuts={vi.fn()}
        serviceHealth={{ snapshot: { overall: 'online', services: [], checkedAt: '' }, refresh: vi.fn() }}
      />
    </MemoryRouter>,
  );
}

function navHrefs(): string[] {
  return screen
    .getAllByRole('link')
    .map((a) => a.getAttribute('href'))
    .filter((href): href is string => href !== null);
}

beforeEach(() => {
  isMerltEnabledMock.mockReturnValue(true);
  account.devMode = false;
  prepared.paths = [];
});

describe('Sidebar — a page loaded with its route is fetched ahead (P1)', () => {
  it('as its entry is pointed at, touched or focused', () => {
    renderSidebar('/');
    const dossier = screen.getAllByRole('link', { name: 'Dossier' })[0];
    fireEvent.pointerEnter(dossier, { pointerType: 'mouse' });
    expect(prepared.paths).toEqual(['/dossier']);
    fireEvent.pointerDown(screen.getByRole('link', { name: 'Analizza documento' }));
    expect(prepared.paths).toEqual(['/dossier', '/documents']);
    fireEvent.focus(screen.getByRole('link', { name: /Ricerca/ }));
    expect(prepared.paths).toEqual(['/dossier', '/documents', '/']);
  });
});

// The MERL-T entries are Academia's, a section offered only in the development mode (sections spec S6, S12).
describe('Sidebar navigation (MERL-T single entry)', () => {
  it('development mode on → Academia holds "Assistente" (hub) plus "Grafo" (the deliberation surface)', () => {
    // Slice 3 D1 had a single entry; Slice 4 Decision A (absorb) made /grafo
    // the Q&A surface and points the sidebar at it too, the hub stays /merlt.
    account.devMode = true;
    renderSidebar();
    const hrefs = navHrefs();
    expect(hrefs).toEqual(['/', '/documents', '/merlt', '/grafo']);
    // exactly one hub entry
    expect(hrefs.filter((h) => h.startsWith('/merlt'))).toHaveLength(1);
  });

  it('development mode off → no MERL-T entry at all, flag on or not', () => {
    renderSidebar('/');
    expect(navHrefs()).toEqual(['/', '/documents', '/opus/oggi', '/opus/prossimi', '/opus/ingresso', '/dossier']);
  });

  it('flag off → no MERL-T entry at all, even in the development mode', () => {
    account.devMode = true;
    isMerltEnabledMock.mockReturnValue(false);
    renderSidebar();
    const hrefs = navHrefs();
    expect(hrefs).toEqual(['/', '/documents']);
    expect(hrefs.some((h) => h.startsWith('/merlt'))).toBe(false);
  });
});

// «Percorsi», second in «Studia», behind the switch `lingo_courses` (courses spec §6.1, §10.10).
describe('Sidebar — Gymnasium\'s «Percorsi»', () => {
  const studia = () => navHrefs().filter((h) => h.startsWith('/studia') || h === '/dossier');

  it('is absent while the switch is off or not yet read', () => {
    for (const state of ['unknown', 'off'] as const) {
      coursesSwitchStore.setState({ state });
      const { unmount } = renderSidebar('/studia/ripasso');
      expect(studia()).toEqual(['/studia/ripasso', '/studia/progressi', '/dossier', '/studia/schede']);
      unmount();
    }
  });

  it('comes second, Oggi · Percorsi · Progressi · Dossier, once the switch is on', () => {
    coursesSwitchStore.setState({ state: 'on' });
    renderSidebar('/studia/ripasso');
    expect(studia()).toEqual(['/studia/ripasso', '/studia/percorsi', '/studia/progressi', '/dossier', '/studia/schede']);
    expect(screen.getByRole('link', { name: 'Percorsi' })).toBeInTheDocument();
    coursesSwitchStore.setState({ state: 'unknown' });
  });
});
