import { describe, expect, it } from 'vitest';
import type { Progressi } from '../../../../types/studia';
import { cardsLeft, nextDueDay, orderStops, stopStates, todayState } from './today';

type Stop = Progressi['materie'][number];
const stop = (materia: Stop['materia'], nuove: number, apprendimento: number, consolidate = 0): Stop => ({ materia, nuove, apprendimento, consolidate, ripassi30: 0 });

describe('the road\'s order (Gymnasium spec §5.2, as corrected)', () => {
  it('puts the subjects with the most cards new and in learning first, then by name', () => {
    const order = orderStops([
      stop('DIRITTO_CIVILE', 1, 1, 40),
      stop('DIRITTO_PENALE', 5, 3),
      stop('DIRITTO_AMMINISTRATIVO', 0, 0),
      stop('DIRITTO_PROCESSUALE_PENALE', 2, 0),
      stop('DIRITTO_PROCESSUALE_CIVILE', 0, 2),
    ]).map((s) => s.materia);
    // Consolidated cards do not count: civile (2 open) ties with both procedures and goes by name.
    expect(order).toEqual(['DIRITTO_PENALE', 'DIRITTO_CIVILE', 'DIRITTO_PROCESSUALE_CIVILE', 'DIRITTO_PROCESSUALE_PENALE', 'DIRITTO_AMMINISTRATIVO']);
  });

  it('leaves the read as it came', () => {
    const materie = [stop('DIRITTO_PENALE', 0, 0), stop('DIRITTO_CIVILE', 3, 0)];
    orderStops(materie);
    expect(materie.map((s) => s.materia)).toEqual(['DIRITTO_PENALE', 'DIRITTO_CIVILE']);
  });

  it('says the three states in words, singular and plural', () => {
    expect(stopStates(stop('DIRITTO_CIVILE', 1, 5, 1))).toBe('1 nuova · 5 in apprendimento · 1 consolidata');
    expect(stopStates(stop('DIRITTO_CIVILE', 300, 0, 412))).toBe('300 nuove · 0 in apprendimento · 412 consolidate');
  });
});

function answer(over: Partial<Progressi['oggi']> = {}, prossimi: number[] = [], stati = { nuove: 0, apprendimento: 1, consolidate: 1 }): Progressi {
  return {
    oggi: { giorno: '2026-10-19', ripassi: 0, obiettivo: 10, raggiunto: false, dovute: 0, nuove: 0, ...over },
    serie: { attuale: 0, record: 0, ultimiGiorni: [] },
    stati,
    materie: [],
    calendario: [],
    prossimi: prossimi.map((schede, i) => ({ giorno: `2026-10-${String(19 + i).padStart(2, '0')}`, schede })),
  };
}

describe('the action card\'s state', () => {
  it('is loading, then unread when the first read fails', () => {
    expect(todayState(null, false, false)).toBe('loading');
    expect(todayState(null, true, false)).toBe('unread');
  });

  it('is todo with cards due or new, done without, empty with no card at all', () => {
    expect(todayState(answer({ dovute: 0, nuove: 3 }), false, false)).toBe('todo');
    expect(todayState(answer(), false, false)).toBe('done');
    expect(todayState(answer({}, [], { nuove: 0, apprendimento: 0, consolidate: 0 }), false, false)).toBe('empty');
  });

  it('is never empty narrowed to a subject: that subject is done', () => {
    expect(todayState(answer({}, [], { nuove: 0, apprendimento: 0, consolidate: 0 }), false, true)).toBe('done');
  });
});

describe('the next day with cards', () => {
  it('is tomorrow, a later day by name, or none in the fortnight', () => {
    expect(nextDueDay(answer({}, [0, 4, 1]))).toBe('domani');
    expect(nextDueDay(answer({}, [3, 0, 0, 2]))).toBe('giovedì 22 ottobre');
    expect(nextDueDay(answer({}, [5, 0, 0]))).toBeNull();
  });

  it('is tomorrow while new cards wait, which `prossimi` does not count (today\'s quota of them used up)', () => {
    expect(nextDueDay(answer({}, [0, 0, 0, 2], { nuove: 30, apprendimento: 0, consolidate: 0 }))).toBe('domani');
  });
});

describe('the cards left at the lesson\'s end (Gymnasium spec §5.4)', () => {
  it('counts the cards still due and the new ones today still allows, and nothing else', () => {
    expect(cardsLeft(answer())).toBe(0);
    expect(cardsLeft(answer({ dovute: 4, nuove: 2 }))).toBe(6);
    expect(cardsLeft(answer({ ripassi: 30 }, [12, 8]))).toBe(0);
  });
});
