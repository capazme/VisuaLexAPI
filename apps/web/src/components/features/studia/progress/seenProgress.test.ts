import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFreshMissions, useReviewsGrowth, useStreakGrowth } from './seenProgress';

const KEY = 'visualex.studia.visto';
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? 'null');
const store = (value: unknown) => localStorage.setItem(KEY, JSON.stringify(value));

afterEach(() => localStorage.removeItem(KEY));

describe('what this browser last drew of the progress (S2)', () => {
  describe('the streak', () => {
    it('plays nothing on a first visit, and records the count', () => {
      const { result } = renderHook(() => useStreakGrowth(4));
      expect(result.current).toBeNull();
      expect(stored()).toEqual({ serie: 4 });
    });

    it('gives the count drawn before when it grew since, once', () => {
      store({ serie: 4 });
      expect(renderHook(() => useStreakGrowth(5)).result.current).toBe(4);
      expect(renderHook(() => useStreakGrowth(5)).result.current).toBeNull();
    });

    it('plays nothing when it fell (a day missed), and while on screen follows a growth', () => {
      store({ serie: 9 });
      const { result, rerender } = renderHook(({ n }) => useStreakGrowth(n), { initialProps: { n: 0 } });
      expect(result.current).toBeNull();
      rerender({ n: 1 });
      expect(result.current).toBe(0);
    });

    it('disabled (the dense strip), neither reads nor records it', () => {
      store({ serie: 4 });
      expect(renderHook(() => useStreakGrowth(5, false)).result.current).toBeNull();
      expect(stored()).toEqual({ serie: 4 });
    });
  });

  describe("today's reviews", () => {
    it('lands the count that grew today; a new day counts from nothing', () => {
      store({ serie: 3, giorno: '2026-10-19', ripassi: 6 });
      expect(renderHook(() => useReviewsGrowth('2026-10-19', 8)).result.current).toBe(6);
      expect(stored()).toEqual({ serie: 3, giorno: '2026-10-19', ripassi: 8 });
      expect(renderHook(() => useReviewsGrowth('2026-10-20', 2)).result.current).toBe(0);
      expect(stored()).toEqual({ serie: 3, giorno: '2026-10-20', ripassi: 2 });
    });

    it('plays nothing on a first visit, without a day, or with nothing done', () => {
      expect(renderHook(() => useReviewsGrowth('2026-10-19', 8)).result.current).toBeNull();
      expect(renderHook(() => useReviewsGrowth(undefined, 9)).result.current).toBeNull();
      expect(renderHook(() => useReviewsGrowth('2026-10-20', 0)).result.current).toBeNull();
    });
  });

  describe("today's missions", () => {
    it('gives the missions done since they were last drawn, and records them for the day', () => {
      store({ serie: 3, giorno: '2026-10-19', missioni: ['dovute'] });
      const { result } = renderHook(() => useFreshMissions('2026-10-19', ['dovute', 'nuove']));
      expect([...result.current]).toEqual(['nuove']);
      expect(stored().missioni).toEqual(['dovute', 'nuove']);
    });

    it('takes every mission done on a new day for fresh, none on a first visit', () => {
      store({ serie: 3, giorno: '2026-10-18', missioni: ['dovute', 'nuove'] });
      expect([...renderHook(() => useFreshMissions('2026-10-19', ['nuove'])).result.current]).toEqual(['nuove']);
      localStorage.removeItem(KEY);
      expect([...renderHook(() => useFreshMissions('2026-10-19', ['nuove'])).result.current]).toEqual([]);
    });

    it('while on screen adds a mission just done, and drops one no longer done', () => {
      store({ giorno: '2026-10-19', missioni: [] });
      const { result, rerender } = renderHook(({ done }) => useFreshMissions('2026-10-19', done), { initialProps: { done: ['nuove'] } });
      expect([...result.current]).toEqual(['nuove']);
      rerender({ done: ['obiettivo'] });
      expect([...result.current]).toEqual(['obiettivo']);
    });

    it('survives a store it cannot read', () => {
      localStorage.setItem(KEY, '{not json');
      expect([...renderHook(() => useFreshMissions('2026-10-19', ['nuove'])).result.current]).toEqual([]);
      expect(stored()).toEqual({ giorno: '2026-10-19', missioni: ['nuove'] });
    });
  });
});
