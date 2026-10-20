import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

const login = vi.fn();
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ login, loading: false, error: null }) }));

import { renderAuth } from './renderAuth';

function renderLogin(state?: unknown) {
  renderAuth({ pathname: '/login', state });
  fireEvent.change(screen.getByPlaceholderText('nome@studio.it'), { target: { value: 'a@b.it' } });
  fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: /^accedi$/i }));
}

beforeEach(() => { login.mockReset().mockResolvedValue(undefined); sessionStorage.clear(); });

describe('LoginForm: where the reader lands', () => {
  it('back on the whole address a protected route saved, query included', async () => {
    renderLogin({ from: { pathname: '/sentenze/cassazione/99999/2024', search: '?sezione=3', hash: '' } });
    await waitFor(() => expect(screen.getByTestId('landed').textContent).toBe('/sentenze/cassazione/99999/2024?sezione=3'), { timeout: 2000 });
  });

  it('back on the address stashed when the session ended, and the stash is spent', async () => {
    sessionStorage.setItem('vlx:return-to', '/?norma=abc');
    renderLogin();
    await waitFor(() => expect(screen.getByTestId('landed').textContent).toBe('/?norma=abc'), { timeout: 2000 });
    expect(sessionStorage.getItem('vlx:return-to')).toBeNull();
  });

  it('never back on the sign-up tab, which would leave the entrance on screen', async () => {
    sessionStorage.setItem('vlx:return-to', '/register');
    renderLogin();
    await waitFor(() => expect(screen.getByTestId('landed').textContent).toBe('/'), { timeout: 2000 });
  });

  it('never on a foreign address', async () => {
    sessionStorage.setItem('vlx:return-to', '//evil.example/x');
    renderLogin();
    await waitFor(() => expect(screen.getByTestId('landed').textContent).toBe('/'), { timeout: 2000 });
  });
});
