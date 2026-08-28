import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'tester' }, isAdmin: false, logout: vi.fn() }),
}));
vi.mock('../../hooks/useForumNotifications', () => ({
  useForumNotifications: () => ({ count: { total: 3 }, markRead: vi.fn(), refetch: vi.fn() }),
}));

import { Sidebar } from './Sidebar';

/**
 * Every control in the sidebar is an icon. `label` reached the eye only: the
 * tooltip that carried it is `hidden md:block` and appears on hover, so it
 * never named the control for a screen reader or a keyboard user, and the
 * whole primary navigation announced as unnamed links and buttons.
 */
function renderSidebar() {
  render(
    <MemoryRouter>
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
