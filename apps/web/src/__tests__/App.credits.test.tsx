import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Signed out, with the real ProtectedRoute: the credits must open, the app must not.
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: false, loading: false, devMode: false }),
}));
vi.mock('../features/merlt/consent/ConsentContext', () => ({
  ConsentProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../components/layout/Layout', () => ({ Layout: () => <div data-testid="layout" /> }));
vi.mock('../pages/SearchPage', () => ({ SearchPage: () => <div /> }));
vi.mock('../pages/LoginPage', () => ({ LoginPage: () => <div data-testid="login" /> }));
vi.mock('../pages/RegisterPage', () => ({ RegisterPage: () => <div /> }));
vi.mock('../components/features/dossier/DossierPage', () => ({ DossierPage: () => <div /> }));
vi.mock('../components/features/history/HistoryView', () => ({ HistoryView: () => <div /> }));
vi.mock('../components/features/bulletin/BulletinBoardPage', () => ({ BulletinBoardPage: () => <div /> }));

import App from '../App';

describe('App routing — /crediti', () => {
  it('opens the credits without signing in', async () => {
    window.history.pushState({}, '', '/crediti');
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Crediti' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/crediti');
    expect(screen.queryByTestId('login')).toBeNull();
  });

  it('still sends a signed-out reader of the app to the login', async () => {
    window.history.pushState({}, '', '/dossier');
    render(<App />);
    expect(await screen.findByTestId('login')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
  });
});
