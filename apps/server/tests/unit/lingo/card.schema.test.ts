import { describe, it, expect } from 'vitest';
import { lingoCardAncoraInputSchema, lingoCardCreateSchema } from '../../../src/schemas/lingo/card';

const FINGERPRINT = 'a'.repeat(64);

function anchor(overrides: Record<string, unknown> = {}) {
  return {
    normaKey: 'codice_civile',
    articleId: 'art_1453',
    urn: 'urn:nir:stato:regio.decreto:1942-03-16;262~art1453',
    aknFingerprint: FINGERPRINT,
    ...overrides,
  };
}

function card(overrides: Record<string, unknown> = {}) {
  return {
    materia: 'DIRITTO_CIVILE',
    istituto: 'Risoluzione per inadempimento',
    domanda: 'Quando il contratto può essere risolto per inadempimento?',
    risposta: "Quando l'inadempimento della controparte non è di scarsa importanza.",
    ancore: [anchor()],
    ...overrides,
  };
}

describe('lingoCardAncoraInputSchema', () => {
  it('accepts an anchor, not primary unless it says so', () => {
    expect(lingoCardAncoraInputSchema.parse(anchor()).isPrimary).toBe(false);
  });

  it.each([
    ['too short', 'a'.repeat(63)],
    ['too long', 'a'.repeat(65)],
    ['upper case', 'A'.repeat(64)],
    ['not hexadecimal', 'g'.repeat(64)],
    ['empty', ''],
  ])('refuses a fingerprint that is %s', (_label, aknFingerprint) => {
    expect(lingoCardAncoraInputSchema.safeParse(anchor({ aknFingerprint })).success).toBe(false);
  });

  it('refuses an URN that is not one', () => {
    expect(lingoCardAncoraInputSchema.safeParse(anchor({ urn: 'https://example.org/art1453' })).success).toBe(false);
  });

  it.each(['Codice Civile', 'codice-civile', ''])('refuses a norm key of %j', (normaKey) => {
    expect(lingoCardAncoraInputSchema.safeParse(anchor({ normaKey })).success).toBe(false);
  });

  it('refuses an empty article id', () => {
    expect(lingoCardAncoraInputSchema.safeParse(anchor({ articleId: '' })).success).toBe(false);
  });
});

describe('lingoCardCreateSchema', () => {
  it('accepts a minimal card and fills the kind in', () => {
    const parsed = lingoCardCreateSchema.parse(card());
    expect(parsed.tipo).toBe('ISTITUTO_DEFINIZIONE');
    expect(parsed.spiegazione).toBeUndefined();
  });

  it.each(['ISTITUTO_DEFINIZIONE', 'DISTINZIONE_CONCETTUALE', 'CASO_APPLICATIVO', 'REQUISITO_FORMA_ATTO'])(
    'accepts the kind %s',
    (tipo) => {
      expect(lingoCardCreateSchema.safeParse(card({ tipo })).success).toBe(true);
    }
  );

  it('refuses a kind nobody declared', () => {
    expect(lingoCardCreateSchema.safeParse(card({ tipo: 'FLASHCARD_LIBERA' })).success).toBe(false);
  });

  it('refuses an unknown subject', () => {
    expect(lingoCardCreateSchema.safeParse(card({ materia: 'DIRITTO_TRIBUTARIO' })).success).toBe(false);
  });

  it('refuses a card without a norm', () => {
    expect(lingoCardCreateSchema.safeParse(card({ ancore: [] })).success).toBe(false);
  });

  it('refuses a card with more than ten anchors', () => {
    const ancore = Array.from({ length: 11 }, (_, i) => anchor({ articleId: `art_${i}` }));
    expect(lingoCardCreateSchema.safeParse(card({ ancore })).success).toBe(false);
  });

  it('refuses two primary anchors', () => {
    const ancore = [anchor({ isPrimary: true }), anchor({ articleId: 'art_1455', isPrimary: true })];
    expect(lingoCardCreateSchema.safeParse(card({ ancore })).success).toBe(false);
  });

  it('accepts exactly one primary anchor', () => {
    const ancore = [anchor(), anchor({ articleId: 'art_1455', isPrimary: true })];
    expect(lingoCardCreateSchema.safeParse(card({ ancore })).success).toBe(true);
  });

  it.each([
    ['stato', 'VALIDATA'],
    ['authorityScore', 99],
    ['isControversa', true],
    ['autoreId', 'someone-else'],
    ['id', 'chosen-by-the-caller'],
  ])('refuses the caller setting %s (the server decides it)', (key, value) => {
    expect(lingoCardCreateSchema.safeParse(card({ [key]: value })).success).toBe(false);
  });

  it.each([
    ['istituto', 201],
    ['domanda', 2001],
    ['risposta', 4001],
    ['spiegazione', 8001],
  ])('refuses a %s longer than %i characters', (field, length) => {
    expect(lingoCardCreateSchema.safeParse(card({ [field]: 'x'.repeat(length) })).success).toBe(false);
  });

  it.each(['istituto', 'domanda', 'risposta'])('refuses an empty %s', (field) => {
    expect(lingoCardCreateSchema.safeParse(card({ [field]: '   ' })).success).toBe(false);
  });
});
