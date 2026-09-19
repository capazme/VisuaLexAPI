import { describe, it, expect } from 'vitest';
import { buildItemKey, uniqueArticleIdFromNorma } from './normaKeys';

const cc2043 = {
  tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262',
  numero_articolo: '2043',
};

describe('buildItemKey', () => {
  it('sanitizes and joins parts with --', () => {
    expect(buildItemKey(cc2043 as never)).toBe('codice-civile--262--1942-03-16--2043');
  });
  it('includes allegato as allN segment', () => {
    expect(buildItemKey({ ...cc2043, allegato: '2' } as never))
      .toBe('codice-civile--262--1942-03-16--all2--2043');
  });
  it('skips empty optional parts', () => {
    expect(buildItemKey({ tipo_atto: 'costituzione', data: '', numero_articolo: '3' } as never))
      .toBe('costituzione--3');
  });
});

describe('uniqueArticleIdFromNorma', () => {
  it('plain number without annex', () => {
    expect(uniqueArticleIdFromNorma({ numero_articolo: '2043' })).toBe('2043');
  });
  it('allN: prefix with annex', () => {
    expect(uniqueArticleIdFromNorma({ allegato: 'A', numero_articolo: '1' })).toBe('allA:1');
  });
});
