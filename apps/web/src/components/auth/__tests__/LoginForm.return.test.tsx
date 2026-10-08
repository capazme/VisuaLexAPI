import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const login = vi.fn();
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ login, loading: false, error: null }) }));

import { LoginForm } from '../LoginForm';

function Probe() {
  const l = useLocation();
  return <output data-testid="landed">{l.pathname + l.search + l.hash}</output>;
}

function renderLogin(state?: unknown) {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/login', state }]}>
      <Routes>
        <Route path="/login" element={<LoginForm />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByPlaceholderText('name@company.com'), { target: { value: 'a@b.it' } });
  fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
}

beforeEach(() => { login.mockReset().mockResolvedValue(undefined); sessionStorage.clear(); });

describe('LoginForm: where the reader lands', () => {
  it('back on the whole address a protected route saved, query included', async () => {
    renderLogin({ from: { pathname: '/sentenze/cassazione/99999/2024', search: '?sezione=3', hash: '' } });
    await waitFor(() => expect(screen.getByTestId('landed').textContent).toBe('/sentenze/cassazione/99999/2024?sezione=3'));
  });

  it('back on the address stashed when the session ended, and the stash is spent', async () => {
    sessionStorage.setItem('vlx:return-to', '/?norma=abc');
    renderLogin();
    await waitFor(() => expect(screen.getByTestId('landed').textContent).toBe('/?norma=abc'));
    expect(sessionStorage.getItem('vlx:return-to')).toBeNull();
  });

  it('never on a foreign address', async () => {
    sessionStorage.setItem('vlx:return-to', '//evil.example/x');
    renderLogin();
    await waitFor(() => expect(screen.getByTestId('landed').textContent).toBe('/'));
  });
});
