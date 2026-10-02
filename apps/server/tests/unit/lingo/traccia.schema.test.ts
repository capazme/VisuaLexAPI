import { describe, it, expect } from 'vitest';
import {
  lingoTracciaImportRowSchema,
  isImportable,
  tracciaIdFromChiave,
} from '../../../src/schemas/lingo/traccia';

const TEXT = 'Tizio acquista da Caio un bene che si rivela difettoso. '.repeat(3);

function validRow(overrides: Record<string, unknown> = {}) {
  return {
    chiave: '2005-civile-atto-1',
    materia: 'DIRITTO_CIVILE',
    tipoProva: 'ATTO_GIUDIZIARIO',
    sottoTipoAtto: 'comparsa_risposta',
    titolo: 'Sessione 2005, atto di diritto civile',
    testoTraccia: TEXT,
    fonteTraccia: 'sessione_2005',
    provenienza: { fonte: 'ministero_giustizia', statoUtilizzo: 'ufficiale_verificato' },
    ...overrides,
  };
}

describe('lingoTracciaImportRowSchema', () => {
  it('accepts a minimal row and fills in the defaults', () => {
    const parsed = lingoTracciaImportRowSchema.parse(validRow());
    expect(parsed.attiva).toBe(true);
    expect(parsed.difficolta).toBe(3);
    expect(parsed.normeRiferimento).toEqual([]);
    expect(parsed.questioniForma).toEqual([]);
    expect(parsed.questioniSostanza).toEqual([]);
  });

  it.each(['DIRITTO_CIVILE', 'DIRITTO_PENALE', 'DIRITTO_AMMINISTRATIVO'])(
    'accepts materia %s',
    (materia) => {
      expect(lingoTracciaImportRowSchema.safeParse(validRow({ materia })).success).toBe(true);
    }
  );

  it('rejects an unknown materia', () => {
    expect(lingoTracciaImportRowSchema.safeParse(validRow({ materia: 'DIRITTO_TRIBUTARIO' })).success).toBe(false);
  });

  it('rejects an unknown tipoProva', () => {
    expect(lingoTracciaImportRowSchema.safeParse(validRow({ tipoProva: 'ORALE' })).success).toBe(false);
  });

  it.each(['sessione_2023', 'scuola_forense', 'creata_validata'])('accepts fonteTraccia %s', (fonteTraccia) => {
    expect(lingoTracciaImportRowSchema.safeParse(validRow({ fonteTraccia })).success).toBe(true);
  });

  it.each(['2005', 'sessione_05', 'Sessione_2005', 'altro'])('rejects fonteTraccia %s', (fonteTraccia) => {
    expect(lingoTracciaImportRowSchema.safeParse(validRow({ fonteTraccia })).success).toBe(false);
  });

  it.each(['Comparsa Risposta', 'comparsa-risposta', ''])('rejects sottoTipoAtto %j', (sottoTipoAtto) => {
    expect(lingoTracciaImportRowSchema.safeParse(validRow({ sottoTipoAtto })).success).toBe(false);
  });

  it.each(['Sessione 2005', 'a b', 'x'])('rejects chiave %j', (chiave) => {
    expect(lingoTracciaImportRowSchema.safeParse(validRow({ chiave })).success).toBe(false);
  });

  it('rejects a text that is too short to be a trace', () => {
    expect(lingoTracciaImportRowSchema.safeParse(validRow({ testoTraccia: 'troppo corto' })).success).toBe(false);
  });

  it('rejects a text that is too long to be a trace', () => {
    expect(lingoTracciaImportRowSchema.safeParse(validRow({ testoTraccia: 'x'.repeat(20_001) })).success).toBe(false);
  });

  it.each([0, 6, 2.5])('rejects difficolta %s', (difficolta) => {
    expect(lingoTracciaImportRowSchema.safeParse(validRow({ difficolta })).success).toBe(false);
  });

  it('rejects a key the contract does not know (drift in the cleaning output)', () => {
    expect(lingoTracciaImportRowSchema.safeParse(validRow({ soluzione: 'testo di terzi' })).success).toBe(false);
  });

  it('requires the provenance block', () => {
    const { provenienza: _omitted, ...withoutProvenance } = validRow();
    expect(lingoTracciaImportRowSchema.safeParse(withoutProvenance).success).toBe(false);
  });

  it('rejects an unknown usage state', () => {
    const row = validRow({ provenienza: { fonte: 'ministero_giustizia', statoUtilizzo: 'forse' } });
    expect(lingoTracciaImportRowSchema.safeParse(row).success).toBe(false);
  });
});

describe('provenienza', () => {
  it('refuses material from third parties marked as verified official', () => {
    const row = validRow({ provenienza: { fonte: 'terzi', statoUtilizzo: 'ufficiale_verificato' } });
    const result = lingoTracciaImportRowSchema.safeParse(row);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((i) => i.path.join('.'))).toContain('provenienza.statoUtilizzo');
  });

  it.each(['ministero_giustizia', 'originale'] as const)('accepts a source of %s as verified official', (fonte) => {
    expect(
      lingoTracciaImportRowSchema.safeParse(validRow({ provenienza: { fonte, statoUtilizzo: 'ufficiale_verificato' } })).success
    ).toBe(true);
  });

  it.each(['da_verificare', 'escluso'] as const)('accepts third parties while they are %s', (statoUtilizzo) => {
    expect(lingoTracciaImportRowSchema.safeParse(validRow({ provenienza: { fonte: 'terzi', statoUtilizzo } })).success).toBe(true);
  });
});

describe('isImportable', () => {
  it('lets through only rows whose source is verified as official', () => {
    const official = lingoTracciaImportRowSchema.parse(validRow());
    const unverified = lingoTracciaImportRowSchema.parse(
      validRow({ provenienza: { fonte: 'terzi', statoUtilizzo: 'da_verificare' } })
    );
    const excluded = lingoTracciaImportRowSchema.parse(
      validRow({ provenienza: { fonte: 'terzi', statoUtilizzo: 'escluso' } })
    );
    expect(isImportable(official)).toBe(true);
    expect(isImportable(unverified)).toBe(false);
    expect(isImportable(excluded)).toBe(false);
  });
});

describe('tracciaIdFromChiave', () => {
  it('is stable for the same key', () => {
    expect(tracciaIdFromChiave('2005-civile-atto-1')).toBe(tracciaIdFromChiave('2005-civile-atto-1'));
  });

  it('differs for different keys', () => {
    expect(tracciaIdFromChiave('2005-civile-atto-1')).not.toBe(tracciaIdFromChiave('2005-civile-atto-2'));
  });

  it('is a valid uuid, like every other id in the schema', () => {
    expect(tracciaIdFromChiave('2005-civile-atto-1')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });
});
