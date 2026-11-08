import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: false, loading: false, devMode: false }) }));
vi.mock('../components/layout/Layout', () => ({ Layout: () => <div data-testid="layout" /> }));
vi.mock('../pages/SearchPage', () => ({ SearchPage: () => <div /> }));
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

describe('App — «Crediti» opened by its address (P1)', () => {
  it('keeps the splash of index.html until the page is there, no empty screen meanwhile', async () => {
    window.history.pushState({}, '', '/crediti');
    // The root as index.html serves it: the splash inside, until React draws.
    const root = document.createElement('div');
    root.innerHTML = '<div class="vlx-splash" role="status" aria-label="Caricamento di VisuaLex"></div>';
    document.body.append(root);
    render(<App />, { container: root });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('status', { name: 'Caricamento di VisuaLex' })).toBeInTheDocument();
    await act(async () => { credits.arrive(); });
    expect(await screen.findByRole('heading', { level: 1, name: 'Crediti' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Caricamento di VisuaLex' })).toBeNull();
  });
});
