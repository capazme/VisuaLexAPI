import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useHideOnScroll } from './useHideOnScroll';

/** The viewport: a phone (below md) unless a test says otherwise. */
let phone = true;
const original = window.matchMedia;
beforeEach(() => {
  phone = true;
  window.matchMedia = ((query: string) => ({
    ...original(query),
    matches: query === '(max-width: 767.98px)' ? phone : false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as typeof window.matchMedia;
});
afterEach(() => {
  window.matchMedia = original;
});

/** A scroller 4000 px tall in an 800 px window: the last real scroll top is 3200. */
function scroller() {
  const el = document.createElement('div');
  let top = 0;
  Object.defineProperty(el, 'scrollTop', { get: () => top, set: (v: number) => { top = v; }, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: 4000, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 800, configurable: true });
  const to = (value: number) => act(() => {
    top = value;
    el.dispatchEvent(new Event('scroll'));
  });
  return { el, to };
}

const hook = (el: HTMLElement, bar: HTMLElement | null = null) =>
  renderHook(({ enabled, resetKey }) => useHideOnScroll(el, { enabled, resetKey, bar }), { initialProps: { enabled: true, resetKey: '/forum' } });

describe('useHideOnScroll', () => {
  it('hides the bar scrolling down past its height and shows it again scrolling up', () => {
    const { el, to } = scroller();
    const { result } = hook(el);
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
    const { result } = hook(el);
    to(300);
    expect(result.current.hidden).toBe(true);
    to(296);
    expect(result.current.hidden).toBe(true);
  });

  it('shows the bar near the top whatever the direction', () => {
    const { el, to } = scroller();
    const { result } = hook(el);
    to(300);
    to(20);
    expect(result.current.hidden).toBe(false);
  });

  it('does not take iOS\'s bounce at the end of the page for a move up', () => {
    const { el, to } = scroller();
    const { result } = hook(el);
    to(3200);
    expect(result.current.hidden).toBe(true);
    to(3290); // pulled past the end
    to(3200); // and back
    expect(result.current.hidden).toBe(true);
  });

  it('never hides while the focus is inside the bar (WCAG 2.4.11)', () => {
    const bar = document.createElement('header');
    const button = document.createElement('button');
    bar.append(button);
    document.body.append(bar);
    try {
      const { el, to } = scroller();
      const { result } = hook(el, bar);
      button.focus();
      to(300);
      to(900);
      expect(result.current.hidden).toBe(false);
      button.blur();
      to(1500);
      expect(result.current.hidden).toBe(true);
    } finally {
      bar.remove();
    }
  });

  it('does not listen from md, where the bar stays', () => {
    phone = false;
    const { el, to } = scroller();
    const { result } = hook(el);
    to(300);
    to(900);
    expect(result.current.hidden).toBe(false);
  });

  it('shows the bar on a new page, on demand, and always when it is not enabled', () => {
    const { el, to } = scroller();
    const { result, rerender } = hook(el);
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
