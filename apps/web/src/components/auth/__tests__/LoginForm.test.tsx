import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';

const login = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ login, loading: false, error: null }),
}));

import { renderAuth } from './renderAuth';

/** The form on screen: the sign-up form stays mounted beside it, hidden. */
const form = () => within(screen.getByRole('tabpanel'));

describe('LoginForm', () => {
  it('returns to the page that sent the user to sign in, query included', async () => {
    // The consent page carries its request in the query (/connect?request=…):
    // losing it on the way through the login would strand the sign-in.
    renderAuth({ pathname: '/login', state: { from: { pathname: '/connect', search: '?request=req-1' } } });
    fireEvent.change(form().getByLabelText(/email/i), { target: { value: 'a@b.it' } });
    fireEvent.change(form().getByLabelText(/^password$/i), { target: { value: 'secret' } });
    fireEvent.submit(form().getByLabelText(/email/i).closest('form')!);
    await waitFor(() => expect(screen.getByTestId('landed')).toHaveTextContent('/connect?request=req-1'), { timeout: 2000 });
  });

  it('shows the book tracing itself between a successful sign-in and the app', async () => {
    renderAuth('/login');
    fireEvent.change(form().getByLabelText(/email/i), { target: { value: 'a@b.it' } });
    fireEvent.change(form().getByLabelText(/^password$/i), { target: { value: 'secret' } });
    fireEvent.submit(form().getByLabelText(/email/i).closest('form')!);
    expect(await screen.findByRole('status', { name: 'Accesso a VisuaLex' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('landed')).toHaveTextContent('/'), { timeout: 2000 });
  });

  it('keeps the colophon to the mark, the name and the sentence: no list of sources, Brocardi least of all', () => {
    renderAuth('/login');
    const colophon = screen.getByRole('banner');
    expect(within(colophon).getByRole('heading', { level: 1, name: 'VisuaLex' })).toBeInTheDocument();
    expect(within(colophon).queryByRole('list')).toBeNull();
    expect(document.body).not.toHaveTextContent(/Normattiva · EUR-Lex|Corte di giustizia|schede di ripasso/);
    expect(document.body).not.toHaveTextContent(/brocardi/i);
  });

  it('links the credits from its foot, readable before signing in', () => {
    renderAuth('/login');
    const link = within(screen.getByRole('contentinfo')).getByRole('link', { name: 'Crediti' });
    expect(link).toHaveAttribute('href', '/crediti');
  });

  it('puts the focus on the field an error names', () => {
    renderAuth('/login');
    fireEvent.change(form().getByLabelText(/email/i), { target: { value: 'a@b.it' } });
    fireEvent.submit(form().getByLabelText(/email/i).closest('form')!);
    const password = form().getByLabelText(/^password$/i);
    expect(screen.getByRole('alert')).toHaveTextContent('Inserisci email e password.');
    expect(password).toHaveFocus();
    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(password).toHaveAttribute('aria-describedby', 'login-error');
  });

  it('puts the focus back on the password when the server refuses it', async () => {
    login.mockRejectedValueOnce(new Error('Credenziali non valide'));
    renderAuth('/login');
    fireEvent.change(form().getByLabelText(/email/i), { target: { value: 'a@b.it' } });
    fireEvent.change(form().getByLabelText(/^password$/i), { target: { value: 'wrong' } });
    fireEvent.submit(form().getByLabelText(/email/i).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Credenziali non valide');
    expect(form().getByLabelText(/^password$/i)).toHaveFocus();
  });
});
