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
vi.mock('../components/features/atti/AttiListView', () => ({ AttiListView: () => <div data-testid="atti-list" /> }));
vi.mock('../components/features/atti/AttoEditor', () => ({ AttoEditor: () => <div data-testid="atto-editor" /> }));
vi.mock('../components/features/documents/DocumentReviewPage', () => ({ DocumentReviewPage: () => <div data-testid="documents-page" /> }));
vi.mock('../features/connections/ConnectAiAppPage', () => ({ ConnectAiAppPage: () => <div data-testid="connect-ai-app-page" /> }));
vi.mock('../pages/CreditsPage', () => ({ CreditsPage: () => <div data-testid="credits-page" /> }));
vi.mock('../components/features/planner/OpusPage', async () => {
  const { Outlet } = await import('react-router-dom');
  return { OpusPage: () => <div data-testid="opus-page"><Outlet /></div> };
});
vi.mock('../components/features/planner/OpusViews', () => ({
  TodayView: () => <h2>Scadenziario</h2>,
  UpcomingView: () => <h2>Prossimi giorni</h2>,
  InboxView: () => <h2>Lista d’ingresso</h2>,
  TaskTrashView: () => <h2>Cestino</h2>,
}));
vi.mock('../components/features/bulletin/BulletinBoardPage', () => ({ BulletinBoardPage: () => <div data-testid="forum" /> }));
vi.mock('../services/articleDiscussionService', () => ({
  articleDiscussionService: {
    feed: vi.fn().mockResolvedValue({ data: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } }),
    get: vi.fn().mockRejectedValue({ status: 404 }),
  },
}));
// Lazy-loaded pages (vi.mock also intercepts dynamic import()).
vi.mock('../pages/AdminPage', () => ({ AdminPage: () => <div /> }));
vi.mock('../pages/MerltHubPage', () => ({ MerltHubPage: () => <div data-testid="merlt-hub" /> }));
vi.mock('../features/merlt/graph/page/GraphExplorerPage', () => ({
  GraphExplorerPage: () => <div data-testid="graph-explorer" />,
}));
vi.mock('../features/merlt/contrib/ContribPage', () => ({ ContribPage: () => <div data-testid="contrib-page" /> }));
vi.mock('../features/merlt/validate/ValidationPage', () => ({ ValidationPage: () => <div data-testid="validation-page" /> }));
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
// «Percorsi» (courses spec §6): the switch comes from the features read, which says what `features.lingoCourses` holds.
const features = vi.hoisted(() => ({ lingoCourses: true }));
vi.mock('../services/assistantService', () => ({
  assistantService: { features: vi.fn(async () => ({ assistantPassages: false, lingoCourses: features.lingoCourses })) },
}));
vi.mock('../services/corsiService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/corsiService')>()),
  corsiService: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockRejectedValue({ status: 404 }),
    module: vi.fn().mockRejectedValue({ status: 404 }),
    declaration: vi.fn().mockResolvedValue({ id: 't', chiave: 'MATERIALE_STUDIO', versione: 1, titolo: 'T', corpo: 'C', conferma: 'c', azione: 'a', accettata: true }),
  },
}));
vi.mock('../features/connections/connectionsService', () => ({
  connectionsService: { listConnectedApps: vi.fn().mockResolvedValue([]) },
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
  it('redirects the absorbed /merlt/qa path to /labs/grafo', async () => {
    renderAt('/merlt/qa');
    expect(await screen.findByTestId('graph-explorer')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/labs/grafo');
  });

  it('redirects the legacy /merlt/chiedi path to /labs/grafo', async () => {
    renderAt('/merlt/chiedi');
    expect(await screen.findByTestId('graph-explorer')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/labs/grafo');
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

  it('opens the Community at /forum/community, titled by its name under the Forum\'s phrase, and a discussion at its own address', async () => {
    renderAt('/forum/community');
    // The page's name as its title, the Forum's phrase small over it (L-37).
    expect(await screen.findByRole('heading', { level: 1, name: 'Community' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleDescription('Forum');
    expect(await screen.findByText('Nessuna discussione ancora.')).toBeInTheDocument();
    expect(screen.queryByText('Pagina non trovata')).toBeNull();
    expect(screen.getByTestId('layout')).toBeInTheDocument();
  });

  it('opens one discussion at /forum/community/:threadId, inside the layout', async () => {
    renderAt('/forum/community/t1');
    expect(await screen.findByText('Questa discussione non c’è più.')).toBeInTheDocument();
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

  it('opens Opus at «Scadenziario», its frame and its view loaded together', async () => {
    renderAt('/work');
    expect(await screen.findByRole('heading', { name: 'Scadenziario' })).toBeInTheDocument();
    expect(screen.getByTestId('opus-page')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/work/scadenziario');
  });

  it.each([
    ['/work/prossimi', 'Prossimi giorni'],
    ['/work/ingresso', 'Lista d’ingresso'],
    ['/work/cestino', 'Cestino'],
  ])('opens %s in Opus’s frame', async (path, heading) => {
    renderAt(path);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByTestId('opus-page')).toBeInTheDocument();
  });

  // Atti: the list and an act's editor, in Work's frame.
  it.each([
    ['/work/atti', 'atti-list'],
    ['/work/atti/42', 'atto-editor'],
  ])('opens %s in Opus’s frame', async (path, testId) => {
    renderAt(path);
    expect(await screen.findByTestId(testId)).toBeInTheDocument();
    expect(screen.getByTestId('opus-page')).toContainElement(screen.getByTestId(testId));
  });

  // D-324: the Pseudonimizzatore is the desktop app's: a plain page in Work's frame, no feature behind it.
  it.each([
    ['/work/pseudonimizzatore', /app da scrivania/],
    ['/work/grafo-pratiche', /app da scrivania/],
  ])('opens %s in Opus’s frame, saying what is coming', async (path, text) => {
    renderAt(path);
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByTestId('opus-page')).toContainElement(screen.getByText(text));
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says on the Pseudonimizzatore\'s page what it will do, «in arrivo» (LC47)', async () => {
    renderAt('/work/pseudonimizzatore');
    const page = await screen.findByTestId('opus-page');
    for (const text of [
      'in arrivo',
      'Arriverà con l\'app da scrivania di LexCraft.',
      'Prima che un atto entri in una pratica, toglierà i nomi di persone e società e li sostituirà con etichette: all\'IA arriveranno meno dati personali e meno informazioni riservate.',
      'Funzionerà tutto sul tuo computer: il documento originale non uscirà mai.',
      'I dati con le etichette restano dati personali per il GDPR: lo Pseudonimizzatore riduce il rischio, non sostituisce le altre cautele.',
    ]) expect(page).toContainElement(screen.getByText(text));
  });

  it('says on the Grafo delle pratiche\'s page what it will do, «in arrivo» (LC48)', async () => {
    renderAt('/work/grafo-pratiche');
    const page = await screen.findByTestId('opus-page');
    for (const text of [
      'in arrivo',
      'Arriverà con l\'app da scrivania di LexCraft.',
      'Mostrerà come le tue pratiche si collegano attraverso le norme, le sentenze e le massime che usi: per esempio, in quali pratiche hai già citato un articolo e con quali argomenti.',
      'Lo vedrai solo tu, e collegherà le pratiche attraverso le fonti, non attraverso i nomi dei clienti.',
    ]) expect(page).toContainElement(screen.getByText(text));
  });

  it('loads «Crediti» with its route, public, outside the layout', async () => {
    renderAt('/crediti');
    expect(await screen.findByTestId('credits-page')).toBeInTheDocument();
    expect(screen.queryByTestId('layout')).toBeNull();
  });

  it('lazy-loads the MERL-T hub at /labs', async () => {
    renderAt('/labs');
    expect(await screen.findByTestId('merlt-hub')).toBeInTheDocument();
  });

  it('lazy-loads the graph explorer at /labs/grafo', async () => {
    renderAt('/labs/grafo');
    expect(await screen.findByTestId('graph-explorer')).toBeInTheDocument();
  });

  // Spec D6: a development address opened without the development mode is not there.
  it.each(['/labs', '/labs/contribuisci', '/labs/valida', '/labs/grafo', '/merlt', '/grafo', '/merlt/qa', '/merlt/chiedi'])(
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

  it('opens «Le mie schede» at /learn/schede', async () => {
    renderAt('/learn/schede');
    expect(await screen.findByRole('heading', { name: 'Le mie schede' })).toBeInTheDocument();
  });

  it('sends /learn to the review', async () => {
    renderAt('/learn');
    expect(await screen.findByRole('heading', { name: 'Ripasso di oggi' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/learn/ripasso');
  });

  it('opens a session at /learn/ripasso/sessione, inside the area, as the lesson in its frame (Gymnasium spec §5.4)', async () => {
    renderAt('/learn/ripasso/sessione?materia=DIRITTO_CIVILE');
    const session = await screen.findByRole('heading', { name: 'Sessione di ripasso' });
    expect(screen.getByTestId('lesson-frame')).toContainElement(session);
    // The lesson is a screen of its own: the area's heading is not drawn over it.
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('opens «Progressi» at /learn/progressi, inside the area, under its heading (Gymnasium spec §5.3)', async () => {
    renderAt('/learn/progressi');
    expect(await screen.findByRole('heading', { level: 2, name: 'I tuoi progressi' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Progressi' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleDescription('Learn');
    // The read is mocked to fail here: the page says so.
    expect(await screen.findByText('Non riesco a leggere i tuoi progressi.')).toBeInTheDocument();
  });

  it('opens «Percorsi» at /learn/percorsi, inside the area, once the switch is on (courses spec §6.1)', async () => {
    features.lingoCourses = true;
    renderAt('/learn/percorsi');
    expect(await screen.findByRole('heading', { level: 1, name: 'Percorsi' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'Non hai ancora percorsi' })).toBeInTheDocument();
  });

  it('opens a course at /learn/percorsi/:id under the same heading', async () => {
    features.lingoCourses = true;
    renderAt('/learn/percorsi/c1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Percorsi' })).toBeInTheDocument();
    expect(await screen.findByText('Questo percorso non c’è: forse è stato eliminato.')).toBeInTheDocument();
  });

  it('opens a module\'s session at /learn/percorsi/:id/moduli/:moduloId in the lesson\'s frame, over the area (§6.5)', async () => {
    features.lingoCourses = true;
    renderAt('/learn/percorsi/c1/moduli/m1');
    expect(await screen.findByTestId('lesson-frame')).toBeInTheDocument();
    expect(await screen.findByText('Questo modulo non c’è più: forse è stato eliminato.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Percorsi' })).toBeNull();
  });

  it('with the switch off, /learn/percorsi goes back to Oggi', async () => {
    features.lingoCourses = false;
    renderAt('/learn/percorsi');
    expect(await screen.findByRole('heading', { name: 'Ripasso di oggi' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/learn/ripasso');
    features.lingoCourses = true;
  });

  it('keeps a card’s address inside the Studia area', async () => {
    renderAt('/learn/schede/k1');
    expect(await screen.findByRole('heading', { name: 'Le mie schede' })).toBeInTheDocument();
  });

  it('opens «Da validare» at /learn/valida', async () => {
    renderAt('/learn/valida');
    expect(await screen.findByRole('heading', { name: 'Da validare' })).toBeInTheDocument();
    expect(await screen.findByText('Nessuna scheda da validare')).toBeInTheDocument();
  });

  it('is the 404 page when VITE_FEATURE_STUDIA is off', async () => {
    vi.stubEnv('VITE_FEATURE_STUDIA', 'false');
    renderAt('/learn');
    expect(await screen.findByText('Pagina non trovata')).toBeInTheDocument();
  });
});

// D-235: the addresses took their sections' names; an old one (a bookmark, a shared link, a link the server still
// writes) lands on the new one, keeping the rest of the path, the query and the anchor, and replacing itself.
describe('App routing — old addresses', () => {
  it.each([
    ['/opus', '/work/scadenziario', '', '', { heading: 'Scadenziario' }],
    ['/work/oggi?vista=2#t1', '/work/scadenziario', '?vista=2', '#t1', { heading: 'Scadenziario' }],
    ['/work/anonimizzatore?x=1#y', '/work/pseudonimizzatore', '?x=1', '#y', { testId: 'opus-page' }],
    ['/opus/prossimi?vista=2#t1', '/work/prossimi', '?vista=2', '#t1', { heading: 'Prossimi giorni' }],
    ['/opus/cestino', '/work/cestino', '', '', { heading: 'Cestino' }],
    ['/studia', '/learn/ripasso', '', '', { heading: 'Ripasso di oggi' }],
    ['/studia/ripasso/sessione?materia=DIRITTO_CIVILE#c', '/learn/ripasso/sessione', '?materia=DIRITTO_CIVILE', '#c', { heading: 'Sessione di ripasso' }],
    ['/studia/percorsi', '/learn/percorsi', '', '', { heading: 'Percorsi' }],
    ['/studia/schede/k1#art', '/learn/schede/k1', '', '#art', { heading: 'Le mie schede' }],
    ['/merlt', '/labs', '', '', { testId: 'merlt-hub' }],
    ['/merlt/contribuisci?documentId=d1', '/labs/contribuisci', '?documentId=d1', '', { testId: 'contrib-page' }],
    ['/merlt/valida', '/labs/valida', '', '', { testId: 'validation-page' }],
    ['/grafo?urn=urn%3Anir&depth=2#n1', '/labs/grafo', '?urn=urn%3Anir&depth=2', '#n1', { testId: 'graph-explorer' }],
    ['/merlt/qa?x=1#y', '/labs/grafo', '?x=1', '#y', { testId: 'graph-explorer' }],
    ['/merlt/chiedi', '/labs/grafo', '', '', { testId: 'graph-explorer' }],
  ])('sends %s to %s', async (old, pathname, search, hash, page) => {
    const before = window.history.length;
    renderAt(old);
    if ('heading' in page) expect(await screen.findByRole('heading', { name: page.heading })).toBeInTheDocument();
    else expect(await screen.findByTestId(page.testId)).toBeInTheDocument();
    expect(window.location.pathname).toBe(pathname);
    expect(window.location.search).toBe(search);
    expect(window.location.hash).toBe(hash);
    // Replaced, not pushed: «back» leaves the page instead of landing on the old address again.
    expect(window.history.length).toBe(before + 1);
  });

  it('keeps an old shared link\'s ?import=', async () => {
    renderAt('/studia/percorsi/c1?import=abc');
    expect(await screen.findByText('Questo percorso non c’è: forse è stato eliminato.')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/learn/percorsi/c1');
    expect(window.location.search).toBe('?import=abc');
  });

  it('leaves look-alike addresses alone', async () => {
    renderAt('/opuscolo');
    expect(await screen.findByRole('heading', { level: 1, name: 'Pagina non trovata' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/opuscolo');
  });
});
