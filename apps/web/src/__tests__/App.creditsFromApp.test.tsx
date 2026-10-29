import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('../components/auth/ProtectedRoute', () => ({ ProtectedRoute: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../features/merlt/consent/ConsentContext', () => ({ ConsentProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true, loading: false, devMode: false }) }));
// The layout, with the user menu's way to «Crediti».
vi.mock('../components/layout/Layout', async () => {
  const { Link, Outlet } = await import('react-router-dom');
  return { Layout: () => <div data-testid="layout"><Link to="/crediti">Crediti</Link><Outlet /></div> };
});
vi.mock('../pages/SearchPage', () => ({ SearchPage: () => <div data-testid="search-page" /> }));
vi.mock('../pages/AuthPage', () => ({ AuthPage: () => <div /> }));
// «Crediti»'s code, held until the test lets it arrive.
const credits = vi.hoisted(() => {
  let open = () => {};
  const arrival = new Promise<void>((resolve) => { open = resolve; });
  return { arrival, arrive: () => open() };
});
vi.mock('../pages/CreditsPage', async () => {
  await credits.arrival;
  return { CreditsPage: () => <h1>Crediti</h1> };
});

import App from '../App';

describe('App — «Crediti» opened from the app (P1)', () => {
  it('keeps the screen it leaves until the page is there, no empty screen meanwhile', async () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(await screen.findByTestId('search-page')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Crediti' }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('layout')).toBeInTheDocument();
    expect(screen.getByTestId('search-page')).toBeInTheDocument();
    await act(async () => { credits.arrive(); });
    expect(await screen.findByRole('heading', { level: 1, name: 'Crediti' })).toBeInTheDocument();
    expect(screen.queryByTestId('layout')).toBeNull();
  });
});
