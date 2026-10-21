import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { forgetSeenProgress, recordXpSeen, useFreshMissions, useReviewsGrowth, useStreakGrowth, useXpGrowth } from './seenProgress';

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

  describe('the points and the level (G1c)', () => {
    it('plays nothing on a first visit, nor the first since points exist, and records them', () => {
      expect(renderHook(() => useXpGrowth(40, 1)).result.current).toEqual({ gain: null, levelUp: false });
      expect(stored()).toMatchObject({ xp: 40, livello: 1 });
      store({ serie: 4 });
      expect(renderHook(() => useXpGrowth(40, 1)).result.current).toEqual({ gain: null, levelUp: false });
    });

    it('gives the points earned since this browser drew them, and a level not yet shown, once', () => {
      store({ xp: 90, livello: 1 });
      expect(renderHook(() => useXpGrowth(110, 2)).result.current).toEqual({ gain: 20, levelUp: true });
      expect(renderHook(() => useXpGrowth(110, 2)).result.current).toEqual({ gain: null, levelUp: false });
    });

    it('follows a growth while on screen (a new read), and keeps them across a new day', () => {
      store({ xp: 10, livello: 1 });
      const { result, rerender } = renderHook(({ t }) => useXpGrowth(t, 1), { initialProps: { t: 10 } });
      expect(result.current.gain).toBeNull();
      rerender({ t: 35 });
      expect(result.current.gain).toBe(25);
      renderHook(() => useReviewsGrowth('2026-10-20', 3));
      expect(stored()).toMatchObject({ xp: 35, livello: 1, giorno: '2026-10-20' });
    });

    it('takes what another surface showed itself (the lesson, a vote), so «Oggi» does not show it again', () => {
      store({ xp: 80, livello: 1 });
      recordXpSeen({ crediti: [{ missione: 'dovute', punti: 20 }], livello: { livello: 2, totale: 100, nelLivello: 0, perIlProssimo: 125, oggi: 20 }, nuovoLivello: true });
      expect(renderHook(() => useXpGrowth(100, 2)).result.current).toEqual({ gain: null, levelUp: false });
    });

    it('leaves to «Oggi» the credits written silently before an event, and the level they crossed', () => {
      // 90 seen; a session read credited 10 silently (level 2 at 100); then a vote earned 20, crossing nothing.
      store({ xp: 90, livello: 1 });
      recordXpSeen({ crediti: [{ missione: 'convalida', punti: 20 }], livello: { livello: 2, totale: 120, nelLivello: 20, perIlProssimo: 125, oggi: 30 }, nuovoLivello: false });
      expect(stored()).toMatchObject({ xp: 110, livello: 1 });
      expect(renderHook(() => useXpGrowth(120, 2)).result.current).toEqual({ gain: 10, levelUp: true });
    });

    it('is forgotten at a sign-in and a sign-out: the next person must not read the last one’s points (G-316)', () => {
      store({ xp: 900, livello: 7, serie: 3 });
      forgetSeenProgress();
      expect(localStorage.getItem(KEY)).toBeNull();
      expect(renderHook(() => useXpGrowth(40, 1)).result.current).toEqual({ gain: null, levelUp: false });
    });
  });
});
