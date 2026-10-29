import { describe, expect, it } from 'vitest';
import { previewIntervals, reviewScope } from '../../../src/lingo/reviewQueue';
import { review, type Rating, type SrsState } from '../../../src/srs/fsrsEngine';

describe('reviewScope', () => {
  it('is the user’s own cards in draft, proposed or validated, or the community’s validated ones in the chosen subjects', () => {
    expect(reviewScope('u1', ['DIRITTO_CIVILE', 'DIRITTO_PENALE'], '2026-11-02')).toEqual({
      OR: [
        // A course's card waits for its module: done by the user's enrolment before today, and not withdrawn.
        {
          autoreId: 'u1',
          stato: { in: ['BOZZA_PERSONALE', 'PROPOSTA_COMMUNITY', 'VALIDATA'] },
          OR: [
            { moduloId: null },
            { modulo: { stati: { some: { iscrizione: { utenteId: 'u1' }, fattoGiorno: { lt: new Date('2026-11-02T00:00:00.000Z') }, ritiratoIl: null } } } },
          ],
        },
        { stato: 'VALIDATA', materia: { in: ['DIRITTO_CIVILE', 'DIRITTO_PENALE'] } },
      ],
    });
  });

  it('never excludes by author: an anonymous card (no author) is still the community’s', () => {
    expect(JSON.stringify(reviewScope('u1', ['DIRITTO_CIVILE'], '2026-11-02'))).not.toContain('not');
  });

  it('narrows both branches to one subject when given', () => {
    expect(reviewScope('u1', ['DIRITTO_CIVILE'], '2026-11-02', 'DIRITTO_PENALE')).toEqual({
      AND: [reviewScope('u1', ['DIRITTO_CIVILE'], '2026-11-02'), { materia: 'DIRITTO_PENALE' }],
    });
  });
});

describe('previewIntervals', () => {
  it('gives the first review’s days for a new card: the initial stabilities, rounded, at least one day', () => {
    // S0 = 0.4, 0.6, 2.4, 5.8 and the interval is round(S · 9 · (1/0.9 − 1)) = round(S), at least 1.
    expect(previewIntervals(null, 0)).toEqual({ 1: 1, 2: 1, 3: 2, 4: 6 });
  });

  it.each([0, 1, 2, 9, 40])('equals the engine’s scheduledDays for each rating, %i days on', (elapsed) => {
    const state: SrsState = { stability: 8.2, difficulty: 4.1 };
    const preview = previewIntervals(state, elapsed);
    for (const rating of [1, 2, 3, 4] as Rating[]) {
      expect(preview[rating]).toBe(review(state, rating, elapsed).scheduledDays);
    }
  });

  it('is ordered: a better grade never gives a shorter interval', () => {
    const preview = previewIntervals({ stability: 12, difficulty: 5 }, 12);
    expect(preview[1]).toBeLessThanOrEqual(preview[2]);
    expect(preview[2]).toBeLessThanOrEqual(preview[3]);
    expect(preview[3]).toBeLessThanOrEqual(preview[4]);
  });
});
