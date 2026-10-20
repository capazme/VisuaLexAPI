import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';

const login = vi.fn();
let authLoading = false;
let authError: string | null = null;
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ login, loading: authLoading, error: authError }) }));
const register = vi.fn();
vi.mock('../../../services/authService', () => ({ register: (...args: unknown[]) => register(...args) }));

import { renderAuth } from './renderAuth';

const address = () => screen.getByTestId('address');
const tab = (name: 'Accedi' | 'Registrati') => screen.getByRole('tab', { name });
/** The panel a reader can use: the one leaving is hidden from them. */
const panel = () => screen.getByRole('tabpanel');
const allPanels = () => document.querySelectorAll('[role="tabpanel"]');

function reduceMotion(reduce: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

beforeEach(() => {
  login.mockReset().mockResolvedValue(undefined);
  authLoading = false;
  authError = null;
  register.mockReset().mockResolvedValue({ message: 'ok' });
  sessionStorage.clear();
  reduceMotion(false);
});
afterEach(() => vi.restoreAllMocks());

describe('AuthPage: two tabs on one page', () => {
  it('opens «Accedi» from /login', () => {
    renderAuth('/login');
    expect(screen.getByRole('tablist', { name: 'Accedi o registrati' })).toBeInTheDocument();
    expect(tab('Accedi')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Registrati')).toHaveAttribute('aria-selected', 'false');
    expect(panel()).toHaveAttribute('aria-labelledby', 'auth-tab-login');
    expect(tab('Accedi')).toHaveAttribute('aria-controls', 'auth-panel-login');
    expect(within(panel()).getByRole('button', { name: 'Accedi' })).toBeInTheDocument();
  });

  it('opens «Registrati» from /register', () => {
    renderAuth('/register');
    expect(tab('Registrati')).toHaveAttribute('aria-selected', 'true');
    expect(panel()).toHaveAttribute('aria-labelledby', 'auth-tab-register');
    expect(within(panel()).getByRole('button', { name: 'Crea account' })).toBeInTheDocument();
  });

  it('keeps one tab in the Tab order, the selected one', () => {
    renderAuth('/login');
    expect(tab('Accedi')).toHaveAttribute('tabindex', '0');
    expect(tab('Registrati')).toHaveAttribute('tabindex', '-1');
  });

  it('a click changes tab and address in place, replacing the entry, and puts the cursor in the first field', async () => {
    renderAuth('/login', ['/']);
    const page = screen.getByRole('main');
    fireEvent.click(tab('Registrati'));
    expect(address()).toHaveTextContent('/register');
    expect(address()).toHaveAttribute('data-navigation', 'REPLACE');
    expect(screen.getByRole('main')).toBe(page); // the same page, not a new one
    expect(tab('Registrati')).toHaveAttribute('aria-selected', 'true');
    expect(within(panel()).getByLabelText('Email')).toHaveFocus();
    expect(screen.queryByTestId('landed')).toBeNull();
  });

  it('a click on the tab already open puts the cursor in its first field', () => {
    renderAuth('/register');
    fireEvent.click(tab('Registrati'));
    expect(within(panel()).getByLabelText('Email')).toHaveFocus();
    expect(allPanels()).toHaveLength(1);
  });

  it('the arrows, Home and End change tab and keep the focus on the tabs', () => {
    renderAuth('/login');
    tab('Accedi').focus();
    fireEvent.keyDown(tab('Accedi'), { key: 'ArrowRight' });
    expect(address()).toHaveTextContent('/register');
    expect(tab('Registrati')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Registrati')).toHaveFocus();
    fireEvent.keyDown(tab('Registrati'), { key: 'ArrowLeft' });
    expect(address()).toHaveTextContent('/login');
    expect(tab('Accedi')).toHaveFocus();
    fireEvent.keyDown(tab('Accedi'), { key: 'End' });
    expect(tab('Registrati')).toHaveFocus();
    fireEvent.keyDown(tab('Registrati'), { key: 'Home' });
    expect(tab('Accedi')).toHaveFocus();
    expect(address()).toHaveAttribute('data-navigation', 'REPLACE');
  });

  it('«Non hai un account? Registrati» and «Hai già un account? Accedi» change tab, not page', async () => {
    renderAuth('/login');
    fireEvent.click(within(panel()).getByRole('button', { name: 'Registrati' }));
    expect(address()).toHaveTextContent('/register');
    await waitFor(() => expect(allPanels()).toHaveLength(1));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Accedi' }));
    expect(address()).toHaveTextContent('/login');
    expect(within(panel()).getByLabelText('Email')).toHaveFocus();
  });

  it('slides the mark under the tabs with a transform', () => {
    renderAuth('/login');
    const mark = screen.getByTestId('auth-tab-mark');
    expect(mark.style.transform).toBe('translateX(0)');
    expect(mark.className).toContain('transition-transform');
    fireEvent.click(tab('Registrati'));
    expect(mark.style.transform).toBe('translateX(100%)');
  });

  it('fades the form out while the next one comes in from the side of its tab, then drops it', async () => {
    renderAuth('/login');
    expect(panel().className).not.toContain('animate-in'); // the first paint does not move
    fireEvent.click(tab('Registrati'));
    const leaving = document.querySelector('[data-leaving]');
    expect(leaving).toHaveAttribute('id', 'auth-panel-login');
    expect(leaving).toHaveAttribute('aria-hidden', 'true');
    expect(leaving).toHaveAttribute('inert');
    expect(leaving?.className).toContain('opacity-0');
    expect(panel().className).toContain('slide-in-from-right-2');
    await waitFor(() => expect(allPanels()).toHaveLength(1));
    fireEvent.click(tab('Accedi'));
    expect(panel().className).toContain('slide-in-from-left-2');
  });

  it('a change of tab half-way through the last one leaves one form, with what was typed in it', async () => {
    renderAuth('/login');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'avv@studio.it' } });
    fireEvent.click(tab('Registrati'));
    fireEvent.click(tab('Accedi'));
    expect(address()).toHaveTextContent('/login');
    expect(document.querySelector('[data-leaving]')).toHaveAttribute('id', 'auth-panel-register');
    await waitFor(() => expect(allPanels()).toHaveLength(1));
    expect(panel()).toHaveAttribute('id', 'auth-panel-login');
    expect(within(panel()).getByLabelText('Email')).toHaveValue('avv@studio.it');
  });

  it('the first field still disabled while the user is read takes the focus once enabled', () => {
    authLoading = true;
    const { rerenderSame } = renderAuth('/register');
    fireEvent.click(tab('Accedi'));
    const email = within(panel()).getByLabelText('Email');
    expect(email).toBeDisabled();
    expect(email).not.toHaveFocus();
    authLoading = false;
  authError = null;
  register.mockReset().mockResolvedValue({ message: 'ok' });
    rerenderSame();
    expect(email).toHaveFocus();
  });

  it('opens «Registrati» from an address written in capitals', () => {
    renderAuth('/Register');
    expect(tab('Registrati')).toHaveAttribute('aria-selected', 'true');
  });

  it('gives each form a heading, for a screen reader\'s list of headings', async () => {
    renderAuth('/login');
    expect(within(panel()).getByRole('heading', { level: 2, name: 'Accedi' })).toBeInTheDocument();
    fireEvent.click(tab('Registrati'));
    await waitFor(() => expect(allPanels()).toHaveLength(1));
    expect(within(panel()).getByRole('heading', { level: 2, name: 'Registrati' })).toBeInTheDocument();
  });

  it('does not show a failed sign-in\'s error again on the empty form a change of tab brings back', async () => {
    // The page's useAuth keeps the error of the last failure until the next sign-in.
    authError = 'Credenziali non valide';
    renderAuth('/login');
    expect(screen.getByRole('alert')).toHaveTextContent('Credenziali non valide');
    fireEvent.click(tab('Registrati'));
    fireEvent.click(tab('Accedi'));
    await waitFor(() => expect(allPanels()).toHaveLength(1));
    expect(within(panel()).getByLabelText('Email')).toHaveValue('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('holds the tabs still while a sign-in is on its way', async () => {
    let finish: () => void = () => {};
    login.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderAuth('/login');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.it' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'pw' } });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Accedi' }));
    expect(tab('Registrati')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(tab('Registrati'));
    fireEvent.keyDown(tab('Accedi'), { key: 'ArrowRight' });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Registrati' }));
    expect(address()).toHaveTextContent('/login');
    expect(tab('Accedi')).toHaveAttribute('aria-selected', 'true');
    await act(async () => finish());
    expect(await screen.findByRole('status', { name: 'Accesso a VisuaLex' })).toBeInTheDocument();
  });

  it('holds the tabs still while a sign-up is on its way, so its confirmation shows', async () => {
    let finish: () => void = () => {};
    register.mockImplementation(() => new Promise((resolve) => { finish = () => resolve({ message: 'ok' }); }));
    renderAuth('/register');
    const p = within(panel());
    fireEvent.change(p.getByLabelText('Email'), { target: { value: 'avv@studio.it' } });
    fireEvent.change(p.getByLabelText('Username'), { target: { value: 'avv_rossi' } });
    fireEvent.change(p.getByLabelText('Password'), { target: { value: 'Segreta123' } });
    fireEvent.change(p.getByLabelText('Conferma password'), { target: { value: 'Segreta123' } });
    fireEvent.click(p.getByRole('button', { name: 'Crea account' }));
    fireEvent.click(tab('Accedi'));
    fireEvent.keyDown(tab('Registrati'), { key: 'Home' });
    expect(address()).toHaveTextContent('/register');
    await act(async () => finish());
    expect(await screen.findByRole('heading', { name: 'Registrazione completata' })).toBeInTheDocument();
    expect(tab('Accedi')).not.toHaveAttribute('aria-disabled');
  });

  it('anchors the page at the top, so only the card\'s height moves with the tab', () => {
    renderAuth('/login');
    const columns = screen.getByRole('main').parentElement!;
    expect(columns.className).toContain('items-start');
    expect(columns.className).not.toMatch(/\bmy-auto\b|\bitems-center\b/);
  });

  it('under reduced motion the change is immediate: no form fading out, none sliding in', () => {
    reduceMotion(true);
    renderAuth('/login');
    fireEvent.click(tab('Registrati'));
    expect(allPanels()).toHaveLength(1);
    expect(panel()).toHaveAttribute('id', 'auth-panel-register');
    expect(panel().className).not.toContain('animate-in');
    expect(panel().className).not.toContain('slide-in');
  });

  it('keeps the way back after the login across changes of tab', async () => {
    renderAuth({ pathname: '/login', state: { from: { pathname: '/dossier', search: '?dossier=7' } } });
    fireEvent.click(tab('Registrati'));
    fireEvent.click(tab('Accedi'));
    await waitFor(() => expect(allPanels()).toHaveLength(1));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.it' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'pw' } });
    await act(async () => {
      fireEvent.click(within(panel()).getByRole('button', { name: 'Accedi' }));
    });
    await waitFor(() => expect(screen.getByTestId('landed')).toHaveTextContent('/dossier?dossier=7'), { timeout: 2000 });
  });
});
