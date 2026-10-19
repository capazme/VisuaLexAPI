import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

// ---- mocks (hoisted) ----
// Pass-through wrappers: routing behaviour is under test, not auth/consent.
vi.mock('../components/auth/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../components/auth/AdminRoute', () => ({
  AdminRoute: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../features/merlt/consent/ConsentContext', () => ({
  ConsentProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// The development mode decides the MERL-T addresses (DevRoute); each test sets it.
const account = vi.hoisted(() => ({ devMode: true }));
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ loading: false, devMode: account.devMode }),
}));

// Layout renders the Outlet inside a marker so tests can assert the shell stays mounted.
vi.mock('../components/layout/Layout', async () => {
  const { Outlet } = await import('react-router-dom');
  return {
    Layout: () => (
      <div data-testid="layout">
        <Outlet />
      </div>
    ),
  };
});

// Page stubs (keep the router test light — pages pull the store/services).
vi.mock('../pages/SearchPage', () => ({ SearchPage: () => <div data-testid="search-page" /> }));
vi.mock('../pages/LoginPage', () => ({ LoginPage: () => <div /> }));
vi.mock('../pages/RegisterPage', () => ({ RegisterPage: () => <div /> }));
vi.mock('../components/features/dossier/DossierPage', () => ({ DossierPage: () => <div /> }));
vi.mock('../components/features/history/HistoryView', () => ({ HistoryView: () => <div /> }));
vi.mock('../components/features/bulletin/BulletinBoardPage', () => ({ BulletinBoardPage: () => <div data-testid="forum" /> }));
// Lazy-loaded pages (vi.mock also intercepts dynamic import()).
vi.mock('../pages/AdminPage', () => ({ AdminPage: () => <div /> }));
vi.mock('../pages/MerltHubPage', () => ({ MerltHubPage: () => <div data-testid="merlt-hub" /> }));
vi.mock('../features/merlt/graph/page/GraphExplorerPage', () => ({
  GraphExplorerPage: () => <div data-testid="graph-explorer" />,
}));
vi.mock('../features/merlt/contrib/ContribPage', () => ({ ContribPage: () => <div /> }));
vi.mock('../features/merlt/validate/ValidationPage', () => ({ ValidationPage: () => <div /> }));
// The Studia views are real (their headings are under test), so their requests are answered here:
// unmocked, jsdom's XHR reaches for a server that isn't there.
vi.mock('../services/studiaService', () => ({
  studiaService: {
    list: vi.fn().mockResolvedValue({ cards: [], nextOffset: null }),
    get: vi.fn().mockRejectedValue({ status: 404 }),
    queue: vi.fn().mockResolvedValue({ cards: [] }),
    vote: vi.fn().mockRejectedValue({ status: 404 }),
    // The strip over Le mie schede and Da validare reads the progress (Gymnasium spec §5.1).
    progress: vi.fn().mockRejectedValue({ status: 404 }),
  },
}));
vi.mock('../components/features/studia/ReviewHome', () => ({ ReviewHome: () => <h2>Ripasso di oggi</h2> }));
vi.mock('../components/features/studia/ReviewSession', () => ({ ReviewSession: () => <h2>Sessione di ripasso</h2> }));

import App from '../App';

function renderAt(path: string) {
  window.history.pushState({}, '', path);
  return render(<App />);
}

beforeEach(() => {
  window.history.pushState({}, '', '/');
  account.devMode = true;
});

describe('App routing', () => {
  // Slice 4 absorb (Decision A): the Q&A page is gone — /merlt/qa and the legacy
  // /merlt/chiedi both redirect to the graph, the sole deliberation surface.
  it('redirects the absorbed /merlt/qa path to /grafo', async () => {
    renderAt('/merlt/qa');
    expect(await screen.findByTestId('graph-explorer')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/grafo');
  });

  it('redirects the legacy /merlt/chiedi path to /grafo', async () => {
    renderAt('/merlt/chiedi');
    expect(await screen.findByTestId('graph-explorer')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/grafo');
  });

  // «Ambienti» absorbed by the Forum (spec 2026-10-13-environments-into-forum, D11c): an old share link keeps its content.
  it('sends /environments to the Forum, keeping an old link\'s ?import=', async () => {
    renderAt('/environments?import=abc');
    expect(await screen.findByTestId('forum')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/forum');
    expect(window.location.search).toBe('?import=abc');
  });

  it('renders the global 404 page inside the layout for unknown paths', async () => {
    renderAt('/percorso-inesistente');
    expect(await screen.findByText('Pagina non trovata')).toBeInTheDocument();
    // the layout (sidebar shell) stays mounted around the 404
    expect(screen.getByTestId('layout')).toBeInTheDocument();
    const backLink = screen.getByRole('link', { name: 'Torna alla ricerca' });
    expect(backLink).toHaveAttribute('href', '/');
  });

  it('lazy-loads the MERL-T hub at /merlt', async () => {
    renderAt('/merlt');
    expect(await screen.findByTestId('merlt-hub')).toBeInTheDocument();
  });

  it('lazy-loads the graph explorer at /grafo', async () => {
    renderAt('/grafo');
    expect(await screen.findByTestId('graph-explorer')).toBeInTheDocument();
  });

  // Spec D6: a development address opened without the development mode is not there.
  it.each(['/merlt', '/merlt/contribuisci', '/merlt/valida', '/grafo', '/merlt/qa', '/merlt/chiedi'])(
    'sends %s to the search page without the development mode',
    async (path) => {
      account.devMode = false;
      renderAt(path);
      expect(await screen.findByTestId('search-page')).toBeInTheDocument();
      expect(window.location.pathname).toBe('/');
      expect(screen.queryByTestId('graph-explorer')).not.toBeInTheDocument();
      expect(screen.queryByTestId('merlt-hub')).not.toBeInTheDocument();
    },
  );

  it('sends /sentenze and a decision address into the search space', async () => {
    const lookup = renderAt('/sentenze');
    expect(await screen.findByTestId('search-page')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    lookup.unmount();

    renderAt('/sentenze/cassazione-civile/99999/2024');
    expect(await screen.findByTestId('search-page')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });
});

describe('App routing — Studia', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('opens «Le mie schede» at /studia/schede', async () => {
    renderAt('/studia/schede');
    expect(await screen.findByRole('heading', { name: 'Le mie schede' })).toBeInTheDocument();
  });

  it('sends /studia to the review', async () => {
    renderAt('/studia');
    expect(await screen.findByRole('heading', { name: 'Ripasso di oggi' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/studia/ripasso');
  });

  it('opens a session at /studia/ripasso/sessione, inside the area', async () => {
    renderAt('/studia/ripasso/sessione?materia=DIRITTO_CIVILE');
    expect(await screen.findByRole('heading', { name: 'Sessione di ripasso' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Gymnasium: la tua palestra giuridica' })).toBeInTheDocument();
  });

  it('keeps a card’s address inside the Studia area', async () => {
    renderAt('/studia/schede/k1');
    expect(await screen.findByRole('heading', { name: 'Le mie schede' })).toBeInTheDocument();
  });

  it('opens «Da validare» at /studia/valida', async () => {
    renderAt('/studia/valida');
    expect(await screen.findByRole('heading', { name: 'Da validare' })).toBeInTheDocument();
    expect(await screen.findByText('Nessuna scheda da validare')).toBeInTheDocument();
  });

  it('is the 404 page when VITE_FEATURE_STUDIA is off', async () => {
    vi.stubEnv('VITE_FEATURE_STUDIA', 'false');
    renderAt('/studia');
    expect(await screen.findByText('Pagina non trovata')).toBeInTheDocument();
  });
});
