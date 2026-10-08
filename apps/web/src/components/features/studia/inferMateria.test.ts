import { describe, expect, it } from 'vitest';
import { inferMateria } from './inferMateria';

describe('inferMateria', () => {
  it.each([
    ['codice civile', 'DIRITTO_CIVILE'],
    ['codice penale', 'DIRITTO_PENALE'],
    ['codice di procedura civile', 'DIRITTO_PROCESSUALE_CIVILE'],
    ['codice procedura civile', 'DIRITTO_PROCESSUALE_CIVILE'],
    ['codice di procedura penale', 'DIRITTO_PROCESSUALE_PENALE'],
    ['codice del processo amministrativo', 'DIRITTO_AMMINISTRATIVO'],
  ])('reads «%s» as %s', (tipo_atto, expected) => {
    expect(inferMateria({ tipo_atto })).toBe(expected);
  });

  it('leaves any other act to be chosen by hand', () => {
    expect(inferMateria({ tipo_atto: 'legge' })).toBeNull();
    expect(inferMateria({ tipo_atto: 'costituzione' })).toBeNull();
    expect(inferMateria({ tipo_atto: 'codice del consumo', tipo_atto_reale: 'decreto legislativo' })).toBeNull();
  });

  it('folds case and spaces, as the source convention does', () => {
    expect(inferMateria({ tipo_atto: 'Codice Civile' })).toBe('DIRITTO_CIVILE');
    expect(inferMateria({ tipo_atto: '  Codice   di Procedura  Penale ' })).toBe('DIRITTO_PROCESSUALE_PENALE');
  });

  it('reads the act it really is when the type is an alias', () => {
    expect(inferMateria({ tipo_atto: 'cc', tipo_atto_reale: 'Codice civile' })).toBe('DIRITTO_CIVILE');
  });
});
