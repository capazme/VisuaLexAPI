import { describe, it, expect } from 'vitest';
import type { LingoCardStato, LingoGiudizio } from '@prisma/client';
import { SOGLIE_PREDEFINITE, stateAfterVotes } from '../../../src/lingo/validationRule';

const A: LingoGiudizio = 'APPROVATA';
const M: LingoGiudizio = 'MIGLIORABILE';
const E: LingoGiudizio = 'ERRATA';

const DEFAULT = { approvazioni: 2, errate: 1 };

const TABLE: Array<[string, LingoGiudizio[], LingoCardStato]> = [
  ['no votes', [], 'PROPOSTA_COMMUNITY'],
  ['one approval', [A], 'PROPOSTA_COMMUNITY'],
  ['two approvals', [A, A], 'VALIDATA'],
  ['an approval and a "migliorabile"', [A, M], 'PROPOSTA_COMMUNITY'],
  ['two approvals and an "errata": the "errata" wins', [A, A, E], 'ARCHIVIATA'],
  ['one "errata"', [E], 'ARCHIVIATA'],
  ['three "migliorabile"', [M, M, M], 'PROPOSTA_COMMUNITY'],
];

describe('stateAfterVotes', () => {
  it.each(TABLE)('%s, with the defaults', (_name, votes, expected) => {
    expect(stateAfterVotes(votes, DEFAULT)).toBe(expected);
  });

  it('does not depend on the order of the votes', () => {
    expect(stateAfterVotes([E, A, A], DEFAULT)).toBe('ARCHIVIATA');
    expect(stateAfterVotes([M, A, A], DEFAULT)).toBe('VALIDATA');
  });

  it('reads the thresholds it is given', () => {
    expect(stateAfterVotes([A], { approvazioni: 1, errate: 1 })).toBe('VALIDATA');
    expect(stateAfterVotes([A, A], { approvazioni: 3, errate: 1 })).toBe('PROPOSTA_COMMUNITY');
    expect(stateAfterVotes([A, A, A], { approvazioni: 3, errate: 1 })).toBe('VALIDATA');
    expect(stateAfterVotes([E], { approvazioni: 2, errate: 2 })).toBe('PROPOSTA_COMMUNITY');
    expect(stateAfterVotes([E, E], { approvazioni: 2, errate: 2 })).toBe('ARCHIVIATA');
  });

  it('starts from the defaults the migration seeds: 2 approvals and 1 «errata»', () => {
    expect(SOGLIE_PREDEFINITE).toEqual(DEFAULT);
  });
});
