import { describe, it, expect } from 'vitest';
import { formatFonte, normRefToSearchParams } from '../provenance';

describe('formatFonte', () => {
  it('maps known pipeline codes to human labels', () => {
    expect(formatFonte('llm_extraction')).toMatch(/automatica/i);
    expect(formatFonte('brocardi')).toMatch(/brocardi/i);
  });

  it('falls back to the raw value for an unknown pipeline', () => {
    expect(formatFonte('some_new_pipeline')).toBe('some_new_pipeline');
  });

  it('labels a missing fonte as unknown-origin', () => {
    expect(formatFonte(undefined)).toMatch(/sconosciuta/i);
  });
});

describe('normRefToSearchParams', () => {
  it('returns null for empty / placeholder references', () => {
    expect(normRefToSearchParams(undefined)).toBeNull();
    expect(normRefToSearchParams('')).toBeNull();
    expect(normRefToSearchParams('user_document')).toBeNull();
  });

  it('parses a bare NIR URN into SearchParams', () => {
    const params = normRefToSearchParams('urn:nir:stato:legge:1990-08-07;241~art1');
    expect(params).not.toBeNull();
    expect(params?.act_type).toBe('legge');
    expect(params?.date).toBe('1990-08-07');
    expect(params?.act_number).toBe('241');
    expect(params?.article).toBe('1');
  });

  it('strips the NIR version marker (!vig=) before parsing', () => {
    const params = normRefToSearchParams('urn:nir:stato:codice.civile:1942-03-16;262~art2043!vig=');
    expect(params).not.toBeNull();
    expect(params?.act_type).toBe('codice civile');
    expect(params?.article).toBe('2043');
  });

  it('parses a full Normattiva URL', () => {
    const params = normRefToSearchParams(
      'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:codice.civile:1942-03-16;262~art2043',
    );
    expect(params?.act_type).toBe('codice civile');
    expect(params?.article).toBe('2043');
  });

  it('returns null for an unparseable reference', () => {
    expect(normRefToSearchParams('not-a-urn-or-url')).toBeNull();
  });
});
