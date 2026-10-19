import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

import { Sidebar } from '../Sidebar';

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
    expect(navHrefs()).toEqual(['/', '/documents', '/dossier']);
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
