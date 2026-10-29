import { describe, expect, it } from 'vitest';
import { createSwipeGuard } from './swipeGuard';

describe('swipeGuard — a press that moved a notification is no click (K1a)', () => {
  const manual = () => {
    const queue: (() => void)[] = [];
    return { guard: createSwipeGuard((run) => queue.push(run)), tick: () => queue.splice(0).forEach((run) => run()) };
  };

  it('drops the release\'s click on a button after a short swipe, and only that one', () => {
    const { guard, tick } = manual();
    guard.started();
    guard.ended();
    expect(guard.eats(1)).toBe(true);
    tick();
    expect(guard.eats(1)).toBe(false);
  });

  it('never drops a key\'s click (detail 0), even right after a swipe', () => {
    const { guard } = manual();
    guard.started();
    guard.ended();
    expect(guard.eats(0)).toBe(false);
  });

  it('a swipe let go outside the notification, or a finger\'s, leaves no flag to eat the next click', () => {
    const { guard, tick } = manual();
    guard.started();
    guard.ended();
    tick();
    expect(guard.eats(1)).toBe(false);
  });

  it('a plain press is a click', () => {
    const { guard } = manual();
    guard.pressed();
    expect(guard.eats(1)).toBe(false);
  });
});
