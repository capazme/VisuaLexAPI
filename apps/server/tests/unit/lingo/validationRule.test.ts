import { describe, it, expect } from 'vitest';
import type { LingoCardStato, LingoGiudizio } from '@prisma/client';
import { APPROVALS_TO_VALIDATE, ERRATA_TO_ARCHIVE, stateAfterVotes } from '../../../src/lingo/validationRule';

const A: LingoGiudizio = 'APPROVATA';
const M: LingoGiudizio = 'MIGLIORABILE';
const E: LingoGiudizio = 'ERRATA';

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
  it.each(TABLE)('%s', (_name, votes, expected) => {
    expect(stateAfterVotes(votes)).toBe(expected);
  });

  it('does not depend on the order of the votes', () => {
    expect(stateAfterVotes([E, A, A])).toBe('ARCHIVIATA');
    expect(stateAfterVotes([M, A, A])).toBe('VALIDATA');
  });

  it('keeps its two numbers as named constants', () => {
    expect(APPROVALS_TO_VALIDATE).toBe(2);
    expect(ERRATA_TO_ARCHIVE).toBe(1);
  });
});
