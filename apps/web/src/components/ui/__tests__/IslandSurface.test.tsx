import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { AnimatePresence } from 'framer-motion';
import { IslandSurface } from '../IslandSurface';
import { originOf } from '../islandMotion';
import { ISLAND_CLOSE, ISLAND_OPEN, REPEAT_CLOSE, REPEAT_OPEN } from '../../../lib/motion';

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

/** «Riduci movimento» as a media query whose answer a test changes while the page is open. */
const motion = { reduced: false, listeners: new Set<() => void>() };
function prefer(reduced: boolean) {
  motion.reduced = reduced;
  act(() => motion.listeners.forEach((l) => l()));
}

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

let trigger: HTMLButtonElement;
beforeEach(() => {
  recordAnimations();
  motion.reduced = false;
  motion.listeners.clear();
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    get matches() { return query.includes('reduced-motion') && motion.reduced; },
    media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: (_: string, l: () => void) => motion.listeners.add(l),
    removeEventListener: (_: string, l: () => void) => motion.listeners.delete(l),
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
  // A «⋯» button (32 × 32, round) at 300,100; the menu under it, 224 × 120, its right edge on the button's.
  trigger = document.createElement('button');
  trigger.style.borderTopLeftRadius = '16px';
  document.body.append(trigger);
  const own = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this === trigger) return rect(300, 100, 32, 32);
    if (this.getAttribute('role') === 'menu') return rect(108, 136, 224, 120);
    return own.call(this);
  });
});
afterEach(() => {
  Reflect.deleteProperty(Element.prototype, 'animate');
  trigger.remove();
  vi.restoreAllMocks();
});

const shapeOf = () => document.querySelector<HTMLElement>('[data-island-shape]')!;
const contentOf = () => document.querySelector<HTMLElement>('[data-island-content]')!;
const rootOf = () => screen.queryByRole('menu', { hidden: true });
const runOn = (el: Element) => runs.filter((run) => run.el === el).at(-1)!;
const end = (run: Run) => act(() => (run.animation.onfinish as unknown as () => void)?.());

function Menu({ open }: { open: boolean }) {
  return (
    <AnimatePresence>
      {open && (
        <IslandSurface key="menu" source={trigger} role="menu" aria-label="Azioni">
          <button type="button" role="menuitem">Modifica</button>
        </IslandSurface>
      )}
    </AnimatePresence>
  );
}

describe('IslandSurface (LC85)', () => {
  it('grows out of the control outside its box at once: the shape from its rectangle and corners, the content clipped to it and seen from a quarter of the way', () => {
    render(<Menu open />);
    const grow = runOn(shapeOf());
    // The button is above the menu and at its right edge: the shape starts beyond the box.
    expect(grow.keyframes[0]).toMatchObject({ top: '-36px', right: '0px', bottom: '124px', left: '192px', borderRadius: '16px' });
    expect(grow.keyframes.at(-1)).toMatchObject({ top: '0px', right: '0px', bottom: '0px', left: '0px' });
    expect(grow.options).toMatchObject(ISLAND_OPEN);
    const show = runOn(contentOf());
    expect(show.keyframes[0]).toMatchObject({ clipPath: 'inset(-36px 0px 124px 192px round 16px)', opacity: 0 });
    expect(show.keyframes[1]).toEqual({ opacity: 0, offset: 0.25 });
    expect(show.options).toMatchObject(ISLAND_OPEN);
    // The control stays where it is (only the search's pill is hidden).
    expect(trigger.style.opacity).toBe('');
    end(grow);
    expect(grow.animation.cancel).toHaveBeenCalled();
  });

  it('closes back into the control by the inverse way, takes no key or click meanwhile, and is gone once it lands', async () => {
    const { rerender } = render(<Menu open />);
    end(runOn(shapeOf()));
    rerender(<Menu open={false} />);
    const shrink = runOn(shapeOf());
    expect(shrink.keyframes.at(-1)).toMatchObject({ top: '-36px', right: '0px', bottom: '124px', left: '192px', opacity: 0 });
    expect(shrink.options).toMatchObject(ISLAND_CLOSE);
    expect(runOn(contentOf()).keyframes.at(-1)).toMatchObject({ clipPath: 'inset(-36px 0px 124px 192px round 16px)', opacity: 0 });
    expect(rootOf()).toHaveAttribute('inert');
    expect(rootOf()!.style.pointerEvents).toBe('none');
    end(shrink);
    await waitFor(() => expect(rootOf()).toBeNull());
  });

  it('opened again while it closes goes on from where it is, and takes keys and clicks again', () => {
    const caught: Record<string, string> = { top: '-10px', right: '0px', bottom: '60px', left: '90px', borderRadius: '12px', opacity: '1', clipPath: 'inset(-10px 0px 60px 90px round 12px)' };
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
      const style = computed(el, pseudo);
      const mid = runs.some((run) => run.el === el && run.options.duration === ISLAND_CLOSE.duration);
      return mid ? new Proxy(style, { get: (target, key) => (typeof key === 'string' && key in caught ? caught[key] : Reflect.get(target, key)) }) : style;
    });
    const { rerender } = render(<Menu open />);
    rerender(<Menu open={false} />);
    const closing = runOn(shapeOf());
    rerender(<Menu open />);
    expect(closing.animation.cancel).toHaveBeenCalled();
    const again = runOn(shapeOf());
    expect(again.keyframes[0]).toMatchObject({ top: '-10px', bottom: '60px', left: '90px', borderRadius: '12px' });
    expect(again.options).toMatchObject(ISLAND_OPEN);
    expect(runOn(contentOf()).keyframes[0]).toMatchObject({ clipPath: caught.clipPath });
    expect(rootOf()).not.toHaveAttribute('inert');
    expect(rootOf()!.style.pointerEvents).toBe('');
  });

  it('grows from a rectangle where no element is (the notifications\' pill), with round ends', () => {
    render(
      <IslandSurface open source={(box) => ({ left: box.left + 52, right: box.right - 52, top: box.bottom - 32, bottom: box.bottom })} role="menu">
        <p>Nota salvata</p>
      </IslandSurface>,
    );
    expect(runOn(shapeOf()).keyframes[0]).toMatchObject({ top: '88px', right: '52px', bottom: '0px', left: '52px', borderRadius: '16px' });
  });

  it('takes the times it is given, at once with no wait: a notification\'s 200 and 150 ms (LC132)', () => {
    const timing = { open: REPEAT_OPEN, close: REPEAT_CLOSE };
    const { rerender } = render(<IslandSurface open source={trigger} timing={timing} role="menu"><p>Nota salvata</p></IslandSurface>);
    expect(runOn(shapeOf()).options).toMatchObject(REPEAT_OPEN);
    expect(runOn(shapeOf()).options.duration).toBe(200);
    rerender(<IslandSurface open={false} source={trigger} timing={timing} role="menu"><p>Nota salvata</p></IslandSurface>);
    expect(runOn(shapeOf()).options).toMatchObject(REPEAT_CLOSE);
    expect(runOn(shapeOf()).options.duration).toBe(150);
  });

  it('under reduced motion fades on the times it is given, a repeated action no slower without motion (LC133)', () => {
    motion.reduced = true;
    const timing = { open: REPEAT_OPEN, close: REPEAT_CLOSE };
    const { rerender } = render(<IslandSurface open source={trigger} timing={timing} role="menu"><p>Nota salvata</p></IslandSurface>);
    expect(runOn(rootOf()!).options).toMatchObject(REPEAT_OPEN);
    rerender(<IslandSurface open={false} source={trigger} timing={timing} role="menu"><p>Nota salvata</p></IslandSurface>);
    expect(runOn(rootOf()!).options).toMatchObject(REPEAT_CLOSE);
  });

  it('driven by its owner, says when its closing is over', async () => {
    const onClosed = vi.fn();
    const { rerender } = render(<IslandSurface open source={trigger} onClosed={onClosed} role="menu"><p>Testo</p></IslandSurface>);
    rerender(<IslandSurface open={false} source={trigger} onClosed={onClosed} role="menu"><p>Testo</p></IslandSurface>);
    expect(onClosed).not.toHaveBeenCalled();
    end(runOn(shapeOf()));
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('under reduced motion only fades, by the same times; a change of the preference with the page open counts at the next way', async () => {
    motion.reduced = true;
    const { rerender } = render(<Menu open />);
    expect(runOn(rootOf()!).keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(runOn(rootOf()!).options).toMatchObject(ISLAND_OPEN);
    expect(runs.filter((run) => run.el === shapeOf())).toEqual([]);
    end(runOn(rootOf()!));

    // Turned off while it is open: it goes back into the button.
    prefer(false);
    rerender(<Menu open={false} />);
    expect(runOn(shapeOf()).keyframes.at(-1)).toMatchObject({ top: '-36px', left: '192px', opacity: 0 });
    end(runOn(shapeOf()));
    await waitFor(() => expect(rootOf()).toBeNull());

    // Turned on again: the next opening and closing only fade.
    rerender(<Menu open />);
    prefer(true);
    rerender(<Menu open={false} />);
    expect(runOn(rootOf()!).keyframes.at(-1)).toEqual({ opacity: 0 });
    expect(runOn(rootOf()!).options).toMatchObject(ISLAND_CLOSE);
  });

  it('with nothing to grow from (the control gone, or off screen), fades', () => {
    trigger.remove();
    render(<Menu open />);
    expect(runOn(rootOf()!).keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });

  it('leaves the focus to its owner: it moves none as it opens, and a focus inside stays reachable while it is open', () => {
    trigger.focus();
    render(<Menu open />);
    expect(trigger).toHaveFocus();
    screen.getByRole('menuitem', { name: 'Modifica' }).focus();
    expect(screen.getByRole('menuitem', { name: 'Modifica' })).toHaveFocus();
  });
});

describe('originOf: what a confirmation grows from', () => {
  it('is the control while it is on the page, and the rectangle it had as the confirmation opened once it is gone', () => {
    const source = originOf(trigger) as (box: DOMRect) => { top: number; left: number; right: number; bottom: number; radius?: number };
    const box = rect(0, 0, 400, 400);
    expect(source(box)).toEqual({ top: 100, left: 300, right: 332, bottom: 132, radius: 16 });
    // A menu's entry, unmounted by the time the card grows: the saved rectangle.
    trigger.remove();
    expect(source(box)).toEqual({ top: 100, left: 300, right: 332, bottom: 132, radius: 16 });
  });

  it('is nothing where nothing on the page is named', () => {
    expect(originOf(null)).toBeNull();
    trigger.remove();
    expect(originOf(trigger)).toBeNull();
  });
});
