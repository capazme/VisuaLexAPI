import { describe, expect, it } from 'vitest';
import { identityFromKey, isDecisionKey } from '../decisionLinks';

describe('identityFromKey', () => {
  it('reads both key shapes and refuses anything else', () => {
    expect(identityFromKey('cassazione:civile:10787:2024')).toEqual({ corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 });
    expect(identityFromKey('corte_costituzionale:71:2020')).toEqual({ corte: 'corte_costituzionale', numero: 71, anno: 2020 });
    for (const bad of ['codice-civile--2043', 'cassazione:tributario:1:2024', 'cassazione:civile:0:2024', 'corte_costituzionale:1:1900', '']) {
      expect(identityFromKey(bad), bad).toBeNull();
    }
    expect(isDecisionKey('cassazione:civile:10787:2024')).toBe(true);
    expect(isDecisionKey('codice-civile--2043')).toBe(false);
  });
});
