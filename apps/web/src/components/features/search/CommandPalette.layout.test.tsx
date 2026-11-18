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
import { ISLAND_CLOSE, ISLAND_OPEN } from '../../../lib/motion';
import { appStore } from '../../../store/useAppStore';
import { SEARCH_FIELD_FORM_ID, SEARCH_ISLAND_ID } from '../../../utils/searchFieldControl';
import type { CustomAlias, QuickNorm } from '../../../types';

/**
 * The search menu (L-75): the field grows in the bar out of the pill or the search page's field, the lists are a band
 * under the bars, in the page's flow; the list of acts and «A portata di mano», the filters and the keys at the foot. The
 * behaviour behind it is `CommandPalette.test.tsx`'s.
 */

function asDesktop(desktop: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    // The island reads «riduci movimento» from here (LC85); every other query is the width's.
    matches: query.includes('reduced-motion') ? motionPref.reduced : desktop, media: query, onchange: null,
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

/**
 * A bar as `TopBar`, `PhoneTopBar` and the search page's bar draw it (L-75): what the field grows from (the pill, or the
 * search page's field) and the slot it grows in. `over`: it lies over the content, as the phone's.
 */
function bar({ from = 'pill', over = false }: { from?: 'pill' | 'field' | 'compact'; over?: boolean } = {}) {
  const holder = document.createElement('div');
  holder.setAttribute('data-palette-bar', over ? 'over' : '');
  const source = document.createElement(from === 'pill' ? 'button' : 'form');
  if (from === 'pill') source.id = SEARCH_ISLAND_ID;
  else source.id = SEARCH_FIELD_FORM_ID;
  if (from === 'compact') source.setAttribute('data-compact', '');
  const slot = document.createElement('div');
  slot.setAttribute('data-palette-slot', '');
  holder.append(source, slot);
  document.body.append(holder);
  return { holder, source, slot };
}

afterEach(() => {
  document.querySelectorAll('[data-palette-bar]').forEach((el) => el.remove());
});

const band = () => screen.getByRole('region', { name: 'Menu di ricerca' });

describe('CommandPalette — where it opens (L-75: in the page, nothing over it)', () => {
  it('on a computer, the field grows in the bar that holds the pill, «Chiudi» beside it, the lists in a band under it, the keys at its foot', () => {
    asDesktop(true);
    const { slot } = bar();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(slot).toContainElement(screen.getByRole('combobox'));
    expect(slot).toContainElement(screen.getByRole('button', { name: 'Chiudi' }));
    expect(band()).not.toContainElement(screen.getByRole('combobox'));
    expect(band()).toContainElement(screen.getByText('Naviga'));
    // No dialog, no veil, nothing fixed.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[data-palette-veil]')).toBeNull();
    expect(document.querySelector('.fixed')).toBeNull();
  });

  it('on the search page, grows in the bar out of its field, the compact one from lg as the large one below', () => {
    asDesktop(true);
    const { slot } = bar({ from: 'compact' });
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(slot).toContainElement(screen.getByRole('combobox'));
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

  it('is as tall as what it holds, up to its maximum, on a computer: no fixed height (Bill)', () => {
    asDesktop(true);
    bar();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(band().style.height).toBe('');
    const column = band().querySelector<HTMLElement>('.max-w-3xl')!;
    expect(column).toHaveClass('max-h-[var(--palette-max-h)]');
    expect(column.style.getPropertyValue('--palette-max-h')).toBe('min(40rem, calc(100dvh - 12rem))');
  });

  it('with no bar (a lesson, full screen below lg), the field is the band\'s first row', () => {
    asDesktop(true);
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(band()).toContainElement(screen.getByRole('combobox'));
    expect(band()).toContainElement(screen.getByRole('button', { name: 'Chiudi' }));
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

  it('on a phone, the field grows in the bar, the band starts under the bar over the content and fills the page under it; no keys (R2)', () => {
    asDesktop(false);
    const { slot } = bar({ over: true });
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(slot).toContainElement(screen.getByRole('combobox'));
    expect(within(slot).getByRole('button', { name: 'Chiudi' })).toBeInTheDocument();
    expect(band().firstElementChild!.firstElementChild).toHaveClass('pt-[calc(3.5rem+env(safe-area-inset-top))]');
    expect(band().querySelector('.max-w-3xl')).toHaveClass('h-[var(--palette-max-h)]');
    expect(screen.queryByText('Naviga')).toBeNull();
  });
});

describe('CommandPalette — the island in the bar (LC69, L-75)', () => {
  type Run = { el: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions; animation: Animation };
  let runs: Run[] = [];
  /** jsdom has no Web Animations: one that records what it was asked, each animation ending when told to. */
  function recordAnimations() {
    runs = [];
    Object.defineProperty(Element.prototype, 'animate', {
      value: vi.fn(function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
        const animation = { cancel: vi.fn(), onfinish: null, playState: 'running', effect: { target: this } } as unknown as Animation;
        runs.push({ el: this, keyframes, options, animation });
        return animation;
      }),
      configurable: true,
      writable: true,
    });
  }
  /** The bar's pill in the middle of a 1024 px window, and the 768 px field it grows into, on the pill's line. */
  function pillInBar() {
    const { source: pill, slot } = bar();
    pill.style.borderTopLeftRadius = '16px';
    const rect = (left: number, top: number, width: number, height: number) =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    const own = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this === pill) return rect(336, 10, 352, 32);
      if (this.parentElement === slot) return rect(128, 10, 768, 32);
      return own.call(this);
    });
    return pill;
  }
  const shapeOf = () => document.querySelector<HTMLElement>('[data-island-shape]')!;
  const contentOf = () => document.querySelector<HTMLElement>('[data-island-content]')!;
  const runOn = (el: Element) => runs.filter((run) => run.el === el).at(-1)!;
  const end = (run: Run) => act(() => (run.animation.onfinish as unknown as () => void)?.());

  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'animate');
  });

  it('the field grows out of the pill to both sides, one time and one curve; «Chiudi» fades in; the pill hidden under it', async () => {
    asDesktop(true);
    recordAnimations();
    const pill = pillInBar();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    // Started once the mount is over (the pill shows meanwhile), never under its long frames.
    expect(runs.find((run) => run.el === shapeOf())).toBeUndefined();
    expect(pill.style.opacity).toBe('');
    await waitFor(() => expect(runOn(shapeOf())).toBeDefined());
    const grow = runOn(shapeOf());
    expect(grow.keyframes[0]).toMatchObject({ top: '0px', right: '208px', bottom: '0px', left: '208px', borderRadius: '16px' });
    expect(grow.keyframes.at(-1)).toMatchObject({ top: '0px', right: '0px', bottom: '0px', left: '0px' });
    expect(grow.options).toMatchObject(ISLAND_OPEN);
    expect(runOn(contentOf()).keyframes[0]).toEqual({ clipPath: 'inset(0px 208px 0px 208px round 16px)' });
    // LC81: the field is the pill from the first frame, on its box (FLIP: a move and its width) …
    const field = runOn(document.querySelector('[data-island-field]')!);
    expect(field.keyframes[0]).toEqual({ transform: 'translate(336px, 10px)', minWidth: '352px', maxWidth: '352px', opacity: 1 });
    expect(field.keyframes.at(-1)).toMatchObject({ transform: 'translate(0px, 0px)', opacity: 1 });
    expect(field.options).toMatchObject(ISLAND_OPEN);
    // … and «Chiudi» fades in beside it, from a quarter of the way.
    expect(runOn(screen.getByRole('button', { name: 'Chiudi' })).keyframes).toEqual([{ opacity: 0 }, { opacity: 0, offset: 0.25 }, { opacity: 1 }]);
    expect(pill.style.opacity).toBe('0');
    expect(document.querySelector('[data-palette-veil]')).toBeNull();
    end(grow);
    expect(grow.animation.cancel).toHaveBeenCalled();
  });

  it('the band grows in height and pushes the page, by the island\'s times; closing, the reverse', () => {
    asDesktop(true);
    recordAnimations();
    pillInBar();
    const { rerender } = render(<CommandPalette isOpen={false} onClose={vi.fn()} onSearch={vi.fn()} />);
    rerender(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    const open = runOn(band());
    expect(Object.keys(open.keyframes[0])).toEqual(['height']);
    expect(open.keyframes[0]).toEqual({ height: '0px' });
    expect(open.options).toMatchObject(ISLAND_OPEN);
    rerender(<CommandPalette isOpen={false} onClose={vi.fn()} onSearch={vi.fn()} />);
    // Going: `aria-hidden`, no longer named.
    const shut = runOn(document.querySelector('[data-palette-band]')!);
    expect(shut.keyframes.at(-1)).toEqual({ height: '0px' });
    expect(shut.options).toMatchObject(ISLAND_CLOSE);
  });

  it('closes back into the pill, and shows the pill again only as the field lands', async () => {
    asDesktop(true);
    recordAnimations();
    const pill = pillInBar();
    const { rerender } = render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    await waitFor(() => expect(runOn(shapeOf())).toBeDefined());
    end(runOn(shapeOf()));

    rerender(<CommandPalette isOpen={false} onClose={vi.fn()} onSearch={vi.fn()} />);
    const shrink = runOn(shapeOf());
    expect(shrink.keyframes.at(-1)).toMatchObject({ top: '0px', right: '208px', bottom: '0px', left: '208px', opacity: 0 });
    expect(shrink.options).toMatchObject(ISLAND_CLOSE);
    // LC81: the field lands on the pill, and gives way to it in the shape's crossfade.
    expect(runOn(document.querySelector('[data-island-field]')!).keyframes.at(-1)).toMatchObject({ transform: 'translate(336px, 10px)', maxWidth: '352px', opacity: 0 });
    const back = runOn(pill);
    expect(back.keyframes).toEqual([{ opacity: 0 }, { opacity: 0, offset: 0.99 }, { opacity: 1 }]);
    expect(back.options).toMatchObject(ISLAND_CLOSE);
    expect(pill.style.opacity).toBe('0');
    end(shrink);
    expect(pill.style.opacity).toBe('');
    await waitFor(() => expect(document.querySelector('[data-palette-slot]')).toBeEmptyDOMElement());
  });

  it('opened again while it closes grows from where it is on screen', async () => {
    asDesktop(true);
    recordAnimations();
    const pill = pillInBar();
    const caught: Record<string, string> = { top: '0px', right: '120px', bottom: '0px', left: '120px', borderRadius: '15px', opacity: '0.4', clipPath: 'inset(0px 120px 0px 120px round 15px)' };
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
      const style = computed(el, pseudo);
      const mid = runs.some((run) => run.el === el && run.options.duration === ISLAND_CLOSE.duration);
      if (!mid) return style;
      return new Proxy(style, { get: (target, key) => (typeof key === 'string' && key in caught ? caught[key] : Reflect.get(target, key)) });
    });
    const { rerender } = render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    await waitFor(() => expect(runOn(shapeOf())).toBeDefined());
    rerender(<CommandPalette isOpen={false} onClose={vi.fn()} onSearch={vi.fn()} />);
    const closing = runOn(shapeOf());
    // Renders while it closes start no second closing.
    rerender(<CommandPalette isOpen={false} onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(runOn(shapeOf())).toBe(closing);

    rerender(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(closing.animation.cancel).toHaveBeenCalled();
    const again = runOn(shapeOf());
    expect(again).not.toBe(closing);
    expect(again.keyframes[0]).toMatchObject({ top: '0px', right: '120px', bottom: '0px', left: '120px', borderRadius: '15px', opacity: '0.4' });
    expect(again.options).toMatchObject(ISLAND_OPEN);
    expect(runOn(contentOf()).keyframes[0]).toMatchObject({ clipPath: caught.clipPath });
    expect(shapeOf().parentElement!.style.pointerEvents).toBe('');
    expect(runOn(pill).animation.cancel).toHaveBeenCalled();
    expect(pill.style.opacity).toBe('0');
  });

  it('closed before it started is gone at once, the pill never hidden', async () => {
    asDesktop(true);
    recordAnimations();
    const pill = pillInBar();
    const { rerender } = render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    rerender(<CommandPalette isOpen={false} onClose={vi.fn()} onSearch={vi.fn()} />);
    await waitFor(() => expect(document.querySelector('[data-palette-slot]')).toBeEmptyDOMElement());
    expect(runs.filter((run) => run.el.hasAttribute('data-island-shape'))).toEqual([]);
    expect(pill.style.opacity).toBe('');
  });

  it('under reduced motion only fades, by the same times', async () => {
    asDesktop(true);
    recordAnimations();
    motionPref.reduced = true;
    const pill = pillInBar();
    const { rerender } = render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    const root = () => shapeOf().parentElement!;
    await waitFor(() => expect(runOn(root())).toBeDefined());
    expect(runOn(root()).keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(runOn(root()).options).toMatchObject(ISLAND_OPEN);
    expect(runs.filter((run) => run.el === shapeOf())).toEqual([]);
    expect(pill.style.opacity).toBe('');
    rerender(<CommandPalette isOpen={false} onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(runOn(root()).keyframes.at(-1)).toEqual({ opacity: 0 });
    expect(runOn(root()).options).toMatchObject(ISLAND_CLOSE);
  });

  it('follows the page to its new bar when the bar it grew in goes while open (/sentenze → /)', () => {
    asDesktop(false);
    const first = bar({ over: true });
    const { rerender } = render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(first.slot).toContainElement(screen.getByRole('combobox'));
    first.holder.remove();
    const second = bar({ from: 'field' });
    rerender(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(second.slot).toContainElement(screen.getByRole('combobox'));
    expect(band().firstElementChild!.firstElementChild).not.toHaveClass('pt-[calc(3.5rem+env(safe-area-inset-top))]');
  });

  it('without Web Animations draws the field at once, nothing left hidden', () => {
    asDesktop(true);
    bar();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    const root = shapeOf().parentElement!;
    expect(root.style.opacity).toBe('');
    expect(contentOf().style.clipPath).toBe('');
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
    expect(screen.getByPlaceholderText(/^Norma, sentenza o tema/)).toBeInTheDocument();
  });

  it('goes back a step with Backspace on the empty field it opens with, from the keyboard alone (R2, Bill)', async () => {
    asDesktop(true);
    const user = userEvent.setup();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    // «Codice penale», Enter: the article's field, empty, has the focus.
    await user.type(screen.getByPlaceholderText(/^Norma, sentenza o tema/), 'codice penale{Enter}');
    const box = await screen.findByRole('textbox', { name: "Numero dell'articolo" });
    await waitFor(() => expect(box).toHaveFocus());
    expect(box).toHaveValue('');
    await user.keyboard('{Backspace}');
    expect(screen.getByPlaceholderText(/^Norma, sentenza o tema/)).toBeInTheDocument();
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
    expect(screen.getByText('Nessun preferito: «Aggiungi alle norme rapide», nel menu ⋯ di un articolo, lo porta qui')).toBeInTheDocument();
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
    expect(screen.getByPlaceholderText(/^Norma, sentenza o tema/)).toBeInTheDocument();
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
    // LC81: one edge, the pill's rule: 2 px only from the keyboard (`data-keyboard`), never the tinted ring of old.
    expect(box.parentElement).toHaveClass('border', 'data-[keyboard]:has-[input:focus]:ring-1');
    expect(box.parentElement!.className).not.toMatch(/focus-within/);
  });

  it('never draws a field under 16 px, so Safari on an iPhone does not zoom into it, with the text size «piccolo» too', async () => {
    asDesktop(false);
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(screen.getByRole('combobox')).toHaveClass('text-[length:max(1rem,16px)]');
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
    const column = screen.getByRole('region', { name: 'Menu di ricerca' }).querySelector<HTMLElement>('.max-w-3xl')!;
    expect(column.style.getPropertyValue('--palette-max-h')).toBe('calc(500px - 3.5rem - env(safe-area-inset-top))');

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
