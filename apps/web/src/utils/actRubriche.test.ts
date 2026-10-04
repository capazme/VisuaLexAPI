import { describe, expect, it } from 'vitest';
import { matchRubrichePart, rubricheFor } from './actRubriche';
import type { ActRubricheResponse, RubrichePart } from './actStructureCache';

// The shape measured on 4 Oct 2026 for d.lgs. 196/2003: the top-level map is an annex's.
const DLGS_196: ActRubricheResponse & { parts: NonNullable<ActRubricheResponse['parts']> } = {
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
  // The server's order: the code body first, the Dispositivo last (akn_parser.py),
  // as measured on the codice penale's fixture.
  const CODE_THEN_DISPOSITIVO: RubrichePart[] = [
    { name: 'Codice Penale', keys: Array.from({ length: 40 }, (_, i) => String(i + 1)), rubriche: { '1': 'Reati e pene: disposizione espressa di legge' }, abrogati: [] },
    { name: 'Dispositivo', keys: ['1', '2', '3'], rubriche: {}, abrogati: [] },
  ];
  it('tells the Dispositivo from the code body it shares its numbers with', () => {
    expect(matchRubrichePart(CODE_THEN_DISPOSITIVO, ['1', '2', '3'])?.name).toBe('Dispositivo');
    expect(matchRubrichePart(CODE_THEN_DISPOSITIVO, Array.from({ length: 40 }, (_, i) => String(i + 1)))?.name).toBe('Codice Penale');
  });
  it('gives nothing when two parts of the same size share the numbers', () => {
    const twoAnnexes: RubrichePart[] = [
      { name: 'Allegato A.1', keys: ['1', '2', '3'], rubriche: { '1': 'Uno' }, abrogati: [] },
      { name: 'Allegato A.2', keys: ['1', '2', '3'], rubriche: { '1': 'Altro' }, abrogati: [] },
    ];
    expect(matchRubrichePart(twoAnnexes, ['1', '2', '3'])).toBeNull();
  });
  it('needs a real majority: a shared article 1 is a coincidence', () => {
    expect(matchRubrichePart(DLGS_196.parts, ['1', '50', '51', '52'])).toBeNull();
  });
});
