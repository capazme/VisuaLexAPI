import { describe, expect, it } from 'vitest';
import {
  DOCTRINE_LABEL,
  LATIN_MAXIMS_LABEL,
  displaySourceName,
  isDoctrineProviderUrl,
} from './doctrineLabel';

describe('labels', () => {
  it('names the layer "Dottrina" and the maxims "Locuzioni latine"', () => {
    expect(DOCTRINE_LABEL).toBe('Dottrina');
    expect(LATIN_MAXIMS_LABEL).toBe('Locuzioni latine');
  });
});

describe('displaySourceName', () => {
  it.each(['Brocardi', 'Brocardi.it', 'brocardi', 'BROCARDI.IT', 'www.brocardi.it', 'brocardi (dottrina)'])(
    'shows "%s" as Dottrina',
    (value) => {
      expect(displaySourceName(value)).toBe(DOCTRINE_LABEL);
    },
  );

  it.each(['Normattiva', 'EUR-Lex', 'llm_extraction', 'Manuale di diritto'])('leaves "%s" unchanged', (value) => {
    expect(displaySourceName(value)).toBe(value);
  });

  it('returns an empty string for null and undefined', () => {
    expect(displaySourceName(null)).toBe('');
    expect(displaySourceName(undefined)).toBe('');
    expect(displaySourceName('')).toBe('');
  });
});

describe('isDoctrineProviderUrl', () => {
  it.each([
    'https://www.brocardi.it/codice-civile/art2043.html',
    'http://brocardi.it/x',
    'https://brocardi.it',
    'HTTPS://WWW.BROCARDI.IT/a?b=1',
  ])('recognises %s', (value) => {
    expect(isDoctrineProviderUrl(value)).toBe(true);
  });

  it.each([
    'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241',
    'https://notbrocardi.it/x',
    'https://brocardi.it.evil.example/x',
    'brocardi.it',
    'ftp://brocardi.it/x',
    '',
  ])('rejects %s', (value) => {
    expect(isDoctrineProviderUrl(value)).toBe(false);
  });

  it('rejects null and undefined', () => {
    expect(isDoctrineProviderUrl(null)).toBe(false);
    expect(isDoctrineProviderUrl(undefined)).toBe(false);
  });
});
