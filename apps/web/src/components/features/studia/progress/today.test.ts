import { describe, expect, it } from 'vitest';
import type { Progressi, TappaIstituto } from '../../../../types/studia';
import { cardsLeft, dueBySubject, dueLabel, instituteCardsLeft, instituteSessionPath, nextDueDay, orderInstitutes, orderStops, stopStates, todayState } from './today';
import { xpFields } from '../__fixtures__/xp';

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
    // Five digits grouped, as everywhere on the progress pages; four stay whole, as Italian writes them.
    expect(stopStates(stop('DIRITTO_CIVILE', 9999, 12345, 0))).toBe('9999 nuove · 12.345 in apprendimento · 0 consolidate');
  });
});

const tappa = (materia: TappaIstituto['materia'], istituto: string, dovute: number, over: Partial<TappaIstituto> = {}): TappaIstituto => ({
  materia, istituto, nuove: 0, apprendimento: dovute, consolidate: 0, dovute, ...over,
});

describe('the institutes of a subject (Gymnasium spec §5.2, G5)', () => {
  it('keeps the subject asked, the most cards due first, then by name as an Italian reader sorts it', () => {
    const order = orderInstitutes([
      tappa('DIRITTO_CIVILE', 'Usucapione', 0),
      tappa('DIRITTO_PENALE', 'Furto', 9),
      tappa('DIRITTO_CIVILE', 'Risoluzione per inadempimento', 4),
      tappa('DIRITTO_CIVILE', 'éviction', 0),
      tappa('DIRITTO_CIVILE', 'Mora del debitore', 4),
      tappa('DIRITTO_CIVILE', 'Azione revocatoria', 0),
    ], 'DIRITTO_CIVILE').map((stop) => stop.istituto);
    expect(order).toEqual(['Mora del debitore', 'Risoluzione per inadempimento', 'Azione revocatoria', 'éviction', 'Usucapione']);
  });

  it('leaves the read as it came', () => {
    const stops = [tappa('DIRITTO_CIVILE', 'B', 0), tappa('DIRITTO_CIVILE', 'A', 3)];
    orderInstitutes(stops, 'DIRITTO_CIVILE');
    expect(stops.map((stop) => stop.istituto)).toEqual(['B', 'A']);
  });

  it('sums the cards due by subject, with the subjects that have none left out', () => {
    const due = dueBySubject([tappa('DIRITTO_CIVILE', 'A', 3), tappa('DIRITTO_CIVILE', 'B', 0), tappa('DIRITTO_PENALE', 'C', 2), tappa('DIRITTO_CIVILE', 'D', 4)]);
    expect(Object.fromEntries(due)).toEqual({ DIRITTO_CIVILE: 7, DIRITTO_PENALE: 2 });
  });

  it('says the cards due in words', () => {
    expect(dueLabel(0)).toBe('Niente da ripassare');
    expect(dueLabel(1)).toBe('1 da ripassare');
    expect(dueLabel(412)).toBe('412 da ripassare');
  });

  it('carries the institute to the session verbatim, whatever it holds', () => {
    const istituto = 'Contratto a favore del terzo (artt. 1411-1413) & 100% «patto»';
    const path = instituteSessionPath('DIRITTO_CIVILE', istituto);
    expect(path.startsWith('/studia/ripasso/sessione?')).toBe(true);
    const params = new URLSearchParams(path.split('?')[1]);
    expect(params.get('materia')).toBe('DIRITTO_CIVILE');
    expect(params.get('istituto')).toBe(istituto);
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
    ...xpFields(),
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

describe('the cards left in one institute at the lesson\'s end (G5)', () => {
  const tappa = (istituto: string, dovute: number, nuove: number): TappaIstituto => ({ materia: 'DIRITTO_CIVILE', istituto, nuove, apprendimento: dovute, consolidate: 0, dovute });

  it('counts the institute\'s due cards and its new ones up to what today still allows in the subject', () => {
    const stops = [tappa('Mora', 2, 7), tappa('Risoluzione', 9, 9)];
    expect(instituteCardsLeft(stops, 'DIRITTO_CIVILE', 'Mora', answer({ nuove: 3 }))).toBe(5);
    expect(instituteCardsLeft(stops, 'DIRITTO_CIVILE', 'Mora', answer({ nuove: 0 }))).toBe(2);
  });

  it('never counts the subject\'s other institutes, another subject\'s, or an institute the read does not list', () => {
    const stops = [tappa('Mora', 0, 0), tappa('Risoluzione', 9, 9)];
    expect(instituteCardsLeft(stops, 'DIRITTO_CIVILE', 'Mora', answer({ dovute: 9, nuove: 5 }))).toBe(0);
    expect(instituteCardsLeft(stops, 'DIRITTO_PENALE', 'Risoluzione', answer({ nuove: 5 }))).toBe(0);
    expect(instituteCardsLeft(stops, 'DIRITTO_CIVILE', 'Usucapione', answer({ nuove: 5 }))).toBe(0);
  });
});
