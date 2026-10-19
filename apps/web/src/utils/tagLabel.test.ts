import { describe, it, expect } from 'vitest';
import { hasTagCategory, tagCategories, tagLabel } from './tagLabel';

describe('tagLabel', () => {
  it('capitalises the first letter and leaves the rest as typed', () => {
    expect(tagLabel('accesso')).toBe('Accesso');
    expect(tagLabel('diritto di accesso')).toBe('Diritto di accesso');
    expect(tagLabel('DPO')).toBe('DPO');
    expect(tagLabel('GDPR')).toBe('GDPR');
    expect(tagLabel('eBay')).toBe('EBay');
    expect(tagLabel('è vigente')).toBe('È vigente');
  });

  it('leaves what has no first letter to capitalise', () => {
    expect(tagLabel('')).toBe('');
    expect(tagLabel('231/2001')).toBe('231/2001');
    expect(tagLabel('«appello»')).toBe('«appello»');
  });

  it('never changes the value it is given', () => {
    const tag = 'cancellazione';
    tagLabel(tag);
    expect(tag).toBe('cancellazione');
  });
});

describe('tagCategories', () => {
  it('orders by letter, ignoring case, with the Italian rules', () => {
    const labels = tagCategories(['appello', 'DPO', 'GDPR', 'accesso', 'Zona', 'cancellazione', 'éra', 'bando']).map((c) => c.label);
    expect(labels).toEqual(['Accesso', 'Appello', 'Bando', 'Cancellazione', 'DPO', 'Éra', 'GDPR', 'Zona']);
  });

  it('makes one category of values that differ only by case, filtering both', () => {
    const categories = tagCategories(['gdpr', 'GDPR', 'Gdpr', 'privacy']);
    expect(categories.map((c) => c.label)).toEqual(['GDPR', 'Privacy']);
    expect(categories[0].values).toEqual(expect.arrayContaining(['gdpr', 'GDPR', 'Gdpr']));
    expect(categories[0].values).toHaveLength(3);
    expect(hasTagCategory(['gdpr'], categories[0])).toBe(true);
    expect(hasTagCategory(['GDPR'], categories[0])).toBe(true);
    expect(hasTagCategory(['privacy'], categories[0])).toBe(false);
  });

  it('keeps apart values that differ by an accent', () => {
    expect(tagCategories(['perché', 'perche']).map((c) => c.values)).toEqual([['perche'], ['perché']]);
  });

  it('skips empty values and repeats', () => {
    expect(tagCategories(['', 'accesso', 'accesso'])).toEqual([{ key: 'accesso', label: 'Accesso', values: ['accesso'] }]);
  });

  it('compares the stored values, not the labels', () => {
    const [accesso] = tagCategories(['accesso']);
    expect(hasTagCategory(['Accesso'], accesso)).toBe(false);
    expect(hasTagCategory(undefined, accesso)).toBe(false);
  });
});
