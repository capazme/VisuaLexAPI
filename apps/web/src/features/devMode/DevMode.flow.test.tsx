import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../services/api', () => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('../../hooks/useForumNotifications', () => ({
  useForumNotifications: () => ({ count: { total: 0, normaChanges: 0 }, markRead: vi.fn(), refetch: vi.fn() }),
}));
vi.mock('../connections', () => ({ ConnectedAppsSection: () => null }));
vi.mock('../../services/accountService', () => ({ accountService: {} }));

import { get, post, put } from '../../services/api';
import * as authService from '../../services/authService';
import { Sidebar } from '../../components/layout/Sidebar';
import { SettingsModal } from '../../components/ui/SettingsModal';
import { DevRoute } from './DevRoute';
import { appStore } from '../../store/useAppStore';

const user = (on: boolean) => ({
  id: 'u1', username: 'alice', email: 'a@test.local', is_active: true, is_verified: true, is_admin: false,
  dev_mode_allowed: true, dev_mode: on, created_at: '2026-10-01T10:00:00Z',
});

beforeEach(async () => {
  appStore.setState({ isDataLoaded: true });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  vi.mocked(post).mockResolvedValueOnce({ access_token: 'a', refresh_token: 'r' });
  await authService.login({ email: 'a@test.local', password: 'x' });
  vi.mocked(get).mockReset().mockResolvedValue(user(false));
  vi.mocked(put).mockReset();
});

// The Sidebar, the page behind a development address and the Settings each ask useAuth on their own.
describe('the development mode, end to end in the web', () => {
  it('turned on in Impostazioni, shows Grafo and opens the development page at once; off, it takes both away', async () => {
    render(
      <MemoryRouter initialEntries={['/grafo']}>
        <Sidebar theme="light" isOpen closeMobile={vi.fn()} openSettings={vi.fn()} openKeyboardShortcuts={vi.fn()} toggleTheme={vi.fn()} />
        <SettingsModal isOpen onClose={vi.fn()} />
        <Routes>
          <Route path="/" element={<p>Pagina di ricerca</p>} />
          <Route path="/grafo" element={<DevRoute><p>Pagina del grafo</p></DevRoute>} />
        </Routes>
      </MemoryRouter>,
    );
    // Without the mode the address redirects, and the sidebar has no Grafo.
    expect(await screen.findByText('Pagina di ricerca')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Grafo' })).toBeNull();

    vi.mocked(put).mockResolvedValueOnce(user(true));
    const toggle = await screen.findByRole('switch', { name: 'Modalità sviluppo' });
    await act(async () => { fireEvent.click(toggle); });

    const grafo = await screen.findByRole('link', { name: 'Grafo' });
    expect(put).toHaveBeenCalledWith('/auth/dev-mode', { enabled: true });
    expect(screen.getByRole('switch', { name: 'Modalità sviluppo' })).toHaveAttribute('aria-checked', 'true');
    // No reload: /auth/me was asked once.
    expect(get).toHaveBeenCalledTimes(1);

    // The page that redirected a moment ago opens.
    fireEvent.click(grafo);
    expect(await screen.findByText('Pagina del grafo')).toBeInTheDocument();

    vi.mocked(put).mockResolvedValueOnce(user(false));
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Modalità sviluppo' })); });
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Grafo' })).toBeNull());
    // Off again on the page itself: it leaves for the search page.
    expect(await screen.findByText('Pagina di ricerca')).toBeInTheDocument();
  });
});
