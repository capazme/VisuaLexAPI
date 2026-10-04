// apps/web/src/utils/__tests__/decisionLinks.test.ts
import { describe, expect, it } from 'vitest';
import { DECISION_PAGE_AVAILABLE, linkableDecisionPath } from '../decisionLinks';

const NOW = new Date('2026-10-01T00:00:00Z');

describe('linkableDecisionPath', () => {
  it('archive known: the identity path, no section', () => {
    expect(linkableDecisionPath({ corte: 'cassazione', archivio: 'civile', numero: 13319, anno: 2024, sezione: 'U' }, NOW))
      .toBe('/sentenze/cassazione-civile/13319/2024');
    expect(linkableDecisionPath({ corte: 'cassazione', archivio: 'penale', numero: 1399, anno: 2000 }, NOW))
      .toBe('/sentenze/cassazione-penale/1399/2000');
    expect(linkableDecisionPath({ corte: 'corte_costituzionale', numero: 1, anno: 2014 }, NOW))
      .toBe('/sentenze/corte-costituzionale/1/2014');
  });

  it('archive unknown: the section as written, URL-encoded', () => {
    expect(linkableDecisionPath({ corte: 'cassazione', archivio: null, numero: 15, anno: 2019, sezione: ' 6-3 ' }, NOW))
      .toBe('/sentenze/cassazione/15/2019?sezione=6-3');
    expect(linkableDecisionPath({ corte: 'cassazione', numero: 15, anno: 2019, sezione: 'VI - 1' }, NOW))
      .toBe('/sentenze/cassazione/15/2019?sezione=VI%20-%201');
  });

  it.each([
    [{ corte: 'tar', numero: 15, anno: 2019 }],
    [{ corte: 'cassazione', archivio: 'civile', numero: 15, anno: null }],
    [{ corte: 'cassazione', archivio: 'civile', numero: 0, anno: 2019 }],
    [{ corte: 'cassazione', archivio: 'civile', numero: 1_000_000, anno: 2019 }],
    [{ corte: 'corte_costituzionale', numero: 1, anno: 1950 }],
    [{ corte: 'cassazione', archivio: 'civile', numero: 1, anno: 2027 }],
  ])('no link for %j', (raw) => {
    expect(linkableDecisionPath(raw, NOW)).toBeNull();
  });

  it('the decision page exists', () => {
    expect(DECISION_PAGE_AVAILABLE).toBe(true);
  });
});
