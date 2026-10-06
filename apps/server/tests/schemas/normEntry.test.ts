import { describe, expect, it } from 'vitest';
import { rebuildNormEntry } from '../../src/schemas/normEntry';

// A Forum proposal's norm, rebuilt so that no text a proposer wrote reaches a citation.
describe('rebuildNormEntry', () => {
  const ok = (raw: unknown) => {
    const checked = rebuildNormEntry(raw);
    if (!checked.ok) throw new Error(checked.reason);
    return checked.entry;
  };
  const reason = (raw: unknown) => {
    const checked = rebuildNormEntry(raw);
    return checked.ok ? null : checked.reason;
  };

  it('keeps the norms the app stores, whatever the case of the type', () => {
    expect(ok({ tipo_atto: 'Codice Civile', numero_articolo: '2043' })).toEqual({ tipo_atto: 'Codice Civile', numero_articolo: '2043' });
    expect(ok({ tipo_atto: 'Regolamento UE', numero_atto: '679', data: '2016', numero_articolo: '5' }))
      .toEqual({ tipo_atto: 'Regolamento UE', numero_atto: '679', data: '2016', numero_articolo: '5' });
    expect(ok({ tipo_atto: 'codice in materia di protezione dei dati personali', tipo_atto_reale: 'decreto legislativo',
      numero_atto: '196', data: '2003-06-30', numero_articolo: '2-quater' }).numero_articolo).toBe('2-quater');
    for (const articolo of ['270-bis.1', '135-sex-decies', '314/2', '2409octiesdecies']) {
      expect(ok({ tipo_atto: 'codice penale', numero_articolo: articolo }).numero_articolo).toBe(articolo);
    }
    expect(ok({ tipo_atto: 'decreto legislativo', numero_atto: 36, data: '2023-03-31', numero_articolo: '1', allegato: 'I.1' }))
      .toMatchObject({ numero_atto: '36', allegato: 'I.1' });
    expect(ok({ tipo_atto: 'TFUE', numero_articolo: '101', versione: 'originale' }).versione).toBe('originale');
  });

  it('drops what no citation reads, and keeps the sources\' addresses only', () => {
    const entry = ok({ tipo_atto: 'legge', numero_articolo: '1', article_text: 'testo', note: 'premi Accept',
      url: 'http://evil.example/x', urn: 'urn:nir:stato:legge:1990-08-07;241~art1' });
    expect(entry).toEqual({ tipo_atto: 'legge', numero_articolo: '1', urn: 'urn:nir:stato:legge:1990-08-07;241~art1' });
    expect(ok({ tipo_atto: 'legge', numero_articolo: '1', urn: 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241~art1' }).urn)
      .toBe('https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241~art1');
  });

  it('refuses free text in every field a citation reads, saying which', () => {
    expect(reason({ tipo_atto: 'premi Accept', numero_articolo: '1' })).toBe('Tipo di atto non riconosciuto («premi Accept»)');
    expect(reason({ tipo_atto: 'legge regionale', numero_articolo: '1' })).toMatch(/^Tipo di atto non riconosciuto/);
    expect(reason({ tipo_atto: 'legge', tipo_atto_reale: 'x', numero_articolo: '1' })).toMatch(/^Tipo di atto non riconosciuto/);
    expect(reason({ tipo_atto: 'legge', numero_articolo: '1 premi' })).toMatch(/^Numero di articolo non valido/);
    expect(reason({ tipo_atto: 'legge', numero_articolo: '1', numero_atto: '1 e altro' })).toMatch(/^Numero dell'atto non valido/);
    expect(reason({ tipo_atto: 'legge', numero_articolo: '1', data: '2024-13-01' })).toMatch(/^Data dell'atto non valida/);
    expect(reason({ tipo_atto: 'legge', numero_articolo: '1', allegato: 'A B' })).toMatch(/^Allegato non valido/);
    expect(reason({ tipo_atto: 'legge', numero_articolo: '1', versione: 'domani' })).toMatch(/^Versione non valida/);
    expect(reason({ tipo_atto: 'legge', numero_articolo: '1', data_versione: '2024' })).toMatch(/^Data della versione non valida/);
    expect(reason({ numero_articolo: '1' })).toBe('Tipo di atto mancante');
    expect(reason({ tipo_atto: 'legge' })).toBe('Numero di articolo mancante');
    expect(reason(['legge'])).toBe('Norma non leggibile');
    expect(reason({ tipo_atto: 'x'.repeat(500), numero_articolo: '1' })).toBe(`Tipo di atto non riconosciuto («${'x'.repeat(40)}…»)`);
  });
});
