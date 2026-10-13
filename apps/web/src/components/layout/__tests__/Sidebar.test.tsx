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

function renderSidebar() {
  return render(
    <MemoryRouter>
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

describe('Sidebar navigation (MERL-T single entry)', () => {
  it('development mode on → "Assistente" (hub) plus "Grafo" (the deliberation surface), after the others', () => {
    // Slice 3 D1 had a single entry; Slice 4 Decision A (absorb) made /grafo
    // the Q&A surface and points the sidebar at it too, the hub stays /merlt.
    // Both only for an account in the development mode (spec D3).
    account.devMode = true;
    renderSidebar();
    const hrefs = navHrefs();
    expect(hrefs).toEqual(['/', '/dossier', '/studia', '/history', '/environments', '/forum', '/documents', '/merlt', '/grafo']);
    // exactly one hub entry
    expect(hrefs.filter((h) => h.startsWith('/merlt'))).toHaveLength(1);
    // «Analizza documento», the last of the others, sits above the MERL-T entries
    expect(hrefs.indexOf('/documents')).toBeLessThan(hrefs.indexOf('/merlt'));
  });

  it('development mode off → no MERL-T entry at all, flag on or not', () => {
    renderSidebar();
    expect(navHrefs()).toEqual(['/', '/dossier', '/studia', '/history', '/environments', '/forum', '/documents']);
  });

  it('flag off → no MERL-T entry at all, even in the development mode', () => {
    account.devMode = true;
    isMerltEnabledMock.mockReturnValue(false);
    renderSidebar();
    const hrefs = navHrefs();
    expect(hrefs).toEqual(['/', '/dossier', '/studia', '/history', '/environments', '/forum', '/documents']);
    expect(hrefs.some((h) => h.startsWith('/merlt'))).toBe(false);
  });
});
