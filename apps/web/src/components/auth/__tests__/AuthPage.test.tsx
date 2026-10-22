import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react';

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

  it('«Torna ad Accedi» after signing up: a fresh sign-in form, without the values and the failure from before', async () => {
    authError = 'Credenziali non valide'; // the page's useAuth keeps the last failure until the next sign-in
    renderAuth('/login');
    fireEvent.change(within(panel()).getByLabelText('Email'), { target: { value: 'vecchio@studio.it' } });
    fireEvent.change(within(panel()).getByLabelText(/^password$/i), { target: { value: 'sbagliata' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Credenziali non valide');
    fireEvent.click(tab('Registrati'));
    const p = within(panel());
    fireEvent.change(p.getByLabelText('Email'), { target: { value: 'avv@studio.it' } });
    fireEvent.change(p.getByLabelText('Username'), { target: { value: 'avv_rossi' } });
    fireEvent.change(p.getByLabelText('Password'), { target: { value: 'Segreta123' } });
    fireEvent.change(p.getByLabelText('Conferma password'), { target: { value: 'Segreta123' } });
    fireEvent.click(p.getByRole('button', { name: 'Crea account' }));
    await screen.findByRole('heading', { name: 'Registrazione completata' });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Torna ad Accedi' }));
    expect(within(panel()).getByLabelText('Email')).toHaveValue('');
    expect(within(panel()).getByLabelText(/^password$/i)).toHaveValue('');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(within(panel()).getByLabelText('Email')).toHaveFocus();
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

  it('holds the page still: the form hidden out of the flow, «Crediti» in the last row, a gutter kept for the bar', () => {
    renderAuth('/login');
    // The card takes the shown form's height (A1c): the hidden one leaves the flow, from the box's top.
    const hidden = document.getElementById('auth-panel-register')!;
    expect(hidden).toHaveClass('absolute', 'inset-x-0', 'top-0');
    expect(document.getElementById('auth-panel-login')).not.toHaveClass('absolute');
    expect(allPanels()[0].parentElement!.className).toMatch(/\brelative\b/);
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
    // The card hangs from the top of its row; the colophon is as tall as the card on «Accedi» and centred in it.
    expect(colophon.parentElement!.className).toContain('md:items-start');
    expect(colophon).toHaveClass('md:min-h-[var(--login-card-h,32rem)]', 'md:justify-center');
    expect(colophon.className).toMatch(/(^|\s)items-center\b/);
    expect(colophon.className).toMatch(/(^|\s)text-center\b/);
    expect(colophon.className).toContain('md:items-start');
    expect(colophon.className).toContain('md:text-left');
  });

  /** The end of the box's height transition: jsdom has no `TransitionEvent`, so its `propertyName` is given by hand. */
  const heightEnds = (el: HTMLElement) => {
    const event = createEvent.transitionEnd(el);
    Object.defineProperty(event, 'propertyName', { value: 'height' });
    fireEvent(el, event);
  };

  it('takes the shown form\'s height, grows on «Registrati» from a still top, and centres the page by «Accedi» (A1c)', async () => {
    // jsdom lays nothing out: the forms' heights and the card's, given (the card: 120 of padding and tabs around its box).
    const sizes: Record<string, number> = { 'auth-panel-login': 300, 'auth-panel-register': 560 };
    const shown = () => document.querySelector('[role="tabpanel"]:not([aria-hidden])')!.id;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      let height = 0;
      if (this.id in sizes) height = sizes[this.id];
      else if (this.tagName === 'MAIN') height = 120 + sizes[shown()];
      else if (this.querySelector(':scope > #auth-panel-login')) height = this.style.height ? parseFloat(this.style.height) : sizes[shown()];
      return { height, width: 0, top: 0, left: 0, right: 0, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    renderAuth('/login');
    const frame = document.getElementById('auth-panel-login')!.parentElement!;
    const page = screen.getByRole('main').closest('.h-app') as HTMLElement;
    // At rest the box is as tall as the form shown (no height written), always clipped, by `clip`: no scroller.
    expect(frame.style.height).toBe('');
    expect(frame).toHaveClass('overflow-clip');
    expect(page.style.getPropertyValue('--login-card-h')).toBe('420px');
    expect(page.querySelector('.md\\:pt-\\[max\\(1\\.5rem\\2c calc\\(\\(100dvh-4rem-var\\(--login-card-h\\2c 32rem\\)\\)\\/2\\)\\)\\]')).not.toBeNull();

    fireEvent.click(tab('Registrati'));
    // From the old height to the new, in 220 ms; the page's centre is still «Accedi»'s.
    expect(frame.style.height).toBe('300px');
    expect(frame).toHaveClass('transition-[height]', 'duration-[220ms]');
    await waitFor(() => expect(frame.style.height).toBe('560px'));
    expect(page.style.getPropertyValue('--login-card-h')).toBe('420px');
    // Let go at the end of the transition: at rest again, as tall as the form shown.
    heightEnds(frame);
    expect(frame.style.height).toBe('');
    expect(frame).not.toHaveClass('transition-[height]');

    // A form that grows (an error on «Accedi») moves no centre: only a new width does.
    fireEvent.click(tab('Accedi'));
    heightEnds(frame);
    sizes['auth-panel-login'] = 360;
    fireEvent.change(within(panel()).getByLabelText('Email'), { target: { value: 'a@b.it' } });
    expect(page.style.getPropertyValue('--login-card-h')).toBe('420px');
    Object.defineProperty(window, 'innerWidth', { value: window.innerWidth + 10, configurable: true });
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(page.style.getPropertyValue('--login-card-h')).toBe('480px');

    // Back halfway: one form in the flow, the other out of it and out of reach.
    fireEvent.click(tab('Registrati'));
    fireEvent.click(tab('Accedi'));
    expect(shownPanels()).toHaveLength(1);
    expect(document.getElementById('auth-panel-register')).toHaveClass('absolute');
    expect(document.getElementById('auth-panel-register')).toHaveAttribute('inert');
  });

  /** The forms' heights as a browser would give them: «Registrati» showing its confirmation is short. */
  const layOut = () => {
    const shown = () => document.querySelector('[role="tabpanel"]:not([aria-hidden])')!;
    const heightOfPanel = (el: Element) => (el.id === 'auth-panel-login' ? 300 : el.querySelector('h2')?.textContent === 'Registrazione completata' ? 300 : 560);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      let height = 0;
      if (this.id === 'auth-panel-login' || this.id === 'auth-panel-register') height = heightOfPanel(this);
      else if (this.tagName === 'MAIN') height = 120 + heightOfPanel(shown());
      else if (this.querySelector(':scope > #auth-panel-login')) height = this.style.height ? parseFloat(this.style.height) : heightOfPanel(shown());
      return { height, width: 0, top: 0, left: 0, right: 0, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
  };

  it('after a sign-up, back on «Registrati» the box runs to the empty form\'s height, not the confirmation\'s', async () => {
    layOut();
    renderAuth('/register');
    const p = within(panel());
    fireEvent.change(p.getByLabelText('Email'), { target: { value: 'avv@studio.it' } });
    fireEvent.change(p.getByLabelText('Username'), { target: { value: 'avv_rossi' } });
    fireEvent.change(p.getByLabelText('Password'), { target: { value: 'Segreta123' } });
    fireEvent.change(p.getByLabelText('Conferma password'), { target: { value: 'Segreta123' } });
    fireEvent.click(p.getByRole('button', { name: 'Crea account' }));
    await screen.findByRole('heading', { name: 'Registrazione completata' });
    const frame = document.getElementById('auth-panel-login')!.parentElement!;
    fireEvent.click(within(panel()).getByRole('button', { name: 'Torna ad Accedi' }));
    heightEnds(frame);
    fireEvent.click(tab('Registrati'));
    // Read once the fresh form is mounted: its 560 px, not the 300 of the confirmation it replaced.
    await waitFor(() => expect(frame.style.height).toBe('560px'));
    expect(within(panel()).getByLabelText('Email')).toHaveValue('');
  });

  it('moves the height from the keyboard too: the arrows go from the old height to the new', async () => {
    layOut();
    renderAuth('/login');
    const frame = document.getElementById('auth-panel-login')!.parentElement!;
    fireEvent.keyDown(tab('Accedi'), { key: 'ArrowRight' });
    expect(frame.style.height).toBe('300px');
    expect(frame).toHaveClass('transition-[height]');
    await waitFor(() => expect(frame.style.height).toBe('560px'));
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
    // Nor a height that moves.
    const frame = document.getElementById('auth-panel-login')!.parentElement!;
    expect(frame).not.toHaveClass('transition-[height]');
    expect(frame.style.height).toBe('');
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

// The wordmark written in ink (A3): one face, one ink; the word one text throughout, nothing left on the finished page.
describe('AuthPage: the wordmark written in ink', () => {
  // jsdom's events carry no `animationName`: it is written on them as a browser would.
  const animation = (target: Element, type: 'animationend' | 'animationcancel', animationName: string) => {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, 'animationName', { value: animationName });
    act(() => {
      target.dispatchEvent(event);
    });
  };
  const copy = () => document.querySelector('.vlx-ink-bleed');

  it('names the page «VisuaLex» with one text, its blurred copy and the book hidden from a reader', () => {
    renderAuth('/login');
    const title = screen.getByRole('heading', { level: 1, name: 'VisuaLex' });
    // The word itself is never split into letters (WebKit kerns no pair across two elements).
    const ink = title.querySelector('.vlx-ink-word')!;
    expect(ink.childNodes).toHaveLength(1);
    expect(ink.textContent).toBe('VisuaLex');
    expect(copy()).toHaveAttribute('aria-hidden', 'true');
    expect(copy()).toHaveClass('select-none');
    expect(document.querySelector('svg.vlx-ink-book')).toHaveAttribute('aria-hidden', 'true');
    expect(title.querySelector('svg')).toBeNull();
  });

  it('drops the copy and the mask once the ink is written, and only then', () => {
    renderAuth('/login');
    const title = screen.getByRole('heading', { level: 1 });
    // The copy's own end bubbles up: it is not the ink's.
    animation(copy()!, 'animationend', 'vlx-ink-bleed');
    expect(copy()).not.toBeNull();
    animation(title.querySelector('.vlx-ink-word')!, 'animationend', 'vlx-ink-write');
    expect(copy()).toBeNull();
    expect(title.querySelector('.vlx-ink-word')).toBeNull();
    expect(title).toHaveTextContent(/^VisuaLex$/);
    expect(screen.getByRole('heading', { level: 1, name: 'VisuaLex' })).toBe(title);
  });

  it('ends the writing when it is cancelled, reduced motion turned on halfway', () => {
    renderAuth('/login');
    animation(document.querySelector('.vlx-ink-word')!, 'animationcancel', 'vlx-ink-write');
    expect(copy()).toBeNull();
    expect(document.querySelector('.vlx-ink-word')).toBeNull();
  });

  it('only fades the word in from the left on WebKit for iOS: no mask, no blurred copy', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15');
    renderAuth('/login');
    const title = screen.getByRole('heading', { level: 1, name: 'VisuaLex' });
    expect(title.querySelector('.vlx-ink-plain')).toHaveTextContent('VisuaLex');
    expect(title.querySelector('.vlx-ink-word')).toBeNull();
    expect(copy()).toBeNull();
    animation(title.querySelector('.vlx-ink-plain')!, 'animationend', 'vlx-ink-plain');
    expect(title.querySelector('.vlx-ink-plain')).toBeNull();
  });

  it('turns the colophon\'s opacity on after its first frames, the fade reduced motion sees', async () => {
    renderAuth('/login');
    const header = screen.getByRole('heading', { level: 1 }).closest('header')!;
    expect(header).toHaveClass('motion-reduce:opacity-0');
    await waitFor(() => expect(header).not.toHaveClass('motion-reduce:opacity-0'));
  });

  it('never writes the word under reduced motion', () => {
    reduceMotion(true);
    renderAuth('/login');
    const title = screen.getByRole('heading', { level: 1, name: 'VisuaLex' });
    expect(title.querySelector('.vlx-ink-word, .vlx-ink-plain')).toBeNull();
    expect(copy()).toBeNull();
  });
});
