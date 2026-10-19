import { describe, expect, it } from 'vitest';
import { prisma } from './helpers';
import { importLingoTracce } from '../src/utils/importLingoTracce';
import { tracciaIdFromChiave } from '../src/schemas/lingo/traccia';

const TEXT = 'Tizio acquista da Caio un bene che si rivela difettoso. '.repeat(3);

function row(chiave: string, overrides: Record<string, unknown> = {}) {
  return {
    chiave,
    materia: 'DIRITTO_CIVILE',
    tipoProva: 'ATTO_GIUDIZIARIO',
    sottoTipoAtto: 'comparsa_risposta',
    titolo: `Traccia ${chiave}`,
    testoTraccia: TEXT,
    fonteTraccia: 'sessione_2005',
    provenienza: { fonte: 'ministero_giustizia', statoUtilizzo: 'ufficiale_verificato' },
    ...overrides,
  };
}

describe('importLingoTracce', () => {
  it('a dry run reports what it would do and writes nothing', async () => {
    const report = await importLingoTracce([row('2005-civile-atto-1'), row('2005-civile-atto-2')], { apply: false });
    expect(report).toMatchObject({ applied: false, total: 2, created: 2, updated: 0, rejected: [] });
    expect(await prisma.lingoTraccia.count()).toBe(0);
  });

  it('summarises the rows by subject, kind of test and source', async () => {
    const report = await importLingoTracce(
      [
        row('2005-civile-atto-1'),
        row('2006-civile-atto-1', { fonteTraccia: 'sessione_2006' }),
        row('2006-penale-atto-1', { materia: 'DIRITTO_PENALE', sottoTipoAtto: 'appello_penale', fonteTraccia: 'sessione_2006' }),
        row('2006-penale-parere-1', {
          materia: 'DIRITTO_PENALE',
          tipoProva: 'PARERE_MOTIVATO',
          sottoTipoAtto: 'parere_motivato',
          fonteTraccia: 'sessione_2006',
        }),
      ],
      { apply: false }
    );
    expect(report.summary).toEqual({
      materia: { DIRITTO_CIVILE: 2, DIRITTO_PENALE: 2 },
      tipoProva: { ATTO_GIUDIZIARIO: 3, PARERE_MOTIVATO: 1 },
      fonte: { sessione_2005: 1, sessione_2006: 3 },
    });
  });

  it('has nothing to summarise when the file is refused', async () => {
    const report = await importLingoTracce([row('2005-civile-atto-1', { materia: 'DIRITTO_TRIBUTARIO' })], { apply: false });
    expect(report.summary).toEqual({ materia: {}, tipoProva: {}, fonte: {} });
  });

  it('applies the rows under ids derived from their keys', async () => {
    const report = await importLingoTracce(
      [row('2005-civile-atto-1', { normeRiferimento: ['urn:nir:stato:codice.civile:1942-03-16;262~art1492'], difficolta: 4 })],
      { apply: true }
    );
    expect(report).toMatchObject({ applied: true, created: 1, updated: 0 });

    const stored = await prisma.lingoTraccia.findUnique({ where: { id: tracciaIdFromChiave('2005-civile-atto-1') } });
    expect(stored).toMatchObject({
      materia: 'DIRITTO_CIVILE',
      tipoProva: 'ATTO_GIUDIZIARIO',
      sottoTipoAtto: 'comparsa_risposta',
      fonteTraccia: 'sessione_2005',
      attiva: true,
      difficolta: 4,
      normeRiferimento: ['urn:nir:stato:codice.civile:1942-03-16;262~art1492'],
      questioniForma: [],
      questioniSostanza: [],
    });
  });

  it('does not keep the provenance: it is about the row, not the trace', async () => {
    await importLingoTracce([row('2005-civile-atto-1')], { apply: true });
    const stored = await prisma.lingoTraccia.findUniqueOrThrow({ where: { id: tracciaIdFromChiave('2005-civile-atto-1') } });
    expect(stored).not.toHaveProperty('provenienza');
  });

  it('importing the same file twice updates in place and never duplicates', async () => {
    const file = [row('2005-civile-atto-1'), row('2006-civile-atto-1')];
    await importLingoTracce(file, { apply: true });
    const second = await importLingoTracce(file, { apply: true });
    expect(second).toMatchObject({ created: 0, updated: 2 });
    expect(await prisma.lingoTraccia.count()).toBe(2);
  });

  it('a corrected text replaces the stored one', async () => {
    await importLingoTracce([row('2005-civile-atto-1')], { apply: true });
    const corrected = `${TEXT} Il candidato rediga l'atto.`;
    await importLingoTracce([row('2005-civile-atto-1', { testoTraccia: corrected })], { apply: true });
    const stored = await prisma.lingoTraccia.findUniqueOrThrow({ where: { id: tracciaIdFromChiave('2005-civile-atto-1') } });
    expect(stored.testoTraccia).toBe(corrected);
  });

  it('refuses the whole file when one row is invalid, naming the row', async () => {
    const report = await importLingoTracce(
      [row('2005-civile-atto-1'), row('2005-civile-atto-2', { materia: 'DIRITTO_TRIBUTARIO' })],
      { apply: true }
    );
    expect(report.applied).toBe(false);
    expect(report.created).toBe(0);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0]).toMatchObject({ index: 1, chiave: '2005-civile-atto-2' });
    expect(report.rejected[0].reason).toMatch(/materia/);
    expect(await prisma.lingoTraccia.count()).toBe(0);
  });

  it('refuses a row whose source is not verified as official', async () => {
    const report = await importLingoTracce(
      [
        row('2005-civile-atto-1'),
        row('2005-civile-atto-2', { provenienza: { fonte: 'terzi', statoUtilizzo: 'da_verificare' } }),
      ],
      { apply: true }
    );
    expect(report.applied).toBe(false);
    expect(report.rejected).toEqual([
      expect.objectContaining({ index: 1, chiave: '2005-civile-atto-2', reason: expect.stringMatching(/ufficiale/i) }),
    ]);
    expect(await prisma.lingoTraccia.count()).toBe(0);
  });

  it('refuses a file that uses the same key twice', async () => {
    const report = await importLingoTracce([row('2005-civile-atto-1'), row('2005-civile-atto-1')], { apply: true });
    expect(report.applied).toBe(false);
    expect(report.rejected).toEqual([
      expect.objectContaining({ index: 1, chiave: '2005-civile-atto-1', reason: expect.stringMatching(/duplicat/i) }),
    ]);
    expect(await prisma.lingoTraccia.count()).toBe(0);
  });

  it('refuses a row from third parties that claims to be verified official', async () => {
    const report = await importLingoTracce(
      [row('2005-civile-atto-1', { provenienza: { fonte: 'terzi', statoUtilizzo: 'ufficiale_verificato' } })],
      { apply: true }
    );
    expect(report.applied).toBe(false);
    expect(report.rejected).toEqual([expect.objectContaining({ index: 0, reason: expect.stringMatching(/provenienza\.statoUtilizzo/) })]);
    expect(await prisma.lingoTraccia.count()).toBe(0);
  });

  describe('importing a key that is already in the bank', () => {
    const id = tracciaIdFromChiave('2005-civile-atto-1');
    const curated = {
      normeRiferimento: ['urn:nir:stato:codice.civile:1942-03-16;262~art1492'],
      questioniForma: ['comparsa entro 70 giorni'],
      questioniSostanza: ['garanzia per vizi'],
      difficolta: 5,
    };

    it('keeps the answer key, the difficulty and the state when the new file does not mention them', async () => {
      await importLingoTracce([row('2005-civile-atto-1', curated)], { apply: true });
      await prisma.lingoTraccia.update({ where: { id }, data: { attiva: false } });

      await importLingoTracce([row('2005-civile-atto-1', { titolo: 'Titolo corretto' })], { apply: true });

      const stored = await prisma.lingoTraccia.findUniqueOrThrow({ where: { id } });
      expect(stored.titolo).toBe('Titolo corretto');
      expect(stored).toMatchObject({ ...curated, attiva: false });
    });

    it('replaces them when the new file does provide them', async () => {
      await importLingoTracce([row('2005-civile-atto-1', curated)], { apply: true });
      await prisma.lingoTraccia.update({ where: { id }, data: { attiva: false } });

      await importLingoTracce(
        [row('2005-civile-atto-1', { questioniForma: [], difficolta: 2, attiva: true })],
        { apply: true }
      );

      const stored = await prisma.lingoTraccia.findUniqueOrThrow({ where: { id } });
      expect(stored).toMatchObject({
        questioniForma: [],
        questioniSostanza: curated.questioniSostanza,
        normeRiferimento: curated.normeRiferimento,
        difficolta: 2,
        attiva: true,
      });
    });
  });

  it('refuses input that is not a list of rows', async () => {
    await expect(importLingoTracce({ chiave: 'x' }, { apply: true })).rejects.toThrow(/array/i);
  });
});
