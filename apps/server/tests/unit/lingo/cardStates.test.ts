import { describe, it, expect } from 'vitest';
import type { LingoCardStato } from '@prisma/client';
import { allowedTransitions, canTransition } from '../../../src/lingo/cardStates';

const STATES: LingoCardStato[] = ['BOZZA_PERSONALE', 'PROPOSTA_COMMUNITY', 'VALIDATA', 'DA_RIVEDERE', 'ARCHIVIATA'];

// The arrows of the specification's diagram, and only those.
const ARROWS: Array<[LingoCardStato, LingoCardStato]> = [
  ['BOZZA_PERSONALE', 'PROPOSTA_COMMUNITY'],
  ['PROPOSTA_COMMUNITY', 'VALIDATA'],
  ['PROPOSTA_COMMUNITY', 'ARCHIVIATA'],
  ['PROPOSTA_COMMUNITY', 'BOZZA_PERSONALE'],
  ['VALIDATA', 'DA_RIVEDERE'],
  ['DA_RIVEDERE', 'VALIDATA'],
];

describe('canTransition', () => {
  it.each(ARROWS)('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it('refuses every other move, all 25 pairs checked', () => {
    for (const from of STATES) {
      for (const to of STATES) {
        const expected = ARROWS.some(([a, b]) => a === from && b === to);
        expect(canTransition(from, to), `${from} → ${to}`).toBe(expected);
      }
    }
  });

  it('does not let a draft skip the community validation', () => {
    expect(canTransition('BOZZA_PERSONALE', 'VALIDATA')).toBe(false);
  });

  it('lets the author take a proposal back to a draft (spec decision 20)', () => {
    expect(canTransition('PROPOSTA_COMMUNITY', 'BOZZA_PERSONALE')).toBe(true);
  });

  it('lets nothing but a proposal go back to a draft', () => {
    for (const from of STATES.filter((s) => s !== 'PROPOSTA_COMMUNITY')) {
      expect(canTransition(from, 'BOZZA_PERSONALE'), `${from} → BOZZA_PERSONALE`).toBe(false);
    }
  });

  it('lets nothing leave the archive', () => {
    for (const to of STATES) expect(canTransition('ARCHIVIATA', to)).toBe(false);
  });

  it('never moves a card to the state it is already in', () => {
    for (const state of STATES) expect(canTransition(state, state)).toBe(false);
  });
});

describe('allowedTransitions', () => {
  it('lists the ways out of each state', () => {
    expect(allowedTransitions('BOZZA_PERSONALE')).toEqual(['PROPOSTA_COMMUNITY']);
    expect([...allowedTransitions('PROPOSTA_COMMUNITY')].sort()).toEqual(['ARCHIVIATA', 'BOZZA_PERSONALE', 'VALIDATA']);
    expect(allowedTransitions('VALIDATA')).toEqual(['DA_RIVEDERE']);
    expect(allowedTransitions('DA_RIVEDERE')).toEqual(['VALIDATA']);
    expect(allowedTransitions('ARCHIVIATA')).toEqual([]);
  });
});
