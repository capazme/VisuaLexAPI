import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useHideOnScroll } from './useHideOnScroll';

function scroller() {
  const el = document.createElement('div');
  let top = 0;
  Object.defineProperty(el, 'scrollTop', { get: () => top, set: (v: number) => { top = v; }, configurable: true });
  const to = (value: number) => act(() => {
    top = value;
    el.dispatchEvent(new Event('scroll'));
  });
  return { el, to };
}

describe('useHideOnScroll', () => {
  it('hides the bar scrolling down past its height and shows it again scrolling up', () => {
    const { el, to } = scroller();
    const { result } = renderHook(() => useHideOnScroll(el, { enabled: true, resetKey: '/forum' }));
    expect(result.current.hidden).toBe(false);
    to(40);
    expect(result.current.hidden).toBe(false);
    to(200);
    expect(result.current.hidden).toBe(true);
    to(180);
    expect(result.current.hidden).toBe(false);
  });

  it('ignores a move of a few pixels either way', () => {
    const { el, to } = scroller();
    const { result } = renderHook(() => useHideOnScroll(el, { enabled: true, resetKey: '/forum' }));
    to(300);
    expect(result.current.hidden).toBe(true);
    to(296);
    expect(result.current.hidden).toBe(true);
  });

  it('shows the bar near the top whatever the direction', () => {
    const { el, to } = scroller();
    const { result } = renderHook(() => useHideOnScroll(el, { enabled: true, resetKey: '/forum' }));
    to(300);
    to(20);
    expect(result.current.hidden).toBe(false);
  });

  it('shows the bar on a new page, on demand, and always when it is not enabled', () => {
    const { el, to } = scroller();
    const { result, rerender } = renderHook(
      ({ enabled, resetKey }) => useHideOnScroll(el, { enabled, resetKey }),
      { initialProps: { enabled: true, resetKey: '/forum' } },
    );
    to(300);
    expect(result.current.hidden).toBe(true);
    rerender({ enabled: true, resetKey: '/dossier' });
    expect(result.current.hidden).toBe(false);
    to(600);
    expect(result.current.hidden).toBe(true);
    act(() => result.current.reveal());
    expect(result.current.hidden).toBe(false);
    to(900);
    expect(result.current.hidden).toBe(true);
    rerender({ enabled: false, resetKey: '/dossier' });
    expect(result.current.hidden).toBe(false);
  });
});
