import { describe, expect, it } from 'vitest';
import type { Progressi, TappaIstituto } from '../../../../types/studia';
import { cardsLeft, dueBySubject, dueLabel, instituteCardsLeft, instituteSessionPath, nextDayLine, orderInstitutes, orderStops, stopStates, subjectsPhrase, todaySentence, todayState, todaySubjects } from './today';
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

describe('the next day with cards, under «Hai finito per oggi.» (G8)', () => {
  it('counts tomorrow\'s cards, names a later day with its count, or says none is coming in the fortnight', () => {
    expect(nextDayLine(answer({}, [0, 4, 1]))).toBe('Domani: 4 da ripassare.');
    expect(nextDayLine(answer({}, [3, 0, 0, 2]))).toBe('Le prossime: giovedì 22 ottobre, 2 da ripassare.');
    expect(nextDayLine(answer({}, [5, 0, 0]))).toBe('Nessuna scheda in programma nei prossimi 14 giorni.');
  });

  it('is tomorrow while new cards wait, which `prossimi` does not count (today\'s quota of them used up)', () => {
    expect(nextDayLine(answer({}, [0, 0, 0, 2], { nuove: 30, apprendimento: 0, consolidate: 0 }))).toBe('Domani: altre schede nuove da imparare.');
    expect(nextDayLine(answer({}, [0, 9], { nuove: 30, apprendimento: 0, consolidate: 0 }))).toBe('Domani: 9 da ripassare.');
  });
});

describe('the day block\'s lines (G8)', () => {
  it('says what is on today, a part that is zero left out', () => {
    expect(todaySentence(answer({ dovute: 12, nuove: 8 }))).toBe('12 da ripassare, 8 nuove');
    expect(todaySentence(answer({ dovute: 0, nuove: 1 }))).toBe('1 nuova');
    expect(todaySentence(answer({ dovute: 12345, nuove: 0 }))).toBe('12.345 da ripassare');
  });

  it('names the subjects the cards due come from, the most first, then those with new cards while today allows some', () => {
    const materie = [stop('DIRITTO_CIVILE', 0, 3), stop('DIRITTO_PENALE', 4, 0), stop('DIRITTO_AMMINISTRATIVO', 2, 0), stop('DIRITTO_PROCESSUALE_CIVILE', 0, 0)];
    const stops = [tappa('DIRITTO_CIVILE', 'Mora', 2), tappa('DIRITTO_CIVILE', 'Risoluzione', 1), tappa('DIRITTO_PROCESSUALE_PENALE', 'Misure', 5), tappa('DIRITTO_PENALE', 'Dolo', 0)];
    expect(todaySubjects(materie, stops, 3)).toEqual(['DIRITTO_PROCESSUALE_PENALE', 'DIRITTO_CIVILE', 'DIRITTO_PENALE', 'DIRITTO_AMMINISTRATIVO']);
    // No new card today: only the cards due say where the session goes.
    expect(todaySubjects(materie, stops, 0)).toEqual(['DIRITTO_PROCESSUALE_PENALE', 'DIRITTO_CIVILE']);
    // The road's read has not answered: the line waits rather than name a part.
    expect(todaySubjects(materie, null, 3)).toBeNull();
  });

  it('writes two names at most, then how many more', () => {
    expect(subjectsPhrase([])).toBeNull();
    expect(subjectsPhrase(['DIRITTO_CIVILE'])).toBe('Diritto civile');
    expect(subjectsPhrase(['DIRITTO_CIVILE', 'DIRITTO_PENALE'])).toBe('Diritto civile e Diritto penale');
    expect(subjectsPhrase(['DIRITTO_CIVILE', 'DIRITTO_PENALE', 'DIRITTO_AMMINISTRATIVO'])).toBe('Diritto civile, Diritto penale e un’altra');
    expect(subjectsPhrase(['DIRITTO_CIVILE', 'DIRITTO_PENALE', 'DIRITTO_AMMINISTRATIVO', 'DIRITTO_PROCESSUALE_CIVILE'])).toBe('Diritto civile, Diritto penale e altre 2');
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
