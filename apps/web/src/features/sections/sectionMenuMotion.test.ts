import { afterEach, describe, expect, it, vi } from 'vitest';
import { SECTION_MENU_MS, rollName, rollUpMenu, slideCheck, unrollMenu } from './sectionMenuMotion';

/** An element whose `animate` records its calls (the test's DOM has no Web Animations). */
function animated() {
  const element = document.createElement('div');
  const listeners: (() => void)[] = [];
  const animation = {
    cancel: vi.fn(),
    finished: Promise.resolve(),
    addEventListener: (_: string, listener: () => void) => listeners.push(listener),
  };
  const animate = vi.fn(() => animation);
  Object.defineProperty(element, 'animate', { value: animate });
  return { element, animate, finish: () => listeners.forEach((l) => l()) };
}

const reduced = (on: boolean) =>
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: on }) });

afterEach(() => Reflect.deleteProperty(window, 'matchMedia'));

describe('the split button\'s motions (S6)', () => {
  it('unrolls the menu in 260 ms from the top, the same clip shape at both ends, the entries 40 ms apart', () => {
    const menu = animated();
    const entries = [animated(), animated(), animated()];
    unrollMenu(menu.element, entries.map((e) => e.element));
    const [frames, timing] = menu.animate.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions];
    expect(timing.duration).toBe(SECTION_MENU_MS.open);
    expect(SECTION_MENU_MS.open).toBe(260);
    expect(frames[0].transform).toBe('scale(0.97)');
    // Four lengths each: an inset the browser can interpolate.
    expect(String(frames[0].clipPath)).toMatch(/^inset\((\S+ ){3}\S+\)$/);
    expect(String(frames[1].clipPath)).toMatch(/^inset\((\S+ ){3}\S+\)$/);
    expect(entries.map((e) => (e.animate.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions])[1].delay)).toEqual([0, 40, 80]);
  });

  it('rolls the menu up and says when it is out of sight; under reduced motion at once', () => {
    const menu = animated();
    const done = vi.fn();
    rollUpMenu(menu.element, done);
    expect(done).not.toHaveBeenCalled();
    menu.finish();
    expect(done).toHaveBeenCalledOnce();

    reduced(true);
    const still = animated();
    const doneAtOnce = vi.fn();
    expect(rollUpMenu(still.element, doneAtOnce)).toBeNull();
    expect(still.animate).not.toHaveBeenCalled();
    expect(doneAtOnce).toHaveBeenCalledOnce();
  });

  it('slides the check, but places it the first time and under reduced motion', () => {
    const check = animated();
    slideCheck(check.element, null, 12);
    expect(check.animate).not.toHaveBeenCalled();
    expect(check.element.style.transform).toBe('translateY(12px)');
    slideCheck(check.element, 12, 64);
    expect(check.animate).toHaveBeenCalledOnce();
    expect((check.animate.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions])[1].duration).toBe(180);
    reduced(true);
    slideCheck(check.element, 64, 120);
    expect(check.animate).toHaveBeenCalledOnce();
    expect(check.element.style.transform).toBe('translateY(120px)');
  });

  it('rolls the name in 220 ms: the box, the new name and the old one', async () => {
    const box = animated();
    const leaving = animated();
    const coming = animated();
    const done = vi.fn();
    rollName(box.element, leaving.element, coming.element, 80, done);
    for (const part of [box, leaving, coming]) {
      expect((part.animate.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions])[1].duration).toBe(220);
    }
    await Promise.resolve();
    expect(done).toHaveBeenCalledOnce();
  });
});
