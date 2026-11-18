import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AnimatePresence } from 'framer-motion';
import { MenuSurface } from '../MenuSurface';
import { MenuButton } from '../MenuButton';
import { MENU_CLOSE, MENU_FADE, MENU_OPEN } from '../../../lib/motion';

type Run = { el: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions; animation: Animation };
let runs: Run[] = [];
let reduced = false;

beforeEach(() => {
  runs = [];
  reduced = false;
  // jsdom has no Web Animations: one that records what it was asked, each animation ending when told to.
  Object.defineProperty(Element.prototype, 'animate', {
    value: vi.fn(function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      const animation = { cancel: vi.fn(), onfinish: null } as unknown as Animation;
      runs.push({ el: this, keyframes, options, animation });
      return animation;
    }),
    configurable: true,
    writable: true,
  });
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query.includes('reduced-motion') && reduced,
    media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
});
afterEach(() => {
  Reflect.deleteProperty(Element.prototype, 'animate');
  vi.restoreAllMocks();
});

const menu = () => screen.queryByRole('menu', { hidden: true });
const last = () => runs.at(-1)!;
const end = (run: Run) => act(() => (run.animation.onfinish as unknown as () => void)?.());

function Menu({ open, above }: { open: boolean; above?: boolean }) {
  return (
    <AnimatePresence>
      {open && (
        <MenuSurface key="menu" role="menu" aria-label="Azioni" above={above}>
          <button type="button" role="menuitem">Modifica</button>
        </MenuSurface>
      )}
    </AnimatePresence>
  );
}

describe('MenuSurface (LC102, variant A)', () => {
  it('opens under its trigger by a fade and 4 px, and closes the same way, on the menu tokens', async () => {
    const { rerender } = render(<Menu open />);
    expect(last().el).toBe(menu());
    expect(last().keyframes).toEqual([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }]);
    expect(last().options).toMatchObject(MENU_OPEN);
    expect(MENU_OPEN).toEqual({ duration: 140, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
    const opening = last();
    end(opening);
    expect(opening.animation.cancel).toHaveBeenCalled();

    rerender(<Menu open={false} />);
    expect(last().keyframes).toEqual([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-4px)' }]);
    expect(last().options).toMatchObject(MENU_CLOSE);
    expect(MENU_CLOSE.duration).toBe(100);
    // Closing, it takes no key and no click; gone once it has faded.
    expect(menu()).toHaveAttribute('inert');
    expect(menu()!.style.pointerEvents).toBe('none');
    end(last());
    await waitFor(() => expect(menu()).toBeNull());
  });

  it('over its trigger, it comes down towards it', () => {
    render(<Menu open above />);
    expect(last().keyframes[0]).toEqual({ opacity: 0, transform: 'translateY(4px)' });
  });

  it('opened again while it closes goes on from where it is', () => {
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
      const style = computed(el, pseudo);
      const caught: Record<string, string> = { opacity: '0.4', transform: 'matrix(1, 0, 0, 1, 0, -2)' };
      return new Proxy(style, { get: (target, key) => (typeof key === 'string' && key in caught ? caught[key] : Reflect.get(target, key)) });
    });
    const { rerender } = render(<Menu open />);
    end(last());
    rerender(<Menu open={false} />);
    const closing = last();
    rerender(<Menu open />);
    expect(closing.animation.cancel).toHaveBeenCalled();
    expect(last().keyframes).toEqual([{ opacity: '0.4', transform: 'matrix(1, 0, 0, 1, 0, -2)' }, { opacity: 1, transform: 'none' }]);
    expect(last().options).toMatchObject(MENU_OPEN);
    expect(menu()).not.toHaveAttribute('inert');
  });

  it('under reduced motion only fades, 150 ms linear', () => {
    reduced = true;
    const { rerender } = render(<Menu open />);
    expect(last().keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(last().options).toMatchObject(MENU_FADE);
    expect(MENU_FADE).toEqual({ duration: 150, easing: 'linear' });
    end(last());
    rerender(<Menu open={false} />);
    expect(last().keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(last().options).toMatchObject(MENU_FADE);
  });
});

describe('MenuButton on MenuSurface', () => {
  it('moves no focus while it animates: Escape closes it and gives the focus back to the trigger, a click outside closes it', async () => {
    render(
      <div>
        <MenuButton label="Azioni" items={[{ label: 'Modifica', onSelect: vi.fn() }, { label: 'Elimina', onSelect: vi.fn() }]}>⋯</MenuButton>
        <button type="button">fuori</button>
      </div>,
    );
    const trigger = screen.getByRole('button', { name: 'Azioni' });
    fireEvent.click(trigger);
    expect(last().options).toMatchObject(MENU_OPEN);
    expect(screen.getByRole('menuitem', { name: 'Modifica' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Modifica' }), { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Elimina' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(trigger).toHaveFocus();
    expect(last().options).toMatchObject(MENU_CLOSE);
    end(last());
    await waitFor(() => expect(menu()).toBeNull());

    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'fuori' }));
    expect(last().options).toMatchObject(MENU_CLOSE);
  });
});
