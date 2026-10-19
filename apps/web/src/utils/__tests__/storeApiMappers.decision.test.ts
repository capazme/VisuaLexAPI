import { describe, expect, it } from 'vitest';
import { buildWireNormaKey, buildWireNormaKeyPrefix, parseWireNormaKey } from '../storeApiMappers';
import { decisionKey } from '../decisionLinks';

describe('a decision\'s anchors on the wire', () => {
  const a = decisionKey({ corte: 'cassazione', archivio: 'civile', numero: 1, anno: 2024 });
  const b = decisionKey({ corte: 'cassazione', archivio: 'civile', numero: 10, anno: 2024 });
  const c = decisionKey({ corte: 'corte_costituzionale', numero: 5, anno: 2020 });

  it('round-trips the key with no article', () => {
    for (const key of [a, b, c]) {
      expect(parseWireNormaKey(buildWireNormaKey(key, ''))).toEqual({ normaKey: key, articleId: '' });
    }
  });

  it('the prefix query for one decision cannot match another', () => {
    const prefix = buildWireNormaKeyPrefix(a, '');
    expect(prefix).toBe('cassazione:civile:1:2024::art::');
    expect(buildWireNormaKey(a, '').startsWith(prefix)).toBe(true);
    expect(buildWireNormaKey(b, '').startsWith(prefix)).toBe(false);
    expect(buildWireNormaKey(c, '').startsWith(prefix)).toBe(false);
    // the year is four digits and the separator follows it: a longer number or year cannot extend it
    expect(`cassazione:civile:1:20245::art::`.startsWith(prefix)).toBe(false);
  });
});
