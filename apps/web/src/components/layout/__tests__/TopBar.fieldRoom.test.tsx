import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TopBar } from '../TopBar';
import { SECTIONS } from '../../../features/sections/sections';

/**
 * L-75 (Papiniano, #599): the search's field stands in the room the bar's controls leave, measured, never over them —
 * «Novità» after a release included.
 */

const rect = (left: number, width: number) =>
  ({ left, width, right: left + width, top: 0, bottom: 52, height: 52, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;

let measure: (() => void) | null = null;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  measure = null;
});

function drawBar(controlsLeft: () => number) {
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { measure = callback; }
    observe() {}
    disconnect() {}
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.getAttribute('data-testid') === 'top-bar') return rect(224, 1216);
    if (this.parentElement?.getAttribute('data-testid') === 'top-bar' && this.querySelector('button[aria-label="Novità"], button[aria-label="Tutto schermo"]')) {
      const left = controlsLeft();
      return rect(left, 1440 - 24 - left);
    }
    return rect(0, 0);
  });
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({ paddingLeft: '24px' }) as CSSStyleDeclaration);
  render(
    <MemoryRouter>
      <TopBar
        section={SECTIONS[0]}
        pathname="/pratiche"
        scroller={null}
        onSearch={vi.fn()}
        actions={<><button type="button" aria-label="Novità">Novità in v1.36.0</button><button type="button" aria-label="Tutto schermo" /></>}
      />
    </MemoryRouter>,
  );
  return document.querySelector<HTMLElement>('[data-palette-slot]')!;
}

describe('TopBar — the field\'s room (L-75)', () => {
  it('centres the field on the pill when the controls leave it room, at most 768 px', () => {
    // The bar from 224 to 1440 (centre 608 in it), the controls from 1300: room to 1064, the field 768 centred.
    const slot = drawBar(() => 1300);
    expect(slot.style.left).toBe('224px');
    expect(slot.style.width).toBe('768px');
  });

  it('moves left and narrows to keep clear of the controls, and follows them as «Novità» comes', () => {
    let left = 1300;
    const slot = drawBar(() => left);
    // «Novità» drawn: the controls from 1136 (Papiniano's 1440), 912 in the bar; the field ends 12 px before them.
    left = 1136;
    act(() => measure?.());
    const start = parseFloat(slot.style.left);
    const width = parseFloat(slot.style.width);
    expect(start + width).toBeLessThanOrEqual(1136 - 224 - 12);
    expect(width).toBe(768);
    expect(start).toBe(1136 - 224 - 12 - 768);
    // A narrow bar: the field takes what is left between the bar's start and the controls.
    left = 700;
    act(() => measure?.());
    expect(slot.style.left).toBe('24px');
    expect(slot.style.width).toBe(`${700 - 224 - 12 - 24}px`);
  });
});

// LC141 (Papiniano on #711: the centred pill covered «Novità» at 1024, and at 1280 with the wide sidebar): the bar is three
// columns, so the controls cannot sit under the search. jsdom cannot measure: the structure is the check; the widths
// are measured on screen.
describe('TopBar — three columns, the search between (LC141)', () => {
  it('lays the path, the search and the controls in a grid whose middle may shrink', () => {
    const slot = drawBar(() => 1300);
    const bar = slot.parentElement!;
    // The path to 0, the search's column flexible (the pill in it at most 22 rem), the controls never below their whole width.
    expect(bar).toHaveClass('lg:grid', 'grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(max-content,1fr)]');
    expect(bar).not.toHaveClass('lg:flex');
    const [path, search, controls] = Array.from(bar.children) as HTMLElement[];
    expect(path).toHaveAttribute('data-bar-path');
    expect(path).toHaveClass('min-w-0', 'overflow-hidden');
    expect(search).toHaveAttribute('data-bar-search');
    expect(search).toHaveClass('min-w-0');
    expect(search.className).not.toMatch(/absolute|left-1\/2/);
    expect(search.querySelector('button')).toHaveClass('w-full', 'min-w-0', 'max-w-[22rem]');
    expect(controls).toHaveClass('shrink-0', 'justify-self-end', '[&>*]:shrink-0');
    // «Novità» and «Tutto schermo» in it, none allowed to squeeze.
    expect(controls.querySelector('button[aria-label="Novità"]')).not.toBeNull();
  });
});
