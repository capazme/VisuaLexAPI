import { describe, it, expect } from 'vitest';
import { buildCaseLawReference } from './caseLawService';

describe('buildCaseLawReference', () => {
  it('abbreviates a codified act to the form courts actually cite', () => {
    // The flagship example throughout the backend's own docs and tests
    // (visualex_api/services/case_law/italgiure.py) — "art. 2043 codice
    // civile" would never match a decision's OCR text, which says "c.c.".
    expect(
      buildCaseLawReference({ tipo_atto: 'codice civile', numero_atto: undefined, data: '1942-03-16', numero_articolo: '2043' }),
    ).toBe('art. 2043 c.c.');
  });

  it('abbreviates the Costituzione', () => {
    expect(
      buildCaseLawReference({ tipo_atto: 'costituzione', numero_atto: undefined, data: '1947-12-27', numero_articolo: '3' }),
    ).toBe('art. 3 Cost.');
  });

  it('builds the CELLAR-shape reference for a Regolamento UE', () => {
    // Must match visualex_api/services/case_law/cellar.py's _REG regex:
    // "regolamento\s+ue\s+(?:n\.\s*)?(\d{1,4})/(\d{1,4})".
    expect(
      buildCaseLawReference({ tipo_atto: 'regolamento ue', numero_atto: '679', data: '2016-05-04', numero_articolo: '17' }),
    ).toBe('art. 17 Regolamento UE 679/2016');
  });

  it('falls back to the act name and number for an uncodified law', () => {
    expect(
      buildCaseLawReference({ tipo_atto: 'legge', numero_atto: '241', data: '1990-08-07', numero_articolo: '3' }),
    ).toBe('art. 3 legge n. 241 del 1990-08-07');
  });

  it('degrades to the bare act name when neither numero_atto nor data is known', () => {
    expect(
      buildCaseLawReference({ tipo_atto: 'legge', numero_atto: undefined, data: '', numero_articolo: '3' }),
    ).toBe('art. 3 legge');
  });
});
