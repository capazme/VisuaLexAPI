import { describe, expect, it } from 'vitest';
import { findPersonalData, splitPersonalData, validIban, validPartitaIva } from './personalDataPatterns';

const kinds = (text: string) => findPersonalData(text).map((s) => [text.slice(s.start, s.end), s.kind]);

describe('findPersonalData — what a machine finds without guessing', () => {
  it('finds a codice fiscale, also with omocodia letters and in lower case', () => {
    expect(kinds('Il sig. X, c.f. RSSMRA85T10A562S, residente')).toEqual([['RSSMRA85T10A562S', 'codice_fiscale']]);
    expect(kinds('cf rssmra85t10a56nh.')).toEqual([['rssmra85t10a56nh', 'codice_fiscale']]);
  });

  it('never takes sixteen characters with the wrong check letter for a codice fiscale', () => {
    expect(kinds('RSSMRA85T10A562X')).toEqual([]);
  });

  it('finds a partita IVA only when its check digit holds', () => {
    expect(kinds('P.IVA 12345678903 e IT07643520567')).toEqual([['12345678903', 'partita_iva'], ['IT07643520567', 'partita_iva']]);
    expect(kinds('protocollo 12345678904')).toEqual([]);
    expect(kinds('P. IVA n.01234567897')).toEqual([['01234567897', 'partita_iva']]);
    expect(kinds('3.12345678903')).toEqual([]);
  });

  it('finds e-mail and PEC addresses', () => {
    expect(kinds('scrivere a mario.rossi@example.test o studio@pec.example.it.')).toEqual([
      ['mario.rossi@example.test', 'email'],
      ['studio@pec.example.it', 'email'],
    ]);
  });

  it('finds Italian telephone numbers, mobile and landline, with or without +39 and separators', () => {
    expect(kinds('tel. 333 1234567, +39 06 1234 5678, 0039-345.123.4567')).toEqual([
      ['333 1234567', 'telefono'],
      ['+39 06 1234 5678', 'telefono'],
      ['0039-345.123.4567', 'telefono'],
    ]);
    expect(kinds('studio (06) 1234 5678')).toEqual([['(06) 1234 5678', 'telefono']]);
  });

  it('never takes an amount with dots for thousands for a telephone number', () => {
    expect(kinds('un danno di 300.000.000 euro e 345.000.000 lire')).toEqual([]);
  });

  it('finds an IBAN only when its check digits hold', () => {
    expect(kinds('IBAN IT60 X054 2811 1010 0000 0123 456 per il bonifico')).toEqual([['IT60 X054 2811 1010 0000 0123 456', 'iban']]);
    expect(kinds('IT60X0542811101000000123456')).toEqual([['IT60X0542811101000000123456', 'iban']]);
    expect(kinds('IT60X0542811101000000123457')).toEqual([]);
    expect(kinds('it60x0542811101000000123456')).toEqual([['it60x0542811101000000123456', 'iban']]);
  });

  it('flags nothing in the citations and numbers of legal texts', () => {
    const text = 'Cass. civ., sez. III, 12 aprile 2018, n. 8980, Rv. 648551-01; art. 2043 c.c.; l. 7 agosto 1990, n. 241; '
      + 'd.lgs. 30 giugno 2003, n. 196; C-634/21; ECLI:EU:C:2023:957; 31310/2024; RG 12345/2020; 01/02/2023; 3.000.000 euro.';
    expect(findPersonalData(text)).toEqual([]);
  });

  it('never changes a character: the pieces spell the text', () => {
    const text = 'Rossi (RSSMRA85T10A562S), tel. 333 1234567 \r\n e-mail a@b.it';
    const pieces = splitPersonalData(text);
    expect(pieces.map((p) => p.text).join('')).toBe(text);
    expect(pieces.filter((p) => p.kind).map((p) => p.kind)).toEqual(['codice_fiscale', 'telefono', 'email']);
  });

  it('stays fast on long runs of digits, dots and letters', () => {
    const long = `${'1.'.repeat(20000)} ${'a.'.repeat(20000)}@ ${'3'.repeat(50000)}`;
    const started = performance.now();
    findPersonalData(long);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('the check digits', () => {
  it('reads a partita IVA and an IBAN as the standards do', () => {
    expect(validPartitaIva('01234567897')).toBe(true);
    expect(validPartitaIva('00000000000')).toBe(false);
    expect(validIban('IT60X0542811101000000123456')).toBe(true);
    expect(validIban('DE89370400440532013000')).toBe(true);
  });
});
