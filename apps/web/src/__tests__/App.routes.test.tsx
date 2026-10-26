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

// The development mode decides the MERL-T addresses (DevRoute); each test sets it. The account is a
// validator: «Da validare» reads its queue only for one.
const account = vi.hoisted(() => ({ devMode: true }));
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ loading: false, devMode: account.devMode, isValidator: true }),
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
vi.mock('../pages/AuthPage', () => ({ AuthPage: () => <div /> }));
// Loaded with their route (P1, `pageCode.ts`): vi.mock intercepts the dynamic import() too.
vi.mock('../components/features/dossier/DossierPage', () => ({ DossierPage: () => <div data-testid="dossier-page" /> }));
vi.mock('../components/features/history/HistoryView', () => ({ HistoryView: () => <div data-testid="history-page" /> }));
vi.mock('../components/features/documents/DocumentReviewPage', () => ({ DocumentReviewPage: () => <div data-testid="documents-page" /> }));
vi.mock('../features/connections/ConnectAiAppPage', () => ({ ConnectAiAppPage: () => <div data-testid="connect-ai-app-page" /> }));
vi.mock('../pages/CreditsPage', () => ({ CreditsPage: () => <div data-testid="credits-page" /> }));
vi.mock('../components/features/planner/OpusPage', async () => {
  const { Outlet } = await import('react-router-dom');
  return { OpusPage: () => <div data-testid="opus-page"><Outlet /></div> };
});
vi.mock('../components/features/planner/OpusViews', () => ({
  TodayView: () => <h2>Oggi</h2>,
  UpcomingView: () => <h2>Prossimi giorni</h2>,
  InboxView: () => <h2>Lista d’ingresso</h2>,
  TaskTrashView: () => <h2>Cestino</h2>,
}));
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
    // The strip over Da validare reads the progress (Gymnasium spec §5.1), and its settings, mounted closed, the
    // study preferences (U1b).
    progress: vi.fn().mockRejectedValue({ status: 404 }),
    preferences: vi.fn().mockRejectedValue({ status: 404 }),
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

  // The Forum's two areas (F1): «Dossier pubblici» keeps /forum, «Community» is a placeholder beside it.
  it('keeps /forum on «Dossier pubblici»', async () => {
    renderAt('/forum');
    expect(await screen.findByTestId('forum')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/forum');
  });

  it('opens the Community placeholder at /forum/community, titled by its name under the Forum\'s phrase, and a way to the public dossiers', async () => {
    renderAt('/forum/community');
    // The page's name as its title, the Forum's phrase small over it (L-37), and the S7a empty state.
    expect(await screen.findByRole('heading', { level: 1, name: 'Community' })).toBeInTheDocument();
    expect(screen.getByText('Forum · il luogo del dibattito giuridico')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Le discussioni arrivano presto' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Esplora i dossier pubblici' })).toHaveAttribute('href', '/forum');
    expect(screen.queryByText('Pagina non trovata')).toBeNull();
    expect(screen.getByTestId('layout')).toBeInTheDocument();
  });

  it('renders the global 404 page inside the layout for unknown paths', async () => {
    renderAt('/percorso-inesistente');
    // The page's title: with it in sight, the phone's bar names no section over it (M1).
    expect(await screen.findByRole('heading', { level: 1, name: 'Pagina non trovata' })).toBeInTheDocument();
    // the layout (sidebar shell) stays mounted around the 404
    expect(screen.getByTestId('layout')).toBeInTheDocument();
    const backLink = screen.getByRole('link', { name: 'Torna alla ricerca' });
    expect(backLink).toHaveAttribute('href', '/');
    // A button's look, 44 px at every width (Q1): `Button`'s primary, large.
    expect(backLink).toHaveClass('min-h-11', 'bg-toga-600', 'rounded-md');
    expect(backLink.className).not.toMatch(/md:min-h-(8|9)\b/);
  });

  // The pages loaded with their route (P1): each at its address, inside the layout.
  it.each([
    ['/dossier', 'dossier-page'],
    ['/history', 'history-page'],
    ['/documents', 'documents-page'],
    ['/collega-app', 'connect-ai-app-page'],
  ])('loads %s’s page with its route, inside the layout', async (path, testId) => {
    renderAt(path);
    expect(await screen.findByTestId(testId)).toBeInTheDocument();
    expect(screen.getByTestId('layout')).toBeInTheDocument();
  });

  it('opens Opus at «Oggi», its frame and its view loaded together', async () => {
    renderAt('/opus');
    expect(await screen.findByRole('heading', { name: 'Oggi' })).toBeInTheDocument();
    expect(screen.getByTestId('opus-page')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/opus/oggi');
  });

  it.each([
    ['/opus/prossimi', 'Prossimi giorni'],
    ['/opus/ingresso', 'Lista d’ingresso'],
    ['/opus/cestino', 'Cestino'],
  ])('opens %s in Opus’s frame', async (path, heading) => {
    renderAt(path);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByTestId('opus-page')).toBeInTheDocument();
  });

  it('loads «Crediti» with its route, public, outside the layout', async () => {
    renderAt('/crediti');
    expect(await screen.findByTestId('credits-page')).toBeInTheDocument();
    expect(screen.queryByTestId('layout')).toBeNull();
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

  it('opens a session at /studia/ripasso/sessione, inside the area, as the lesson in its frame (Gymnasium spec §5.4)', async () => {
    renderAt('/studia/ripasso/sessione?materia=DIRITTO_CIVILE');
    const session = await screen.findByRole('heading', { name: 'Sessione di ripasso' });
    expect(screen.getByTestId('lesson-frame')).toContainElement(session);
    // The lesson is a screen of its own: the area's heading is not drawn over it.
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('opens «Progressi» at /studia/progressi, inside the area, under its heading (Gymnasium spec §5.3)', async () => {
    renderAt('/studia/progressi');
    expect(await screen.findByRole('heading', { level: 2, name: 'I tuoi progressi' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Progressi' })).toBeInTheDocument();
    expect(screen.getByText('Gymnasium · la tua palestra giuridica')).toBeInTheDocument();
    // The read is mocked to fail here: the page says so.
    expect(await screen.findByText('Non riesco a leggere i tuoi progressi.')).toBeInTheDocument();
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
