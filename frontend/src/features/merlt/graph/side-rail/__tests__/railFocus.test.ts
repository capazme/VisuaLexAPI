import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerRail,
  focusRail,
  unregisterRail,
  isRailWinner,
  subscribeRailFocus,
  __resetRailFocus,
} from '../railFocus';

beforeEach(() => __resetRailFocus());

describe('railFocus coordinator', () => {
  it('elects the first registrant as the sole winner', () => {
    const a = Symbol('a');
    registerRail(a);
    expect(isRailWinner(a)).toBe(true);
  });

  it('the most recently registered rail wins (last mounted / navigated-to)', () => {
    const a = Symbol('a');
    const b = Symbol('b');
    registerRail(a);
    registerRail(b);
    expect(isRailWinner(a)).toBe(false);
    expect(isRailWinner(b)).toBe(true);
  });

  it('focusRail pulls the winner back to an existing rail (article re-focus)', () => {
    const a = Symbol('a');
    const b = Symbol('b');
    registerRail(a);
    registerRail(b);
    focusRail(a);
    expect(isRailWinner(a)).toBe(true);
    expect(isRailWinner(b)).toBe(false);
  });

  it('unregistering the winner promotes the next-highest live rail', () => {
    const a = Symbol('a');
    const b = Symbol('b');
    registerRail(a);
    registerRail(b);
    unregisterRail(b);
    expect(isRailWinner(a)).toBe(true);
  });

  it('has no winner once every rail unregisters', () => {
    const a = Symbol('a');
    registerRail(a);
    unregisterRail(a);
    expect(isRailWinner(a)).toBe(false);
  });

  it('notifies subscribers only when the winner actually changes', () => {
    let notifications = 0;
    const unsub = subscribeRailFocus(() => {
      notifications += 1;
    });
    const a = Symbol('a');
    const b = Symbol('b');
    registerRail(a); // winner: a
    registerRail(b); // winner: b
    focusRail(b); // winner stays b -> no notification
    expect(notifications).toBe(2);
    unsub();
  });
});
