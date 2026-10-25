import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { sidebarWidthStore, useDesktopSidebar, SIDEBAR_RAIL_WIDTH, SIDEBAR_WIDE_WIDTH } from './sidebarWidth';

/** A `matchMedia` that answers `xl` as told, and lets the test fire a change. */
function stubViewport(wide: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    matches: wide,
    addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.delete(fn),
  };
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
    expect(query).toBe('(min-width: 1280px)');
    return mql as unknown as MediaQueryList;
  });
  return (matches: boolean) => {
    mql.matches = matches;
    listeners.forEach((fn) => fn({ matches } as MediaQueryListEvent));
  };
}

beforeEach(() => {
  window.localStorage.removeItem('visualex-sidebar');
  sidebarWidthStore.setState({ collapsed: false });
});
afterEach(() => vi.restoreAllMocks());

describe('the desktop sidebar\'s width (Gymnasium spec §4)', () => {
  it('shows the words from xl, wide by default, with a toggle', () => {
    stubViewport(true);
    const { result } = renderHook(() => useDesktopSidebar());
    expect(result.current.layout).toBe('wide');
    expect(result.current.width).toBe(SIDEBAR_WIDE_WIDTH);
    expect(result.current.toggle).toBeTypeOf('function');
  });

  it.each([false, true])('is the icon rail below xl, with no toggle, whatever the stored choice (narrowed: %s)', (collapsed) => {
    sidebarWidthStore.setState({ collapsed });
    stubViewport(false);
    const { result } = renderHook(() => useDesktopSidebar());
    expect(result.current).toMatchObject({ layout: 'rail', width: SIDEBAR_RAIL_WIDTH, toggle: undefined });
  });

  it('narrows and widens, and remembers it in the browser', () => {
    stubViewport(true);
    const { result } = renderHook(() => useDesktopSidebar());
    act(() => result.current.toggle?.());
    expect(result.current.layout).toBe('rail');
    expect(JSON.parse(window.localStorage.getItem('visualex-sidebar') ?? '{}').state).toEqual({ collapsed: true });
    act(() => result.current.toggle?.());
    expect(result.current.layout).toBe('wide');
  });

  it('follows the window across xl', () => {
    const resize = stubViewport(true);
    const { result } = renderHook(() => useDesktopSidebar());
    act(() => resize(false));
    expect(result.current.layout).toBe('rail');
    act(() => resize(true));
    expect(result.current.layout).toBe('wide');
  });

  it('keeps the choice for the session when the browser refuses to store it', () => {
    stubViewport(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { result } = renderHook(() => useDesktopSidebar());
    act(() => result.current.toggle?.());
    expect(result.current.layout).toBe('rail');
    expect(warn).toHaveBeenCalled();
  });
});
