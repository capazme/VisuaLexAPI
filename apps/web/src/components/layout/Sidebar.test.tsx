import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
