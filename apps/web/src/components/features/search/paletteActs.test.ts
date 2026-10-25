import { describe, expect, it } from 'vitest';
import { ACT_TYPES } from '../../../constants/actTypes';
import { filterPaletteActs, paletteActGroups, paletteActName, queryMatches, matchRanges } from './paletteActs';

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

describe('matchRanges — the letters a typed word matches (R2)', () => {
  it('marks the start of each word a typed word begins, case and accents folded', () => {
    expect(matchRanges('Codice di procedura civile', 'proc civ')).toEqual([[10, 14], [20, 23]]);
    expect(matchRanges('Proprietà', 'proprieta')).toEqual([[0, 9]]);
  });

  it('steps over an abbreviation\'s dots, and marks nothing for an empty query or no match', () => {
    expect(matchRanges('c.c.', 'cc')).toEqual([[0, 3]]);
    // Typed with its dots, an abbreviation is one word: the whole «c.c.», not its first «c» twice.
    expect(matchRanges('Codice civile · c.c.', 'c.c.')).toEqual([[16, 19]]);
    // After an emoji (two UTF-16 units) the letters marked are still the right ones.
    const label = '⚡ Art. 2043 c.c.';
    const [[start, end]] = matchRanges(label, '2043');
    expect(label.slice(start, end)).toBe('2043');
    expect(matchRanges('Codice civile', '')).toEqual([]);
    expect(matchRanges('Codice civile', 'penale')).toEqual([]);
  });

  it('never marks inside a word, only from its start', () => {
    expect(matchRanges('Decreto-legge', 'legge')).toEqual([[8, 13]]);
    expect(matchRanges('Collegato', 'legge')).toEqual([]);
  });
});
