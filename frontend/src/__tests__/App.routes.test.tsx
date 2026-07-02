import { describe, it, expect, vi, beforeEach } from 'vitest';
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
vi.mock('../components/features/environments/EnvironmentPage', () => ({ EnvironmentPage: () => <div /> }));
vi.mock('../components/features/bulletin/BulletinBoardPage', () => ({ BulletinBoardPage: () => <div /> }));
// Lazy-loaded pages (vi.mock also intercepts dynamic import()).
vi.mock('../pages/AdminPage', () => ({ AdminPage: () => <div /> }));
vi.mock('../pages/MerltHubPage', () => ({ MerltHubPage: () => <div data-testid="merlt-hub" /> }));
vi.mock('../features/merlt/graph/page/GraphExplorerPage', () => ({
  GraphExplorerPage: () => <div data-testid="graph-explorer" />,
}));
vi.mock('../features/merlt/contrib/ContribPage', () => ({ ContribPage: () => <div /> }));
vi.mock('../features/merlt/validate/ValidationPage', () => ({ ValidationPage: () => <div /> }));
vi.mock('../features/merlt/qa/QAPage', () => ({ QAPage: () => <div data-testid="qa-page" /> }));

import App from '../App';

function renderAt(path: string) {
  window.history.pushState({}, '', path);
  return render(<App />);
}

beforeEach(() => {
  window.history.pushState({}, '', '/');
});

describe('App routing', () => {
  it('redirects the legacy /merlt/chiedi path to /merlt/qa', async () => {
    renderAt('/merlt/chiedi');
    expect(await screen.findByTestId('qa-page')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/merlt/qa');
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
});
