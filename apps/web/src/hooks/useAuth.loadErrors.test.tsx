import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// D7b's flag: off here, with no request leaving the test.
vi.mock('../services/assistantService', () => ({ assistantService: { features: vi.fn(async () => ({ assistantPassages: false })) } }));
vi.mock('../services/authService', () => ({
  isAuthenticated: vi.fn(() => true),
  logout: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  getCurrentUser: vi.fn(),
}));

import * as authService from '../services/authService';
import { appStore } from '../store/useAppStore';
import { useAuth } from './useAuth';
import { ProtectedRoute } from '../components/auth/ProtectedRoute';

const me = {
  id: 'u1', username: 'alice', email: 'a@test.local', is_active: true, is_verified: true, is_admin: false,
  created_at: '2026-10-01T10:00:00Z',
};
// What the axios interceptor in `api.ts` rejects with: a plain object, not an AxiosError.
const answered = (status: number) => ({ status, message: `HTTP ${status}`, data: undefined });
const noAnswer = { status: undefined, message: 'Network Error', data: undefined };

/** Lets the pending promises and every retry pause run out. */
const settle = (ms = 60_000) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(authService.isAuthenticated).mockReset().mockReturnValue(true);
  vi.mocked(authService.getCurrentUser).mockReset();
  appStore.setState({ isDataLoaded: true });
});
afterEach(() => vi.useRealTimers());

describe('useAuth — a failed /auth/me on load (LC13)', () => {
  it.each([
    ['a 429', answered(429)],
    ['a 500', answered(500)],
    ['no answer (network, timeout)', noAnswer],
  ])('keeps the session on %s: loading while it retries, then signed in without a user', async (_, failure) => {
    vi.mocked(authService.getCurrentUser).mockRejectedValue(failure);
    const { result } = renderHook(() => useAuth());

    await settle(500);
    expect(result.current.loading).toBe(true);
    expect(result.current.isAuthenticated).toBe(true);

    await settle();
    expect(result.current.loading).toBe(false);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toBeNull();
    expect(vi.mocked(authService.getCurrentUser).mock.calls.length).toBeGreaterThan(1);
  });

  it.each([401, 403])('signs out on a %s, at once and without retrying', async (status) => {
    vi.mocked(authService.getCurrentUser).mockRejectedValue(answered(status));
    const { result } = renderHook(() => useAuth());

    await settle(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.isAuthenticated).toBe(false);
    await settle();
    expect(authService.getCurrentUser).toHaveBeenCalledTimes(1);
  });

  it('signs out when the token is gone, whatever the error (a refused refresh already ended the session)', async () => {
    vi.mocked(authService.getCurrentUser).mockImplementation(async () => {
      vi.mocked(authService.isAuthenticated).mockReturnValue(false);
      throw new Error('No refresh token');
    });
    const { result } = renderHook(() => useAuth());

    await settle(0);
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('signs out when the token goes during a retry pause', async () => {
    vi.mocked(authService.getCurrentUser).mockRejectedValue(answered(429));
    const { result } = renderHook(() => useAuth());

    await settle(500);
    expect(result.current.isAuthenticated).toBe(true);
    vi.mocked(authService.isAuthenticated).mockReturnValue(false);
    await settle();
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(authService.getCurrentUser).toHaveBeenCalledTimes(1);
  });

  it('has the user once a retry after a 429 is answered', async () => {
    vi.mocked(authService.getCurrentUser).mockRejectedValueOnce(answered(429)).mockResolvedValue(me as never);
    const { result } = renderHook(() => useAuth());

    await settle();
    expect(result.current.loading).toBe(false);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.id).toBe('u1');
  });
});

describe('ProtectedRoute — a failed /auth/me on load (LC13)', () => {
  const app = () =>
    render(
      <MemoryRouter initialEntries={['/app']}>
        <Routes>
          <Route path="/login" element={<p>Pagina di accesso</p>} />
          <Route path="/app" element={<ProtectedRoute><p>Contenuto</p></ProtectedRoute>} />
        </Routes>
      </MemoryRouter>
    );

  it.each([
    ['a 429', answered(429)],
    ['a 500', answered(500)],
    ['no answer', noAnswer],
  ])('does not send the reader to /login on %s, and says the session is kept once the retries are over', async (_, failure) => {
    vi.mocked(authService.getCurrentUser).mockRejectedValue(failure);
    app();

    await settle(500);
    expect(screen.queryByText('Pagina di accesso')).toBeNull();
    expect(screen.getByRole('status', { name: 'Caricamento di LexCraft' })).toBeTruthy();

    await settle();
    expect(screen.queryByText('Pagina di accesso')).toBeNull();
    expect(screen.queryByText('Contenuto')).toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/La sessione resta aperta/);
    expect(screen.getByRole('button', { name: 'Riprova' })).toBeTruthy();
  });

  it.each([401, 403])('sends the reader to /login on a %s, as before', async (status) => {
    vi.mocked(authService.getCurrentUser).mockRejectedValue(answered(status));
    app();

    await settle(0);
    expect(screen.getByText('Pagina di accesso')).toBeTruthy();
  });

  it('shows the page once a retry after a 429 is answered', async () => {
    vi.mocked(authService.getCurrentUser).mockRejectedValueOnce(answered(429)).mockResolvedValue(me as never);
    app();

    await settle();
    expect(screen.getByText('Contenuto')).toBeTruthy();
  });
});
