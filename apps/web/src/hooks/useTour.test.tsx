import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The setup mocks the hook for the components; this is the hook itself.
vi.unmock('./useTour');

// driver.js, reduced to what the hook asks of it: a driver that is active from `drive` to `destroy`.
type DriverOptions = {
  onDestroyStarted?: () => void;
  onDestroyed?: () => void;
  onPopoverRender?: (popover: { closeButton: HTMLButtonElement }) => void;
  steps: unknown[];
};
const made: Array<{ active: boolean; destroy: () => void; options: DriverOptions }> = [];
vi.mock('driver.js', () => ({
  driver: (options: DriverOptions) => {
    const d = {
      active: false,
      options,
      drive() { d.active = true; },
      isActive: () => d.active,
      destroy() { d.active = false; options.onDestroyed?.(); },
    };
    made.push(d);
    return d;
  },
}));
vi.mock('driver.js/dist/driver.css', () => ({}));

import { useTour } from './useTour';
import { TOUR_STORAGE_KEY, TOUR_VERSION } from '../config/tourConfig';

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
  it('a second tour asked while one is on screen is not started over it, and stays unseen', () => {
    const first = renderHook(() => useTour());
    const second = renderHook(() => useTour());
    act(() => { first.result.current.tryStartTour('welcome'); second.result.current.tryStartTour('search'); vi.advanceTimersByTime(400); });
    expect(made).toHaveLength(1);
    expect(seen('search')).toBe(false);
  });

  it('once the first is closed the next can start', () => {
    const first = renderHook(() => useTour());
    act(() => { first.result.current.tryStartTour('welcome'); vi.advanceTimersByTime(400); });
    act(() => { made[0].options.onDestroyStarted?.(); });
    expect(seen('welcome')).toBe(true);
    const second = renderHook(() => useTour());
    act(() => { second.result.current.tryStartTour('search'); vi.advanceTimersByTime(400); });
    expect(made).toHaveLength(2);
  });

  it('a tour seen while the request waited is not started', () => {
    const { result } = renderHook(() => useTour());
    act(() => { result.current.tryStartTour('welcome'); });
    localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify({ version: TOUR_VERSION, completed: { welcome: true } }));
    act(() => { vi.advanceTimersByTime(400); });
    expect(made).toHaveLength(0);
  });
});

describe('useTour — the popover speaks Italian', () => {
  it('names driver.js\'s close button «Chiudi» on every step (driver.js writes «Close» and has no option for it)', () => {
    const { result } = renderHook(() => useTour());
    act(() => { result.current.startTour('welcome'); });
    const closeButton = document.createElement('button');
    closeButton.setAttribute('aria-label', 'Close');
    made[0].options.onPopoverRender?.({ closeButton });
    expect(closeButton).toHaveAttribute('aria-label', 'Chiudi');
  });
});
