import { describe, expect, it } from 'vitest';
import { matchRubrichePart, rubricheFor } from './actRubriche';

// The shape measured on 4 Oct 2026 for d.lgs. 196/2003: the top-level map is an annex's.
const DLGS_196 = {
  rubriche: { '1': 'Delibera del Garante n. 515 del 19 dicembre 2018, in G.U. 14 gennaio 2019, n. 11' },
  parts: [
    { name: 'Allegato A.4 Regole deontologiche', keys: ['1', '2', '3'], rubriche: { '1': 'Delibera del Garante n. 515…' }, abrogati: [] },
    { name: 'Dispositivo', keys: ['1', '2', '2-bis', '2-ter', '3', '4'], rubriche: { '1': 'Oggetto', '2-bis': 'Autorità di controllo' }, abrogati: [] },
  ],
};

describe('rubricheFor', () => {
  it('uses the top-level map for an act with no parts', () => {
    expect(rubricheFor({ rubriche: { '1': 'Definizione', '2 bis': 'Ambito' }, parts: [] }, null))
      .toEqual({ '1': 'Definizione', '2-bis': 'Ambito' });
  });
  it('matches the body of an act in parts by its article numbers', () => {
    expect(rubricheFor(DLGS_196, ['1', '2', '2-bis', '2-ter', '3', '4'])['1']).toBe('Oggetto');
  });
  it('gives nothing for an act in parts when the part cannot be told, never the top-level map', () => {
    expect(rubricheFor(DLGS_196, null)).toEqual({});
    expect(rubricheFor(DLGS_196, [])).toEqual({});
    expect(rubricheFor(DLGS_196, ['900', '901'])).toEqual({});
  });
});

describe('matchRubrichePart', () => {
  it('needs a real majority: a shared article 1 is a coincidence', () => {
    expect(matchRubrichePart(DLGS_196.parts, ['1', '50', '51', '52'])).toBeNull();
  });
});
