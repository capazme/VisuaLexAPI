import { describe, expect, it } from 'vitest';
import { ACT_TYPES } from '../../../constants/actTypes';
import { filterPaletteActs, paletteActGroups, paletteActName, queryMatches } from './paletteActs';

const names = (query: string) => filterPaletteActs(query).flatMap((g) => g.acts.map((a) => a.name));

describe('the palette\'s list of acts', () => {
  it('carries every act of ACT_TYPES once, in its order, under sentence-case headings', () => {
    const values = paletteActGroups().flatMap((g) => g.acts.map((a) => a.value));
    expect(values).toEqual(ACT_TYPES.map((a) => a.value));
    expect(paletteActGroups().map((g) => g.heading)).toEqual(['Fonti primarie', 'Codici fondamentali', 'Codici settoriali', 'Unione europea']);
  });

  it('names an act in full, with the convention\'s abbreviation when there is one', () => {
    const act = (value: string) => paletteActGroups().flatMap((g) => g.acts).find((a) => a.value === value)!;
    expect(act('codice civile')).toMatchObject({ name: 'Codice civile', abbreviation: 'c.c.' });
    expect(act('codice di procedura civile')).toMatchObject({ name: 'Codice di procedura civile', abbreviation: 'c.p.c.' });
    expect(act('decreto legislativo')).toMatchObject({ name: 'Decreto legislativo', abbreviation: 'd.lgs.' });
    expect(act('TFUE')).toMatchObject({ name: 'Trattato sul funzionamento dell\'Unione europea', abbreviation: 'TFUE' });
    // no abbreviation in the convention: none is invented
    expect(act('codice della strada')).toMatchObject({ name: 'Codice della strada', abbreviation: undefined });
    // its own abbreviation is not written twice
    expect(act('preleggi').abbreviation).toBeUndefined();
  });

  it('narrows to the acts every typed word begins a word of', () => {
    expect(names('proc')).toEqual(expect.arrayContaining(['Codice di procedura civile', 'Codice di procedura penale']));
    expect(names('proc civ')).toEqual(['Codice di procedura civile', 'Disposizioni di attuazione del codice di procedura civile']);
    expect(names('cod pen')).toEqual(['Codice penale', 'Codice di procedura penale']);
  });

  it('finds an act by its abbreviation, with or without the dots, and ignores case and accents', () => {
    expect(names('cpc')).toContain('Codice di procedura civile');
    expect(names('c.p.c.')).toContain('Codice di procedura civile');
    expect(names('d.lgs')).toEqual(['Decreto legislativo']);
    expect(names('dlgs')).toEqual(['Decreto legislativo']);
    expect(names('PROPRIETA')).toEqual(['Codice della proprietà industriale']);
    // the old label's words still find it
    expect(names('privacy')).toEqual(['Codice in materia di protezione dei dati personali']);
  });

  it('keeps everything for an empty query and nothing for a citation or a name no act has', () => {
    expect(filterPaletteActs('  ')).toEqual(paletteActGroups());
    expect(filterPaletteActs('art 2043 cc')).toEqual([]);
    expect(filterPaletteActs('zzz')).toEqual([]);
  });

  it('drops a group left with no act', () => {
    expect(filterPaletteActs('tfue').map((g) => g.heading)).toEqual(['Unione europea']);
  });

  it('names a picked or resolved act whatever its case, else as it came', () => {
    expect(paletteActName('regolamento ue')).toBe('Regolamento UE');
    expect(paletteActName('codice di procedura penale')).toBe('Codice di procedura penale');
    expect(paletteActName('statuto dei lavoratori')).toBe('statuto dei lavoratori');
    expect(paletteActName('')).toBe('');
  });
});

describe('queryMatches', () => {
  it('reads every word as the start of a word of the parts', () => {
    expect(queryMatches('mio', 'mio-contratto', 'Art. 1490 c.c.')).toBe(true);
    expect(queryMatches('contr 1490', 'mio-contratto', 'Art. 1490 c.c.')).toBe(true);
    expect(queryMatches('tratto', 'mio-contratto')).toBe(false);
    // a favourite's abbreviation, with or without its dots
    expect(queryMatches('2043 cc', 'Art. 2043 c.c.')).toBe(true);
    expect(queryMatches('2043 c.c.', 'Art. 2043 cc')).toBe(true);
    expect(queryMatches('', 'anything')).toBe(true);
  });
});
