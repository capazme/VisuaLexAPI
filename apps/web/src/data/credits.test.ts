import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CREDITS, CREDIT_GROUPS, creditHref, getCredit, type CreditId } from './credits';

/**
 * The lines of attribution the owners approved, copied from their table (19 Oct 2026). Legal text: a
 * difference of one character here is a change of wording, not a fix, and needs their word first.
 */
const APPROVED_SOURCES: Record<string, string> = {
  normattiva: 'Fonte: Normattiva. Testo non autentico, gratuito, a solo scopo informativo.',
  senato: 'Fonte: Senato della Repubblica, dati aperti, CC BY 3.0',
  'corte-costituzionale': 'Fonte: Corte costituzionale, dati aperti, CC BY-SA 3.0',
  'eur-lex': 'Fonte: EUR-Lex, © Unione europea. Solo i testi pubblicati nella GUUE sono autentici.',
  cerdef: 'Fonte: CeRDEF, Dipartimento delle Finanze. Testi gratuiti, non ufficiali.',
  consob: 'Fonte: CONSOB.',
  cassazione: 'Fonte: Corte di cassazione, SentenzeWeb (Italgiure).',
  'giustizia-amministrativa': 'Fonte: Giustizia amministrativa.',
};

const FONTS = { newsreader: '@fontsource-variable/newsreader', geist: '@fontsource-variable/geist' } as const;

const entry = (id: CreditId) => getCredit(id);
const textOf = (id: CreditId) => JSON.stringify(entry(id));

describe('credits.ts', () => {
  it('holds exactly the eight sources of group A and the two typefaces', () => {
    expect(CREDITS.map((c) => c.id).sort()).toEqual([...Object.keys(APPROVED_SOURCES), ...Object.keys(FONTS)].sort());
  });

  it.each(Object.entries(APPROVED_SOURCES))('writes the approved line for %s, verbatim', (id, line) => {
    expect(entry(id as CreditId).attribution).toBe(line);
  });

  it('names no source left out of the page (group B, C and D, Brocardi)', () => {
    const all = JSON.stringify(CREDITS).toLowerCase();
    for (const name of ['gazzetta', 'camera', 'garante', 'cellar', 'tmview', 'vies', 'brocardi', 'istat', 'mimit']) {
      expect(all).not.toContain(name);
    }
  });

  it('gives every entry a group the page draws, a source on https, and its fields filled', () => {
    const groups = CREDIT_GROUPS.map((g) => g.id);
    for (const credit of CREDITS) {
      expect(groups).toContain(credit.group);
      expect(credit.sourceUrl).toMatch(/^https:\/\//);
      for (const field of ['name', 'holder', 'uses', 'terms', 'attribution', 'verified'] as const) {
        expect(credit[field].trim()).not.toBe('');
      }
    }
    expect(new Set(CREDITS.map((c) => c.id)).size).toBe(CREDITS.length);
  });

  it('writes no «CC BY 4.0» for Normattiva: the server reads the site, not the open data', () => {
    expect(textOf('normattiva')).not.toMatch(/CC\s*BY/i);
    expect(entry('normattiva').licenceUrl).toBeUndefined();
  });

  it('writes «CC BY-SA 3.0» for the Corte costituzionale, with no version and nothing imposed on VisuaLex', () => {
    const corte = entry('corte-costituzionale');
    expect(corte.terms).toContain('CC BY-SA 3.0');
    expect(textOf('corte-costituzionale')).not.toMatch(/versione|unported|italiana|\/it\/|stessa licenza|allo stesso modo/i);
    expect(corte.licenceUrl).toBe('https://creativecommons.org/licenses/by-sa/3.0/');
  });

  it('links the Senato to the CC BY 3.0', () => {
    expect(entry('senato').licenceUrl).toBe('https://creativecommons.org/licenses/by/3.0/');
  });

  it('writes the purposes CONSOB allows', () => {
    expect(entry('consob').terms).toContain(
      'per finalità di studio, ricerca, informazione e documentazione, con obbligo di citarne la fonte',
    );
  });

  it.each(['cassazione', 'giustizia-amministrativa'] as const)('writes only the indication of the source for %s', (id) => {
    expect(entry(id).terms).toBe('Indicazione della fonte.');
    expect(textOf(id)).not.toMatch(/intelligenza|massiv|commercial|uso proprio|vietat/i);
  });

  it.each(Object.entries(FONTS))('writes %s as OFL-1.1, as its package says', (id, pkg) => {
    const dir = resolve(__dirname, '../../node_modules', pkg);
    const manifest = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')) as { license: string };
    expect(manifest.license).toBe('OFL-1.1');
    expect(readFileSync(resolve(dir, 'LICENSE'), 'utf8')).toContain('SIL Open Font License, Version 1.1');
    const font = entry(id as CreditId);
    expect(font.group).toBe('software');
    expect(font.terms).toContain('OFL-1.1');
    expect(font.attribution).toContain('SIL Open Font License 1.1');
  });

  it('reads an entry by id and gives its address on the page', () => {
    expect(getCredit('corte-costituzionale').name).toBe('Corte costituzionale');
    expect(creditHref('corte-costituzionale')).toBe('/crediti#corte-costituzionale');
  });
});
