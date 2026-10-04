import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const login = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ login, loading: false, error: null }),
}));

import { LoginForm } from '../LoginForm';

function Landed() {
  const location = useLocation();
  return <p data-testid="landed">{`${location.pathname}${location.search}`}</p>;
}

describe('LoginForm', () => {
  it('returns to the page that sent the user to sign in, query included', async () => {
    // The consent page carries its request in the query (/connect?request=…):
    // losing it on the way through the login would strand the sign-in.
    render(
      <MemoryRouter
        initialEntries={[{ pathname: '/login', state: { from: { pathname: '/connect', search: '?request=req-1' } } }]}
      >
        <Routes>
          <Route path="/login" element={<LoginForm />} />
          <Route path="/connect" element={<Landed />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.it' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'secret' } });
    fireEvent.submit(screen.getByLabelText(/email/i).closest('form')!);
    await waitFor(() => expect(screen.getByTestId('landed')).toHaveTextContent('/connect?request=req-1'));
  });
});
