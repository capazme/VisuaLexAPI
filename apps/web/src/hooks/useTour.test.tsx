import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The setup mocks the hook for the components; this is the hook itself.
vi.unmock('./useTour');

// driver.js, reduced to what the hook asks of it: a driver that is active from `drive` to `destroy`.
type DriverOptions = {
  onDestroyStarted?: () => void;
  onDestroyed?: () => void;
  onPopoverRender?: (popover: { closeButton: HTMLButtonElement; wrapper: HTMLElement }) => void;
  steps: unknown[];
};
const made: Array<{ active: boolean; destroy: () => void; options: DriverOptions; element: Element | null }> = [];
vi.mock('driver.js', () => ({
  driver: (options: DriverOptions) => {
    const d = {
      active: false,
      options,
      element: null as Element | null,
      drive() { d.active = true; },
      isActive: () => d.active,
      getActiveElement: () => d.element ?? undefined,
      destroy() { d.active = false; options.onDestroyed?.(); },
    };
    made.push(d);
    return d;
  },
}));
vi.mock('driver.js/dist/driver.css', () => ({}));

import { useTour } from './useTour';
import { TOUR_STORAGE_KEY, TOUR_VERSION } from '../config/tourConfig';

// driver.js comes with the first tour: the import, then what waited for it.
const settle = () => act(async () => { await vi.dynamicImportSettled(); });
const seen = (type: string) => JSON.parse(localStorage.getItem(TOUR_STORAGE_KEY) ?? '{"completed":{}}').completed[type] === true;

beforeEach(() => {
  vi.useFakeTimers();
  // not `clear()`: the setup's storage mock is `window.localStorage` itself and would delete its own methods
  localStorage.removeItem(TOUR_STORAGE_KEY);
  made.length = 0;
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  // two elements the welcome and the search tours can point at
  document.body.innerHTML = '<div id="tour-sidebar"></div><div id="tour-nav-search"></div><div id="tour-main-content"></div>';
});
afterEach(() => {
  // the guard is module-wide: a driver left on screen by one test would block the next
  for (const d of made) if (d.active) d.destroy();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('useTour — one tour at a time', () => {
  it('a second tour asked while one is on screen is not started over it, and stays unseen', async () => {
    const first = renderHook(() => useTour());
    const second = renderHook(() => useTour());
    await act(async () => { first.result.current.tryStartTour('welcome'); second.result.current.tryStartTour('search'); await vi.advanceTimersByTimeAsync(400); }); await settle();
    expect(made).toHaveLength(1);
    expect(seen('search')).toBe(false);
  });

  it('once the first is closed the next can start', async () => {
    const first = renderHook(() => useTour());
    await act(async () => { first.result.current.tryStartTour('welcome'); await vi.advanceTimersByTimeAsync(400); }); await settle();
    act(() => { made[0].options.onDestroyStarted?.(); });
    expect(seen('welcome')).toBe(true);
    const second = renderHook(() => useTour());
    await act(async () => { second.result.current.tryStartTour('search'); await vi.advanceTimersByTimeAsync(400); }); await settle();
    expect(made).toHaveLength(2);
  });

  it('a tour seen while the request waited is not started', async () => {
    const { result } = renderHook(() => useTour());
    await act(async () => { result.current.tryStartTour('welcome'); });
    localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify({ version: TOUR_VERSION, completed: { welcome: true } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); }); await settle();
    expect(made).toHaveLength(0);
  });
});

describe('useTour — the popover speaks Italian', () => {
  it('names driver.js\'s close button «Chiudi» on every step (driver.js writes «Close» and has no option for it)', async () => {
    const { result } = renderHook(() => useTour());
    await act(async () => { result.current.startTour('welcome'); }); await settle();
    const closeButton = document.createElement('button');
    closeButton.setAttribute('aria-label', 'Close');
    made[0].options.onPopoverRender?.({ closeButton, wrapper: document.createElement('div') });
    expect(closeButton).toHaveAttribute('aria-label', 'Chiudi');
  });
});

describe('useTour — the focus it gives (Y1)', () => {
  const popover = () => {
    const wrapper = document.createElement('div');
    const closeButton = document.createElement('button');
    wrapper.append(closeButton);
    document.body.append(wrapper);
    return { wrapper, closeButton };
  };

  it('a focus given to its ✕ after a click shows no ring until it leaves', async () => {
    const { result } = renderHook(() => useTour());
    await act(async () => { result.current.startTour('welcome'); }); await settle();
    window.dispatchEvent(new Event('pointerdown'));
    const p = popover();
    made[0].options.onPopoverRender?.(p);
    p.closeButton.focus();
    expect(p.closeButton).toHaveAttribute('data-pointer-focus');
    p.closeButton.blur();
    expect(p.closeButton).not.toHaveAttribute('data-pointer-focus');
  });

  it('a tour that starts after some typing still gives its first focus no ring', async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    const { result } = renderHook(() => useTour());
    await act(async () => { result.current.startTour('welcome'); }); await settle();
    const p = popover();
    made[0].options.onPopoverRender?.(p);
    p.closeButton.focus();
    expect(p.closeButton).toHaveAttribute('data-pointer-focus');
  });

  it('after a key pressed in the tour, the focus keeps its ring', async () => {
    const { result } = renderHook(() => useTour());
    await act(async () => { result.current.startTour('welcome'); }); await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    const p = popover();
    made[0].options.onPopoverRender?.(p);
    p.closeButton.focus();
    expect(p.closeButton).not.toHaveAttribute('data-pointer-focus');
  });
});

describe('useTour — a window that changes its layout (Y1)', () => {
  const resizeTo = (width: number) => {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    act(() => {
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(20);
    });
  };

  it('closes the tour when the window passes to another layout, and leaves it unseen', async () => {
    const { result } = renderHook(() => useTour());
    await act(async () => { result.current.startTour('welcome'); }); await settle();
    resizeTo(1100);
    expect(made[0].active).toBe(true);
    resizeTo(390);
    expect(made[0].active).toBe(false);
    expect(seen('welcome')).toBe(false);
  });

  it('closes it when the element it points at is no longer drawn', async () => {
    const { result } = renderHook(() => useTour());
    await act(async () => { result.current.startTour('welcome'); }); await settle();
    const element = document.getElementById('tour-sidebar')!;
    made[0].element = element;
    element.getClientRects = () => [{}] as unknown as DOMRectList;
    resizeTo(1300);
    expect(made[0].active).toBe(true);
    element.getClientRects = () => [] as unknown as DOMRectList;
    resizeTo(1310);
    expect(made[0].active).toBe(false);
  });

  it('stops listening once the tour is gone', async () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { result } = renderHook(() => useTour());
    await act(async () => { result.current.startTour('welcome'); }); await settle();
    act(() => { made[0].destroy(); });
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
  });
});

describe('useTour — driver.js comes with the first tour', () => {
  it('a tour stopped while driver.js is on its way does not start', async () => {
    const { result } = renderHook(() => useTour());
    act(() => { result.current.startTour('welcome'); result.current.stopTour(); });
    await settle();
    expect(made).toHaveLength(0);
    // Asked again, it starts: the load had settled.
    await act(async () => { result.current.startTour('welcome'); }); await settle();
    expect(made).toHaveLength(1);
  });

  it('a surface that goes away while driver.js is on its way takes its tour with it', async () => {
    const { result, unmount } = renderHook(() => useTour());
    act(() => { result.current.startTour('welcome'); });
    unmount();
    await settle();
    expect(made).toHaveLength(0);
  });
});
