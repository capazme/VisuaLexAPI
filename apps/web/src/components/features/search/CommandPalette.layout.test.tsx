import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../hooks/useTour', () => ({
  useTour: () => ({ tryStartTour: vi.fn(), startTour: vi.fn(), hasSeenTour: () => true }),
}));
// framer-motion reads the reduced-motion preference once for the run: the hook is what the palette asks.
const motionPref = vi.hoisted(() => ({ reduced: false }));
vi.mock('framer-motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('framer-motion')>()),
  useReducedMotion: () => motionPref.reduced,
}));

import { CommandPalette } from './CommandPalette';
import { appStore } from '../../../store/useAppStore';
import { SEARCH_FIELD_FORM_ID } from '../../../utils/searchFieldControl';
import type { CustomAlias, QuickNorm } from '../../../types';

/**
 * The search menu in the new design (spec O1): on a computer a panel that drops from the search page's
 * field, on a phone `ui/Sheet`; the field first, the list of acts and «A portata di mano» under it, the
 * filters and the keys at the foot. The behaviour behind it is `CommandPalette.test.tsx`'s.
 */

function asDesktop(desktop: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: desktop, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
}

const quickNorm = (i: number): QuickNorm => ({
  id: `q${i}`, label: `Art. ${i} c.c.`, createdAt: '2026-10-01T00:00:00.000Z', usageCount: 0,
  searchParams: { act_type: 'codice civile', article: String(i), act_number: '', date: '', version: 'vigente', version_date: '' },
});
const alias = (i: number): CustomAlias => ({
  id: `a${i}`, trigger: `alias-${String(i).padStart(2, '0')}`, type: 'reference', expandTo: 'Codice penale',
  usageCount: 0, createdAt: '2026-10-01T00:00:00.000Z', searchParams: { act_type: 'codice penale', article: String(i) },
});

const optionNames = () => screen.queryAllByRole('option').map((o) => o.textContent ?? '');

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ presets: {}, known_acts: [] }) })));
  appStore.setState({ quickNorms: [], customAliases: [] });
});

afterEach(() => {
  motionPref.reduced = false;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.getElementById(SEARCH_FIELD_FORM_ID)?.remove();
  appStore.setState({ quickNorms: [], customAliases: [] });
});

describe('CommandPalette — where it opens', () => {
  it('on a computer, drops from the search page\'s field, with its own «Chiudi» and the keys at the foot', () => {
    asDesktop(true);
    const form = document.createElement('form');
    form.id = SEARCH_FIELD_FORM_ID;
    document.body.appendChild(form);
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);

    const panel = document.getElementById('command-menu-root')!.closest('[class*="fixed"]') as HTMLElement;
    // placed by floating-ui against the field, not hung at the top of the screen
    expect(panel.className).not.toMatch(/top-16/);
    expect(panel.style.position).toBe('fixed');
    expect(screen.getByRole('button', { name: 'Chiudi' })).toBeInTheDocument();
    expect(screen.getByText('Naviga')).toBeInTheDocument();
    // a dialog with its name, the focus kept inside
    expect(screen.getByRole('dialog', { name: 'Menu di ricerca' })).toContainElement(screen.getByRole('combobox'));
  });

  it('on a computer, gives the focus back to what had it (the search page\'s field) when it closes', async () => {
    asDesktop(true);
    const opener = document.createElement('button');
    opener.textContent = 'Cerca una norma, una sentenza o un tema';
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());

    rerender(<CommandPalette isOpen={false} onClose={vi.fn()} onSearch={vi.fn()} />);
    await waitFor(() => expect(opener).toHaveFocus());
    opener.remove();
  });

  it('is as tall as what it holds, up to its maximum: no fixed height (Bill)', () => {
    asDesktop(true);
    const form = document.createElement('form');
    form.id = SEARCH_FIELD_FORM_ID;
    document.body.append(form);
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    const box = screen.getByRole('dialog', { name: 'Menu di ricerca' });
    expect(box.style.height).toBe('');
    expect(box.querySelector(':scope > div')).toHaveClass('max-h-[var(--palette-max-h,40rem)]');
  });

  it('on a computer with no field on screen, hangs at the top, centred', () => {
    asDesktop(true);
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    const panel = document.getElementById('command-menu-root')!.closest('[class*="fixed"]') as HTMLElement;
    expect(panel.className).toMatch(/top-16/);
  });

  it('on a phone, gives the focus back to what opened it (the bar\'s magnifier) when it closes', async () => {
    asDesktop(false);
    const opener = document.createElement('button');
    opener.textContent = 'Apri il menu di ricerca';
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    await waitFor(() => expect(document.activeElement).not.toBe(opener));

    rerender(<CommandPalette isOpen={false} onClose={vi.fn()} onSearch={vi.fn()} />);
    await waitFor(() => expect(opener).toHaveFocus());
    opener.remove();
  });

  it('on a phone, drops from the bar at the top across the page less 16 px each side, with its «Chiudi», and shows no keys (R2)', () => {
    asDesktop(false);
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    const panel = screen.getByRole('dialog', { name: 'Menu di ricerca' });
    expect(panel).toHaveClass('inset-x-4');
    expect(panel.className).toMatch(/top-\[calc\(env\(safe-area-inset-top\)/);
    expect(within(panel).getByRole('button', { name: 'Chiudi' })).toBeInTheDocument();
    expect(screen.queryByText('Naviga')).toBeNull();
  });
});

describe('CommandPalette — growing out of the field (R2)', () => {
  it('starts as tall as the search page\'s field, at its corners, and grows into the panel', async () => {
    asDesktop(true);
    // jsdom has no Web Animations: one that records what it was asked.
    const asked: Keyframe[][] = [];
    const animateSpy = vi.fn(function (this: HTMLElement, keyframes: Keyframe[]) {
      asked.push(keyframes);
      return { cancel: vi.fn(), onfinish: null, playState: 'running' } as unknown as Animation;
    });
    Object.defineProperty(HTMLElement.prototype, 'animate', { value: animateSpy, configurable: true, writable: true });
    try {
      const form = document.createElement('form');
      form.id = SEARCH_FIELD_FORM_ID;
      Object.defineProperty(form, 'offsetHeight', { value: 44 });
      document.body.append(form);
      render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
      const panel = screen.getByRole('dialog', { name: 'Menu di ricerca' }).querySelector<HTMLElement>('.rounded-2xl')!;
      // Set before the first paint, so it never flashes open: the field's height and corners.
      expect(panel.style.clipPath).toBe('inset(0px 0px calc(100% - 44px) 0px round 12px)');
      // Grown to the panel's, at a card's corners — once the first frame is drawn.
      await waitFor(() => expect(asked).toContainEqual([
        { clipPath: 'inset(0px 0px calc(100% - 44px) 0px round 12px)' },
        { clipPath: 'inset(0px 0px calc(0% - 0px) 0px round 16px)' },
      ]));
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    }
  });

  it('opened again while it closes grows back from where the closing is, and one closing runs one animation', async () => {
    asDesktop(true);
    const AS_FIELD = 'inset(0px 0px calc(100% - 44px) 0px round 12px)';
    const AT_CLOSE = 'inset(0px 0px calc(20% - 8px) 0px round 15px)';
    const MIDWAY = 'inset(0px 0px calc(60% - 26px) 0px round 14px)';
    let caught = AT_CLOSE;
    const runs: { keyframes: Keyframe[]; animation: Animation }[] = [];
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      value: vi.fn((keyframes: Keyframe[]) => {
        const animation = { cancel: vi.fn(), onfinish: null, playState: 'running' } as unknown as Animation;
        runs.push({ keyframes, animation });
        return animation;
      }),
      configurable: true,
      writable: true,
    });
    // The panel caught halfway, as a browser reads it while an animation runs.
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
      const style = computed(el, pseudo);
      if (!(el instanceof HTMLElement) || !el.classList.contains('shadow-xl')) return style;
      return new Proxy(style, {
        get: (target, key) => {
          if (key === 'clipPath') return caught;
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    });
    const closings = () => runs.filter((run) => run.keyframes.at(-1)?.clipPath === AS_FIELD);
    try {
      const form = document.createElement('form');
      form.id = SEARCH_FIELD_FORM_ID;
      Object.defineProperty(form, 'offsetHeight', { value: 44 });
      document.body.append(form);
      const onClose = vi.fn();
      const { rerender } = render(<CommandPalette isOpen onClose={onClose} onSearch={vi.fn()} />);
      await waitFor(() => expect(runs.some((run) => run.keyframes[0]?.clipPath === AS_FIELD)).toBe(true));

      rerender(<CommandPalette isOpen={false} onClose={onClose} onSearch={vi.fn()} />);
      expect(closings()).toHaveLength(1);
      expect(closings()[0].keyframes[0]).toEqual({ clipPath: AT_CLOSE });
      // Renders while it closes start no second closing.
      rerender(<CommandPalette isOpen={false} onClose={vi.fn()} onSearch={vi.fn()} />);
      rerender(<CommandPalette isOpen={false} onClose={vi.fn()} onSearch={vi.fn()} />);
      expect(closings()).toHaveLength(1);

      const closing = closings()[0].animation;
      // Halfway back: the browser now reads another clip than the one the closing started from.
      caught = MIDWAY;
      rerender(<CommandPalette isOpen onClose={onClose} onSearch={vi.fn()} />);
      const panel = screen.getByRole('dialog', { name: 'Menu di ricerca' }).querySelector<HTMLElement>('.rounded-2xl')!;
      // Taken over where it was: the closing stopped, the clip held there, never the field's or the panel's.
      expect(closing.cancel).toHaveBeenCalled();
      expect(panel.style.clipPath).toBe(MIDWAY);
      await waitFor(() => expect(runs.at(-1)?.keyframes).toEqual([
        { clipPath: MIDWAY },
        { clipPath: 'inset(0px 0px calc(0% - 0px) 0px round 16px)' },
      ]));
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    }
  });

  it('a closing that ended is dropped when the panel comes back before it went, and under reduced motion it fades back from where it was', async () => {
    asDesktop(true);
    const runs: { keyframes: Keyframe[]; animation: Animation }[] = [];
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      value: vi.fn((keyframes: Keyframe[]) => {
        const animation = { cancel: vi.fn(), onfinish: null, playState: 'running' } as unknown as Animation;
        runs.push({ keyframes, animation });
        return animation;
      }),
      configurable: true,
      writable: true,
    });
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
      const style = computed(el, pseudo);
      if (!(el instanceof HTMLElement) || !el.classList.contains('shadow-xl')) return style;
      return new Proxy(style, {
        get: (target, key) => {
          if (key === 'opacity') return '0.4';
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    });
    try {
      motionPref.reduced = true;
      const { rerender } = render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
      rerender(<CommandPalette isOpen={false} onClose={vi.fn()} onSearch={vi.fn()} />);
      const fadeOut = runs.find((run) => run.keyframes.at(-1)?.opacity === 0)!;
      expect(fadeOut).toBeDefined();
      // It ended, and the panel is asked back in the same breath as its removal.
      act(() => {
        (fadeOut.animation.onfinish as unknown as () => void)?.();
        rerender(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
      });
      expect(fadeOut.animation.cancel).toHaveBeenCalled();
      const panel = screen.getByRole('dialog', { name: 'Menu di ricerca' }).querySelector<HTMLElement>('.rounded-2xl')!;
      expect(panel.style.clipPath).toBe('');
      expect(runs.at(-1)?.keyframes).toEqual([{ opacity: 0.4 }, { opacity: 1 }]);
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    }
  });

  it('lets go of the field\'s width and height when the field goes while it is open', async () => {
    asDesktop(true);
    const form = document.createElement('form');
    form.id = SEARCH_FIELD_FORM_ID;
    document.body.append(form);
    const { rerender } = render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    const box = screen.getByRole('dialog', { name: 'Menu di ricerca' });
    await waitFor(() => expect(box.style.getPropertyValue('--palette-max-h')).not.toBe(''));
    expect(box.style.width).not.toBe('');
    form.remove();
    rerender(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(box.style.width).toBe('');
    expect(box.style.getPropertyValue('--palette-max-h')).toBe('');
  });

  it('without Web Animations draws the panel at once, never left clipped to the field', () => {
    asDesktop(true);
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    const panel = screen.getByRole('dialog', { name: 'Menu di ricerca' }).querySelector<HTMLElement>('.rounded-2xl')!;
    expect(panel.style.clipPath).toBe('');
  });

  it('under reduced motion grows nothing: no clip, it fades', () => {
    asDesktop(true);
    motionPref.reduced = true;
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    const panel = screen.getByRole('dialog', { name: 'Menu di ricerca' }).querySelector<HTMLElement>('.rounded-2xl')!;
    expect(panel.style.clipPath).toBe('');
  });
});

describe('CommandPalette — the field and the steps', () => {
  it('says under the field what it takes, and names the act chosen in the field: a crumb that goes back (R2)', async () => {
    asDesktop(true);
    const user = userEvent.setup();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);

    expect(screen.getByText('Scrivi una citazione: art. 2043 c.c., l. 241/1990, Cass. civ. 10787/2024')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Passi della ricerca' })).toBeNull();

    await user.click(screen.getByRole('option', { name: 'Codice civile · c.c.' }));
    expect(screen.getByText("Scrivi il numero dell'articolo: 2043, 1-bis")).toBeInTheDocument();
    const crumb = screen.getByRole('button', { name: 'Torna indietro: Codice civile' });
    expect(crumb).toHaveTextContent('Codice civile');
    await user.click(crumb);
    expect(screen.getByPlaceholderText(/art 2043 cc/i)).toBeInTheDocument();
  });

  it('goes back a step with Backspace on the empty field it opens with, from the keyboard alone (R2, Bill)', async () => {
    asDesktop(true);
    const user = userEvent.setup();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    // «Codice penale», Enter: the article's field, empty, has the focus.
    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'codice penale{Enter}');
    const box = await screen.findByRole('textbox', { name: "Numero dell'articolo" });
    await waitFor(() => expect(box).toHaveFocus());
    expect(box).toHaveValue('');
    await user.keyboard('{Backspace}');
    expect(screen.getByPlaceholderText(/art 2043 cc/i)).toBeInTheDocument();
  });

  it('a held Backspace stops at an empty field, and the date gives way to the number first (R2)', async () => {
    asDesktop(true);
    const user = userEvent.setup();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    await user.click(screen.getByRole('option', { name: /^Legge · l\./ }));
    const number = screen.getByRole('textbox', { name: "Numero dell'atto" });
    await user.type(number, '241');
    const date = screen.getByRole('textbox', { name: "Anno o data dell'atto" });
    await user.click(date);
    await user.keyboard('{Backspace}');
    expect(number).toHaveFocus();
    // Held: repeated keydowns on an empty field go nowhere.
    await user.clear(number);
    fireEvent.keyDown(number, { key: 'Backspace', repeat: true });
    expect(screen.getByRole('textbox', { name: "Numero dell'atto" })).toBeInTheDocument();
    // The crumb is named by what it shows, number and year included on the article's step.
    await user.type(number, '241');
    await user.type(date, '1990{Enter}');
    expect(screen.getByRole('button', { name: /^Torna indietro: .*241\/1990$/ })).toBeInTheDocument();
  });

  it('searches the article typed, as before', async () => {
    asDesktop(false);
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={onSearch} />);

    await user.click(screen.getByRole('option', { name: 'Codice civile · c.c.' }));
    const box = screen.getByRole('textbox', { name: "Numero dell'articolo" });
    await user.clear(box);
    await user.type(box, '2043');
    await user.click(screen.getByRole('button', { name: "Apri l'articolo" }));

    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ act_type: 'codice civile', article: '2043' }));
  });
});

describe('CommandPalette — «Scegli l\'atto»', () => {
  it('lists the acts by group, each by name and abbreviation', () => {
    asDesktop(true);
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(screen.getByText('Fonti primarie')).toBeInTheDocument();
    expect(screen.getByText('Codici fondamentali')).toBeInTheDocument();
    expect(screen.getByText('Unione europea')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Codice di procedura civile · c.p.c.' })).toBeInTheDocument();
  });

  it('draws the letters the box matched in the app\'s ink, and a row leaving is no option any more (R2)', () => {
    asDesktop(true);
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    // One change, then a look in the same tick: the rows filtered away are still fading.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'proc' } });
    const row = screen.getAllByRole('option').find((o) => o.textContent === 'Codice di procedura civile · c.p.c.')!;
    expect(row.querySelector('.text-toga-700')).toHaveTextContent(/^proc$/);
    // A row filtered away, while it fades: hidden, and never Enter's.
    const leaving = screen.getAllByRole('option', { hidden: true }).find((o) => o.textContent === 'Codice civile · c.c.');
    expect(leaving).toBeDefined();
    expect(leaving).toHaveAttribute('aria-hidden', 'true');
    expect(leaving).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).not.toContain('Codice civile · c.c.');
  });

  it('is narrowed by the field while it is typed', async () => {
    asDesktop(true);
    const user = userEvent.setup();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);

    await user.type(screen.getByRole('combobox'), 'proc');
    const names = optionNames();
    expect(names).toContain('Codice di procedura civile · c.p.c.');
    expect(names).toContain('Codice di procedura penale · c.p.p.');
    expect(names).not.toContain('Codice civile · c.c.');
  });

  it('says so when no act has the name typed', async () => {
    asDesktop(true);
    const user = userEvent.setup();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    await user.type(screen.getByRole('combobox'), 'zzzz');
    // once the server has said it is no act either (until then: «Cerco l'atto…»)
    expect(await screen.findByText('Nessun atto con questo nome')).toBeInTheDocument();
  });
});

describe('CommandPalette — «A portata di mano»', () => {
  it('is one quiet line each when empty: no favourite, and «Crea un alias»', () => {
    asDesktop(true);
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(screen.getByText('Nessun preferito: il fulmine su un articolo lo aggiunge qui')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Crea un alias' })).toBeInTheDocument();
  });

  it('on a phone, gives «Gestisci» a heading as tall as it, so it covers no favourite', () => {
    asDesktop(false);
    appStore.setState({ quickNorms: [quickNorm(1)] });
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    const group = document.getElementById('command-palette-quick-norms')!;
    expect(group.className).toMatch(/\[&_\[cmdk-group-heading\]\]:min-h-\[44px\]/);
    expect(within(group).getByRole('button', { name: 'Gestisci' })).toHaveClass('top-0', 'min-h-[44px]');
  });

  it('shows the first six of 30 favourites and of 50 aliases, and the way to all of them', () => {
    asDesktop(true);
    appStore.setState({
      quickNorms: Array.from({ length: 30 }, (_, i) => quickNorm(i + 1)),
      customAliases: Array.from({ length: 50 }, (_, i) => alias(i + 1)),
    });
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);

    const names = optionNames();
    expect(names.filter((n) => n.startsWith('Art. ') && n.endsWith('Codice civile'))).toHaveLength(6);
    expect(names.filter((n) => n.startsWith('alias-'))).toHaveLength(6);
    expect(screen.getByRole('option', { name: 'Tutti i preferiti (30)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Gestisci alias (50)' })).toBeInTheDocument();
  });

  it('narrows the favourites and the aliases with the field, past the six', async () => {
    asDesktop(true);
    appStore.setState({ customAliases: Array.from({ length: 50 }, (_, i) => alias(i + 1)) });
    const user = userEvent.setup();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);

    await user.type(screen.getByRole('combobox'), 'alias-4');
    const names = optionNames().filter((n) => n.startsWith('alias-'));
    expect(names).toHaveLength(10); // alias-40 … alias-49
    expect(names[0]).toMatch(/^alias-40/);
  });
});

describe('CommandPalette — «Filtri avanzati»', () => {
  it('stays closed, says its state in words, and the search carries what was chosen', async () => {
    asDesktop(true);
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={onSearch} />);

    const toggle = screen.getByRole('button', { name: /Filtri avanzati/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('Nessun filtro');

    await user.click(toggle);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Fonte' }), 'eurlex');
    await user.type(screen.getByRole('spinbutton', { name: "Dall'anno" }), '1990');
    expect(toggle).toHaveTextContent('2 filtri attivi');

    await user.click(screen.getByRole('option', { name: 'Codice civile · c.c.' }));
    await user.type(screen.getByRole('textbox', { name: "Numero dell'articolo" }), '1');
    await user.click(screen.getByRole('button', { name: "Apri l'articolo" }));
    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ filters: expect.objectContaining({ source: 'eurlex', yearFrom: 1990 }) }));
  });
});

describe('CommandPalette — the keys', () => {
  it('leaves Enter to a button: «Filtri avanzati» opens, no act is picked', async () => {
    asDesktop(true);
    const user = userEvent.setup();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);

    const toggle = screen.getByRole('button', { name: /Filtri avanzati/ });
    toggle.focus();
    await user.keyboard('{Enter}');

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // still on the first step: Enter did not reach cmdk's list (no act in the field's crumb)
    expect(screen.getByPlaceholderText(/art 2043 cc/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Torna indietro/ })).toBeNull();
  });

  it('on a computer, the row chosen as it opens is the first act, favourites or not: Enter picks it', async () => {
    asDesktop(true);
    appStore.setState({ quickNorms: [quickNorm(2043)], customAliases: [alias(1)] });
    const user = userEvent.setup();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('option', { name: 'Costituzione · Cost.' })).toHaveAttribute('aria-selected', 'true'));
    await user.keyboard('{Enter}');
    // Costituzione asks for its article
    expect(screen.getByRole('button', { name: 'Torna indietro: Costituzione' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: "Numero dell'articolo" })).toBeInTheDocument();
  });

  it('tells a screen reader what the box was read as, a norm too', async () => {
    asDesktop(true);
    const user = userEvent.setup();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(screen.getByRole('combobox')).toHaveAccessibleDescription('Scrivi una citazione: art. 2043 c.c., l. 241/1990, Cass. civ. 10787/2024');
    await user.type(screen.getByRole('combobox'), 'art 2043 cc');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Premi Invio per cercare\.$/));
  });
});

describe('CommandPalette — what the box was read as', () => {
  it('is one strong row in place of the columns, chosen, and Enter opens it', async () => {
    asDesktop(true);
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={onSearch} />);

    await user.type(screen.getByRole('combobox'), 'art 2043 cc');
    const row = await screen.findByRole('option', { name: "art. 2043 c.c. · Apri l'articolo ↵" });
    await waitFor(() => expect(row).toHaveAttribute('aria-selected', 'true'));
    // no empty columns left behind
    expect(screen.queryByText('Scegli l\'atto')).toBeNull();
    expect(screen.queryByText('Premi Invio per cercare')).toBeNull();

    await user.click(row);
    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ act_type: 'codice civile', article: '2043' }));
  });

  it('keeps under it what still matches, a favourite with the same article', async () => {
    asDesktop(true);
    appStore.setState({ quickNorms: [quickNorm(2043)] });
    const user = userEvent.setup();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);

    await user.type(screen.getByRole('combobox'), 'art 2043 cc');
    await screen.findByRole('option', { name: "art. 2043 c.c. · Apri l'articolo ↵" });
    // the strong row first, then the favourite
    expect(optionNames()).toEqual(["art. 2043 c.c. · Apri l'articolo ↵", 'Art. 2043 c.c.Codice civile']);
  });
});

describe('CommandPalette — the field and its line', () => {
  it('puts the focus ring on the field\'s border, not around the box inside it', () => {
    asDesktop(true);
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    const box = screen.getByRole('combobox');
    expect(box).toHaveClass('focus-visible:ring-0', 'focus-visible:ring-offset-0');
    expect(box.parentElement).toHaveClass('border', 'focus-within:ring-2');
  });

  it('never draws a field under 16 px, so Safari on an iPhone does not zoom into it, with the text size «piccolo» too', async () => {
    asDesktop(false);
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(screen.getByRole('combobox')).toHaveClass('text-[length:max(1.125rem,16px)]');
    await userEvent.setup().click(screen.getByRole('button', { name: /Filtri avanzati/ }));
    const years = screen.getAllByRole('spinbutton');
    expect(years.length).toBeGreaterThan(0);
    for (const year of years) {
      expect(year).toHaveClass('text-[length:max(1rem,16px)]', 'md:text-sm');
      expect(year).not.toHaveClass('text-base');
    }
  });
});

describe('CommandPalette — on a phone, the order', () => {
  it('puts «A portata di mano» first when it holds something, the acts first otherwise', () => {
    asDesktop(false);
    appStore.setState({ quickNorms: [quickNorm(2043)] });
    const { unmount } = render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(optionNames()[0]).toBe('Art. 2043 c.c.Codice civile');
    unmount();

    appStore.setState({ quickNorms: [], customAliases: [] });
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(optionNames()[0]).toBe('Costituzione · Cost.');
  });
});

describe('CommandPalette — on a phone, the keyboard (R2)', () => {
  it('watches the visual viewport only while the menu is open on a phone, and is as tall as it leaves', () => {
    const viewport = Object.assign(new EventTarget(), { height: 500 });
    const listen = vi.spyOn(viewport, 'addEventListener');
    const unlisten = vi.spyOn(viewport, 'removeEventListener');
    vi.stubGlobal('visualViewport', viewport);
    asDesktop(false);
    const { rerender } = render(<CommandPalette isOpen={false} onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(listen).not.toHaveBeenCalled();

    rerender(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(listen).toHaveBeenCalledWith('resize', expect.any(Function));
    const dialog = screen.getByRole('dialog', { name: 'Menu di ricerca' });
    expect(dialog.style.getPropertyValue('--palette-max-h')).toBe('min(40rem, calc(500px - 1rem - env(safe-area-inset-top)))');

    rerender(<CommandPalette isOpen={false} onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(unlisten).toHaveBeenCalledWith('resize', listen.mock.calls[0][1]);
  });

  it('on a computer watches nothing', () => {
    const viewport = Object.assign(new EventTarget(), { height: 500 });
    const listen = vi.spyOn(viewport, 'addEventListener');
    vi.stubGlobal('visualViewport', viewport);
    asDesktop(true);
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(listen).not.toHaveBeenCalled();
  });
});

describe('CommandPalette — on a phone, the focus back (R2)', () => {
  it('gives the focus back to what opened it as it closes, on a phone too (R2: the same panel)', async () => {
    asDesktop(false);
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { rerender } = render(<CommandPalette isOpen={false} onClose={vi.fn()} onSearch={vi.fn()} />);
    rerender(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(opener).not.toHaveFocus();
    rerender(<CommandPalette isOpen={false} onClose={vi.fn()} onSearch={vi.fn()} />);
    await waitFor(() => expect(opener).toHaveFocus());
    opener.remove();
  });
});
