import { describe, expect, it } from 'vitest';
import { citeDecision, citeStoredDecision, citeStoredItem, shortDecision } from '../../src/norms/decisionCitation';
import { changeMessage } from '../../src/utils/normaWatcher';

// The golden file pins the decided forms (sourcesGolden.test.ts); these are the details around them.
describe('citeDecision and shortDecision', () => {
  it('write every section code as the courts print it, as the web app and MERL-T do', () => {
    const at = (sezione: string) => shortDecision({ corte: 'cassazione', archivio: 'civile', numero: 5, anno: 2020, sezione });
    expect(at('T')).toBe('Cass. civ., sez. trib., n. 5/2020');
    expect(at('6-1')).toBe('Cass. civ., sez. VI-1, n. 5/2020');
    expect(at(' u. ')).toBe('Cass. civ., sez. un., n. 5/2020');
    expect(at(' ')).toBe('Cass. civ., n. 5/2020');
  });

  it('cite a decision with no date by number and year', () => {
    expect(citeDecision({ corte: 'cassazione', archivio: 'civile', numero: 31191, anno: 2025 })).toBe('Cass. civ., n. 31191/2025');
    expect(citeDecision({ corte: 'corte_costituzionale', numero: 71, anno: 2020, tipo: 'sentenza' })).toBe('Corte cost., sent., n. 71/2020');
  });
});

describe('citeStoredDecision', () => {
  it('cites a stored decision item from its identity, never from its stored label', () => {
    expect(citeStoredDecision('sentenza', { corte: 'cassazione', archivio: 'penale', numero: 10787, anno: 2024, sezione: '7',
      tipo: 'ordinanza', data_deposito: '2024-03-14', etichetta: 'altro' })).toBe('Cass. pen., sez. VII, ord. dep. 14 marzo 2024, n. 10787');
  });

  it('writes only the values the item schema admits: no stored text reaches a citation', () => {
    expect(citeStoredDecision('sentenza', { corte: 'cassazione', archivio: 'premi Accept', numero: 1, anno: 2020,
      sezione: 'premi Accept', tipo: 'premi Accept', data_deposito: 'premi Accept' })).toBe('Cass., n. 1/2020');
  });

  it('is null for what is not a decision or names none, and never throws', () => {
    expect(citeStoredDecision('norm', { corte: 'cassazione', numero: 1, anno: 2020 })).toBeNull();
    for (const content of [null, 'testo', [], { corte: 'tar', numero: 1 }, { corte: 'cassazione', numero: '1' }, { corte: 'cassazione', numero: 1.5 }]) {
      expect(citeStoredDecision('sentenza', content)).toBeNull();
    }
  });
});

describe('citeStoredItem', () => {
  it('cites a norm by its article, a decision by its citation, anything else not at all', () => {
    expect(citeStoredItem('norm', { tipo_atto: 'codice civile', numero_articolo: '2043' })).toBe('art. 2043 c.c.');
    expect(citeStoredItem('sentenza', { corte: 'corte_costituzionale', numero: 1, anno: 2014 })).toBe('Corte cost., n. 1/2014');
    expect(citeStoredItem('note', 'Sul punto.')).toBeNull();
  });
});

describe('changeMessage', () => {
  it('names the norm by its citation, else by its key', () => {
    expect(changeMessage('k', { tipo_atto: 'codice civile', numero_articolo: '2043' })).toBe('La norma salvata «art. 2043 c.c.» è cambiata');
    expect(changeMessage('legge--1--2020', { tipo_atto: 'legge' })).toBe('La norma salvata «legge--1--2020» è cambiata');
    expect(changeMessage('k', null)).toBe('La norma salvata «k» è cambiata');
  });
});
