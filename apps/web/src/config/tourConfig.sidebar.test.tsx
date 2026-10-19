import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'tester' }, isAdmin: false, devMode: false, logout: vi.fn() }),
}));
vi.mock('../hooks/useForumNotifications', () => ({
  useForumNotifications: () => ({ count: { total: 0, normaChanges: 0 }, markRead: vi.fn(), refetch: vi.fn() }),
}));

import { Sidebar } from '../components/layout/Sidebar';
import { TOUR_STEPS_MAP } from './tourConfig';

const steps = Object.values(TOUR_STEPS_MAP).flat();
const sidebarSelectors = [...new Set(
  steps.map((s) => s.element).filter((e): e is string => typeof e === 'string' && /^#tour-(sidebar|section-switcher|nav-|quick-search)/.test(e)),
)];

// Spec D9: the steps that pointed at «Ricerca Veloce» point at «Ricerca»; none points at a removed control.
describe('the tours and the sidebar', () => {
  it('has no step on the removed «Ricerca Veloce» button', () => {
    expect(steps.some((s) => s.element === '#tour-quick-search')).toBe(false);
  });

  it('points the welcome and search tours at «Ricerca»', () => {
    const search = steps.filter((s) => s.element === '#tour-nav-search');
    expect(search.map((s) => s.popover?.title)).toEqual(['Inizia a Cercare', 'Ricerca e Cmd+K']);
  });

  it('every sidebar target exists in the sidebar a user without the development mode sees', () => {
    render(
      <MemoryRouter>
        <Sidebar theme="light" isOpen closeMobile={vi.fn()} openSettings={vi.fn()} openKeyboardShortcuts={vi.fn()} toggleTheme={vi.fn()} />
      </MemoryRouter>,
    );
    expect(sidebarSelectors.length).toBeGreaterThan(0);
    for (const selector of sidebarSelectors) expect(document.querySelector(selector), selector).not.toBeNull();
  });
});
