import { describe, expect, it } from 'vitest';
import { parseDecisionCitation } from '../decisionCitationParser';

const NOW = new Date('2026-10-05T12:00:00Z');
const CASES: Array<[string, Record<string, unknown> | null]> = [
  ['Cass. 10787/2024', { corte: 'cassazione', numero: 10787, anno: 2024 }],
  ['Cassazione n. 10787 del 2024', { corte: 'cassazione', numero: 10787, anno: 2024 }],
  ['Cass. civ. 10787/2024', { corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 }],
  ['Cass. civ., sez. III, n. 10787/2024', { corte: 'cassazione', archivio: 'civile', sezione: 'III', numero: 10787, anno: 2024 }],
  ['Cass. pen., sez. VII, 10787/2024', { corte: 'cassazione', archivio: 'penale', sezione: 'VII', numero: 10787, anno: 2024 }],
  ['Cass. SU 31310/2024', { corte: 'cassazione', sezione: 'U', numero: 31310, anno: 2024 }],
  ['Cass. civ., sez. un., n. 31310/2024', { corte: 'cassazione', archivio: 'civile', sezione: 'U', numero: 31310, anno: 2024 }],
  ['S.U. 31310/2024', { corte: 'cassazione', sezione: 'U', numero: 31310, anno: 2024 }],
  ['Cass. civ., sez. lav., 21 aprile 2022, n. 12789', { corte: 'cassazione', archivio: 'civile', sezione: 'L', numero: 12789, anno: 2022 }],
  ['Cass. pen., sez. VII, 10 gennaio 2024 (dep. 14 marzo 2024), n. 10787', { corte: 'cassazione', archivio: 'penale', sezione: 'VII', numero: 10787, anno: 2024 }],
  ['Cass. civ. 1234/99', { corte: 'cassazione', archivio: 'civile', numero: 1234, anno: 1999 }],
  ['Corte cost. 71/2020', { corte: 'corte_costituzionale', numero: 71, anno: 2020 }],
  ['C. cost. n. 71 del 2020', { corte: 'corte_costituzionale', numero: 71, anno: 2020 }],
  ['Corte costituzionale, sentenza n. 71/2020', { corte: 'corte_costituzionale', numero: 71, anno: 2020 }],
  ['art 2043 cc', null],
  ['art. 2043 c.c.', null],
  ['Cass. civ.', null],
  ['Cass. 10787', null],
  ['Cass. 0/2024', null],
  ['Cass. 10787/2030', null],
  ['Corte cost. 1/1950', null],
];

describe('parseDecisionCitation', () => {
  for (const [input, expected] of CASES) {
    it(input, () => expect(parseDecisionCitation(input, { now: NOW })).toEqual(expected));
  }

  it("leaves the input to the user's alias that starts it", () => {
    expect(parseDecisionCitation('cass 10787/2024', { aliasTriggers: ['cass'], now: NOW })).toBeNull();
  });

  it('returns quickly on a long hostile paste', () => {
    const hostile = 'Cass. ' + 'n. 1 '.repeat(5000);
    const start = performance.now();
    expect(parseDecisionCitation(hostile, { now: NOW })).toBeNull();
    expect(performance.now() - start).toBeLessThan(50);
  });
});
