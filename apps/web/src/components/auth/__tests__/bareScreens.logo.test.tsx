import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const auth = vi.hoisted(() => ({ isAuthenticated: true, isAdmin: false, loading: false, retrying: false, user: { id: 'u1' } as unknown }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => auth }));

import { SessionKeptUnreachable } from '../ProtectedRoute';
import { AdminRoute } from '../AdminRoute';

// The screens drawn without the shell (LC16 A6): the still logo heads them, so none is a page with no name on it.
describe('the screens without the shell carry the LexCraft logo, still', () => {
  it('«Connessione al server non riuscita…» (the account not read)', () => {
    render(<SessionKeptUnreachable />);
    const logo = screen.getByRole('img', { name: 'LexCraft' });
    expect(logo).toHaveClass('vlx-logo');
    expect(logo.getAttribute('class')).not.toMatch(/vlx-logo-(sweep|intro)/);
    // Over the message, not inside the alert a reader hears.
    expect(within(screen.getByRole('alert')).queryByRole('img')).toBeNull();
  });

  it('«Accesso Negato»', () => {
    render(
      <MemoryRouter>
        <AdminRoute>
          <p>admin</p>
        </AdminRoute>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Accesso Negato' })).toBeInTheDocument();
    const logo = screen.getByRole('img', { name: 'LexCraft' });
    expect(logo.getAttribute('class')).not.toMatch(/vlx-logo-(sweep|intro)/);
  });

  it('the admin pages wait as every page does: the column, and «Il server non risponde, riprovo…» while it retries (#463)', () => {
    auth.loading = true;
    auth.retrying = true;
    try {
      render(
        <MemoryRouter>
          <AdminRoute>
            <p>admin</p>
          </AdminRoute>
        </MemoryRouter>,
      );
      expect(screen.getByRole('status', { name: 'Caricamento di LexCraft' })).toBeInTheDocument();
      expect(screen.getByText('Il server non risponde, riprovo…')).toBeInTheDocument();
    } finally {
      auth.loading = false;
      auth.retrying = false;
    }
  });
});
