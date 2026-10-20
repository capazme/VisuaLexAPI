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
/** The panel a reader can use: the other form stays mounted, hidden from them. */
const panel = () => screen.getByRole('tabpanel');
const allPanels = () => document.querySelectorAll('[role="tabpanel"]');
const shownPanels = () => document.querySelectorAll('[role="tabpanel"]:not([aria-hidden])');

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
    expect(shownPanels()).toHaveLength(1);
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
    expect(shownPanels()).toHaveLength(1);
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

  it('fades the form out, hidden and out of reach, while the next one comes in from the side of its tab', () => {
    renderAuth('/login');
    expect(panel().className).not.toContain('animate-in'); // the first paint does not move
    fireEvent.click(tab('Registrati'));
    const hidden = document.getElementById('auth-panel-login')!;
    expect(hidden).toHaveAttribute('aria-hidden', 'true');
    expect(hidden).toHaveAttribute('inert');
    expect(hidden.className).toMatch(/\binvisible\b/);
    expect(hidden.className).toContain('opacity-0');
    expect(hidden.className).toContain('transition-[opacity,visibility]'); // visibility goes at the end of the fade
    expect(panel().className).toContain('slide-in-from-right-2');
    // No transition on the way in: it would hold the panel hidden for a frame and lose the focus.
    expect(panel().className).not.toContain('transition');
    fireEvent.click(tab('Accedi'));
    expect(panel().className).toContain('slide-in-from-left-2');
  });

  it('a quick change back leaves one form shown, the other out of reach, with what was typed in it', () => {
    renderAuth('/login');
    fireEvent.change(within(panel()).getByLabelText('Email'), { target: { value: 'avv@studio.it' } });
    fireEvent.click(tab('Registrati'));
    fireEvent.click(tab('Accedi'));
    expect(address()).toHaveTextContent('/login');
    expect(shownPanels()).toHaveLength(1);
    expect(panel()).toHaveAttribute('id', 'auth-panel-login');
    expect(document.getElementById('auth-panel-register')).toHaveAttribute('inert');
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
    expect(within(panel()).getByRole('heading', { level: 2, name: 'Registrati' })).toBeInTheDocument();
  });

  it('keeps each form as it was across changes of tab, what was typed and its error', () => {
    // Both forms stay mounted: the one coming back is the same form, not an empty one.
    authError = 'Credenziali non valide';
    renderAuth('/login');
    fireEvent.change(within(panel()).getByLabelText('Email'), { target: { value: 'avv@studio.it' } });
    fireEvent.click(tab('Registrati'));
    fireEvent.change(within(panel()).getByLabelText('Username'), { target: { value: 'avv_rossi' } });
    expect(screen.queryByRole('alert')).toBeNull(); // the hidden form's error is hidden with it
    fireEvent.click(tab('Accedi'));
    expect(within(panel()).getByLabelText('Email')).toHaveValue('avv@studio.it');
    expect(screen.getByRole('alert')).toHaveTextContent('Credenziali non valide');
    fireEvent.click(tab('Registrati'));
    expect(within(panel()).getByLabelText('Username')).toHaveValue('avv_rossi');
  });

  it('holds the tabs still while a sign-in is on its way', async () => {
    let finish: () => void = () => {};
    login.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderAuth('/login');
    fireEvent.change(within(panel()).getByLabelText('Email'), { target: { value: 'a@b.it' } });
    fireEvent.change(within(panel()).getByLabelText(/^password$/i), { target: { value: 'pw' } });
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

  it('holds the page still: both forms in one cell, «Crediti» in the last row, a gutter kept for the bar', () => {
    renderAuth('/login');
    // The card is as tall as the taller form whichever is shown: both sit in the same cell of a grid.
    for (const p of allPanels()) expect(p.className).toMatch(/\bcol-start-1\b.*\brow-start-1\b/);
    expect(allPanels()[0].parentElement!.className).toMatch(/\bgrid\b/);
    // «Crediti» is the last row of a grid as tall as the window, not a line after the card.
    const foot = screen.getByRole('contentinfo');
    const page = foot.parentElement!;
    expect(page.lastElementChild).toBe(foot);
    expect(page.className).toContain('grid-rows-[1fr_auto]');
    expect(page.className).toContain('min-h-full');
    expect(foot).not.toContainElement(screen.getByRole('main'));
    // The page scrolls in its own box, which keeps the gutter of a bar that may appear.
    expect(page.parentElement!.className).toMatch(/\bh-app\b/);
    expect(page.parentElement!.className).toContain('overflow-y-auto');
    expect(page.parentElement!.className).toContain('[scrollbar-gutter:stable]');
    fireEvent.click(tab('Registrati'));
    expect(screen.getByRole('contentinfo')).toBe(foot);
    expect(allPanels()).toHaveLength(2);
  });

  it('centres the colophon against the card on a computer, above it on a phone', () => {
    renderAuth('/login');
    const colophon = screen.getByRole('banner');
    expect(colophon.parentElement!.className).toContain('md:items-center');
    expect(colophon.className).toMatch(/(^|\s)items-center\b/);
    expect(colophon.className).toMatch(/(^|\s)text-center\b/);
    expect(colophon.className).toContain('md:items-start');
    expect(colophon.className).toContain('md:text-left');
  });

  it('under reduced motion the change is immediate: no form fading out, none sliding in', () => {
    reduceMotion(true);
    renderAuth('/login');
    fireEvent.click(tab('Registrati'));
    expect(shownPanels()).toHaveLength(1);
    expect(panel()).toHaveAttribute('id', 'auth-panel-register');
    expect(panel().className).not.toContain('animate-in');
    expect(panel().className).not.toContain('slide-in');
    // Nor a fade on the way out, nor a slide of the mark.
    expect(document.getElementById('auth-panel-login')!.className).toContain('motion-reduce:transition-none');
    expect(screen.getByTestId('auth-tab-mark').className).toContain('motion-reduce:transition-none');
  });

  it('keeps the way back after the login across changes of tab', async () => {
    renderAuth({ pathname: '/login', state: { from: { pathname: '/dossier', search: '?dossier=7' } } });
    fireEvent.click(tab('Registrati'));
    fireEvent.click(tab('Accedi'));
    fireEvent.change(within(panel()).getByLabelText('Email'), { target: { value: 'a@b.it' } });
    fireEvent.change(within(panel()).getByLabelText(/^password$/i), { target: { value: 'pw' } });
    await act(async () => {
      fireEvent.click(within(panel()).getByRole('button', { name: 'Accedi' }));
    });
    await waitFor(() => expect(screen.getByTestId('landed')).toHaveTextContent('/dossier?dossier=7'), { timeout: 2000 });
  });
});
