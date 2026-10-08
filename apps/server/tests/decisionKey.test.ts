import { describe, expect, it } from 'vitest';
import { inDecisionKeySpace, readDecisionKey } from '../src/norms/decisionKey';

const NOW = new Date('2026-10-08T00:00:00Z');

// The cases mirror the web's identityFromKey (apps/web/src/utils/decisionLinks.ts); there is no
// shared fixture, so a change to one bound is made in both places.
describe('readDecisionKey', () => {
  it.each([
    ['cassazione:civile:10787:2024', { corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 }],
    ['cassazione:penale:1:1900', { corte: 'cassazione', archivio: 'penale', numero: 1, anno: 1900 }],
    ['cassazione:civile:999999:2026', { corte: 'cassazione', archivio: 'civile', numero: 999999, anno: 2026 }],
    ['corte_costituzionale:1:1956', { corte: 'corte_costituzionale', numero: 1, anno: 1956 }],
    ['corte_costituzionale:99999:2024', { corte: 'corte_costituzionale', numero: 99999, anno: 2024 }],
  ])('reads %s', (key, identity) => {
    expect(readDecisionKey(key, NOW)).toEqual(identity);
  });

  it.each([
    'cassazione:civile:007:2024',
    'cassazione:civile:0:2024',
    'cassazione:civile:1000000:2024',
    'cassazione:civile:10787:2027',
    'cassazione:civile:10787:1899',
    'cassazione:10787:2024',
    'cassazione:amministrativa:10787:2024',
    'corte_costituzionale:civile:1:2020',
    'corte_costituzionale:1:1955',
    'corte_costituzionale:1:2027',
    'corte_costituzionale:1:2020:extra',
    ' cassazione:civile:1:2024',
    'codice-civile--art-2043',
    '',
  ])('refuses %j', (key) => {
    expect(readDecisionKey(key, NOW)).toBeNull();
  });

  it('knows the key space apart from validity', () => {
    expect(inDecisionKeySpace('cassazione:civile:007:2024')).toBe(true);
    expect(inDecisionKeySpace('corte_costituzionale:x')).toBe(true);
    expect(inDecisionKeySpace('codice-civile--art-2043')).toBe(false);
  });
});
