import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ login: vi.fn(), loading: false, error: null }) }));
const register = vi.fn();
vi.mock('../../../services/authService', () => ({ register: (...args: unknown[]) => register(...args) }));

import { renderAuth } from './renderAuth';

const panel = () => screen.getByRole('tabpanel');

function fill(values: { email?: string; username?: string; password?: string; confirm?: string }) {
  const p = within(panel());
  if (values.email !== undefined) fireEvent.change(p.getByLabelText('Email'), { target: { value: values.email } });
  if (values.username !== undefined) fireEvent.change(p.getByLabelText('Username'), { target: { value: values.username } });
  if (values.password !== undefined) fireEvent.change(p.getByLabelText('Password'), { target: { value: values.password } });
  if (values.confirm !== undefined) fireEvent.change(p.getByLabelText('Conferma password'), { target: { value: values.confirm } });
}

const submit = () => fireEvent.submit(within(panel()).getByLabelText('Email').closest('form')!);

beforeEach(() => register.mockReset().mockResolvedValue({ message: 'ok' }));

describe('RegisterForm', () => {
  it('calls register with the same data as before', async () => {
    renderAuth('/register');
    fill({ email: 'avv@studio.it', username: 'avv_rossi', password: 'Segreta123', confirm: 'Segreta123' });
    submit();
    await waitFor(() => expect(register).toHaveBeenCalledWith({ email: 'avv@studio.it', username: 'avv_rossi', password: 'Segreta123' }));
  });

  it('keeps its checks and messages, and puts the focus on the field at fault', () => {
    renderAuth('/register');
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Tutti i campi sono obbligatori');
    expect(within(panel()).getByLabelText('Email')).toHaveFocus();

    fill({ email: 'avv@studio', username: 'avv_rossi', password: 'abc', confirm: 'abc' });
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Formato email non valido');
    expect(within(panel()).getByLabelText('Email')).toHaveFocus();

    fill({ email: 'avv@studio.it', password: 'ab', confirm: 'ab' });
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Password deve essere almeno 3 caratteri');
    expect(within(panel()).getByLabelText('Password')).toHaveFocus();

    fill({ username: 'av', password: 'abc', confirm: 'abc' });
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Username deve essere almeno 3 caratteri');
    expect(within(panel()).getByLabelText('Username')).toHaveFocus();

    fill({ username: 'avv-rossi' });
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Username può contenere solo lettere, numeri e underscore');

    fill({ username: 'avv_rossi', confirm: 'abd' });
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Le password non coincidono');
    const confirm = within(panel()).getByLabelText('Conferma password');
    expect(confirm).toHaveFocus();
    expect(confirm).toHaveAttribute('aria-invalid', 'true');
    expect(confirm).toHaveAttribute('aria-describedby', 'register-error');
    expect(register).not.toHaveBeenCalled();
  });

  it('says why the server refused, with the focus back on the first field', async () => {
    register.mockRejectedValueOnce(new Error('User with this email or username already exists'));
    renderAuth('/register');
    fill({ email: 'avv@studio.it', username: 'avv_rossi', password: 'Segreta123', confirm: 'Segreta123' });
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
    await waitFor(() => expect(within(panel()).getByLabelText('Email')).toHaveFocus());
  });

  it('shows one eye for both password fields, a 44 px button with its name', () => {
    renderAuth('/register');
    const eye = within(panel()).getByRole('button', { name: 'Mostra la password' });
    expect(eye.className).toContain('h-11');
    expect(eye.className).toContain('w-11');
    fireEvent.click(eye);
    expect(within(panel()).getByLabelText('Password')).toHaveAttribute('type', 'text');
    expect(within(panel()).getByLabelText('Conferma password')).toHaveAttribute('type', 'text');
    expect(within(panel()).getByRole('button', { name: 'Nascondi la password' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('names the strength of the password in words', () => {
    renderAuth('/register');
    fill({ password: 'Segreta123' });
    expect(within(panel()).getByRole('img', { name: 'Sicurezza della password: forte' })).toBeInTheDocument();
  });

  it('after signing up, the wait for approval in the same card, and «Torna ad Accedi» back to the tab', async () => {
    renderAuth('/register');
    fill({ email: 'avv@studio.it', username: 'avv_rossi', password: 'Segreta123', confirm: 'Segreta123' });
    // Where the focus is the moment the confirmation enters the page: what `findByRole` sees when it finds it (its
    // MutationObserver fires in a microtask after React's commit). The focus must already be there, not on the body.
    let focusWhenShown: Element | null | undefined;
    const observer = new MutationObserver(() => {
      if (focusWhenShown === undefined && screen.queryByRole('heading', { name: 'Registrazione completata' })) focusWhenShown = document.activeElement;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    submit();
    const heading = await screen.findByRole('heading', { name: 'Registrazione completata' });
    observer.disconnect();
    expect(focusWhenShown).toBe(heading);
    expect(heading).toHaveFocus();
    expect(within(panel()).getByText('È in attesa di approvazione da parte di un amministratore.')).toBeInTheDocument();
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Torna ad Accedi' }));
    expect(screen.getByTestId('address')).toHaveTextContent('/login');
    expect(screen.getByRole('tab', { name: 'Accedi' })).toHaveAttribute('aria-selected', 'true');
    expect(within(panel()).getByLabelText('Email')).toHaveFocus();
  });

  it('back on «Registrati» after signing up, an empty form, not the confirmation again', async () => {
    renderAuth('/register');
    fill({ email: 'avv@studio.it', username: 'avv_rossi', password: 'Segreta123', confirm: 'Segreta123' });
    submit();
    await screen.findByRole('heading', { name: 'Registrazione completata' });
    fireEvent.click(screen.getByRole('tab', { name: 'Accedi' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Registrati' }));
    expect(screen.queryByRole('heading', { name: 'Registrazione completata' })).toBeNull();
    expect(within(panel()).getByLabelText('Email')).toHaveValue('');
    expect(within(panel()).getByLabelText('Username')).toHaveValue('');
    expect(within(panel()).getByLabelText('Email')).toHaveFocus();
  });

  it('draws nothing of the old design: no blurred blots, glass or gradient', () => {
    const { container } = renderAuth('/register');
    expect(container.innerHTML).not.toMatch(/blur-3xl|backdrop-blur|bg-gradient|from-blue|to-indigo/);
  });
});
