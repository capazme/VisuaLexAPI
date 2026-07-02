import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ---- mocks (hoisted) ----
const isMerltEnabledMock = vi.fn();

vi.mock('../../../features/merlt/featureFlag', () => ({
  isMerltEnabled: () => isMerltEnabledMock(),
}));

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { username: 'test', email: 'test@example.com' },
    isAdmin: false,
    logout: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useForumNotifications', () => ({
  useForumNotifications: () => ({ count: { total: 0 }, markRead: vi.fn(), refetch: vi.fn() }),
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector: (s: unknown) => unknown) =>
    selector({ openCommandPalette: vi.fn(), quickNorms: [] }),
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
});

describe('Sidebar navigation (MERL-T single entry)', () => {
  it('flag on → single "Assistente" entry to /merlt, no /grafo entry, Cronologia above it', () => {
    renderSidebar();
    const hrefs = navHrefs();
    expect(hrefs).toEqual(['/', '/dossier', '/environments', '/forum', '/history', '/merlt']);
    // exactly one MERL-T entry, none for the graph
    expect(hrefs.filter((h) => h.startsWith('/merlt'))).toHaveLength(1);
    expect(hrefs).not.toContain('/grafo');
    // Cronologia (/history) sits above the Assistente entry
    expect(hrefs.indexOf('/history')).toBeLessThan(hrefs.indexOf('/merlt'));
  });

  it('flag off → no MERL-T entry at all', () => {
    isMerltEnabledMock.mockReturnValue(false);
    renderSidebar();
    const hrefs = navHrefs();
    expect(hrefs).toEqual(['/', '/dossier', '/environments', '/forum', '/history']);
    expect(hrefs.some((h) => h.startsWith('/merlt'))).toBe(false);
  });
});
