import { describe, expect, it } from 'vitest';
import { decisionKey, identityFromKey, isDecisionKey } from '../decisionLinks';

const NOW = new Date('2026-10-07T12:00:00Z');

describe('identityFromKey', () => {
  it('reads both key shapes', () => {
    expect(identityFromKey('cassazione:civile:99999:2024')).toEqual({ corte: 'cassazione', archivio: 'civile', numero: 99999, anno: 2024 });
    expect(identityFromKey('corte_costituzionale:71:2020')).toEqual({ corte: 'corte_costituzionale', numero: 71, anno: 2020 });
  });

  it('refuses what is not a decision key', () => {
    for (const bad of ['codice-civile--2043', 'cassazione:tributario:1:2024', '']) {
      expect(identityFromKey(bad, NOW), bad).toBeNull();
    }
  });

  it('refuses numbers and years out of range', () => {
    for (const bad of ['cassazione:civile:0:2024', 'corte_costituzionale:1:1900', 'cassazione:civile:1:2027', 'cassazione:civile:1000000:2024']) {
      expect(identityFromKey(bad, NOW), bad).toBeNull();
    }
    expect(identityFromKey('cassazione:civile:999999:2026', NOW)).not.toBeNull();
  });

  it('refuses a leading zero', () => {
    for (const bad of ['cassazione:civile:099999:2024', 'corte_costituzionale:07:2020']) {
      expect(identityFromKey(bad, NOW), bad).toBeNull();
    }
  });

  it('refuses trailing whitespace or a newline', () => {
    for (const bad of ['cassazione:civile:1:2024 ', 'cassazione:civile:1:2024\n', ' corte_costituzionale:71:2020']) {
      expect(identityFromKey(bad, NOW), JSON.stringify(bad)).toBeNull();
    }
  });

  it('refuses a key of the other court\'s shape', () => {
    expect(identityFromKey('corte_costituzionale:civile:1:2020', NOW)).toBeNull();
    expect(identityFromKey('cassazione:71:2020', NOW)).toBeNull();
  });

  it('round-trips with decisionKey', () => {
    for (const key of ['cassazione:civile:99999:2024', 'cassazione:penale:1:1900', 'corte_costituzionale:71:2020']) {
      expect(decisionKey(identityFromKey(key, NOW)!), key).toBe(key);
    }
  });

  it('tells a decision key from a norm key', () => {
    expect(isDecisionKey('cassazione:civile:99999:2024')).toBe(true);
    expect(isDecisionKey('codice-civile--2043')).toBe(false);
  });
});
