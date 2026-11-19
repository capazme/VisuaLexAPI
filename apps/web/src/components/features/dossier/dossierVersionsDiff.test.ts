import { describe, expect, it } from 'vitest';
import { CHANGE_WORDS, changesLine, compareSnapshots, type SnapshotItem } from './dossierVersionsDiff';

const CC = { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16' };
// As the server stores a norm: its row's title is only the act.
const norm = (id: string, art: string, over: object = {}): SnapshotItem => ({ id, itemType: 'norm', title: 'codice civile', content: { ...CC, numero_articolo: art, ...over }, position: 0 });
const note = (id: string, text: string): SnapshotItem => ({ id, itemType: 'note', title: 'Nota', content: text, position: 0 });

describe('compareSnapshots', () => {
  it('finds the entries that came, went and changed, a norm named with its article', () => {
    const from = [norm('a', '2043'), norm('b', '1117'), note('n', 'Il termine è di trenta giorni.')];
    const to = [norm('a', '2043'), norm('c', '1218'), note('n', 'Il termine è di sessanta giorni.')];
    const changes = compareSnapshots(from, to);
    expect(changes.map((c) => [c.kind, c.label])).toEqual([['entrata', 'art. 1218 c.c.'], ['cambiata', 'Nota'], ['uscita', 'art. 1117 c.c.']]);
    const words = changes[1].words!;
    expect(words.filter((w) => w.removed).map((w) => w.value.trim())).toEqual(['trenta']);
    expect(words.filter((w) => w.added).map((w) => w.value.trim())).toEqual(['sessanta']);
  });

  it('names a changed norm with its article too', () => {
    const [change] = compareSnapshots([norm('a', '1218')], [norm('a', '1218', { versione: '2020-01-01' })]);
    expect(change).toMatchObject({ kind: 'cambiata', label: 'art. 1218 c.c.', words: undefined });
  });

  it('tells a note that came or went by its text', () => {
    const changes = compareSnapshots([note('m', 'Chiedere le delibere.')], [note('p', 'Sentire l’amministratore.')]);
    expect(changes.map((c) => [c.kind, c.text])).toEqual([['entrata', 'Sentire l’amministratore.'], ['uscita', 'Chiedere le delibere.']]);
  });

  it('does not count a reorder or a star as a change', () => {
    const starred = { ...norm('a', '2043'), content: { ...CC, numero_articolo: '2043', _dossierMeta: { important: true } } };
    expect(compareSnapshots([norm('a', '2043'), norm('b', '2051')], [{ ...norm('b', '2051'), position: 1 }, starred])).toEqual([]);
  });
});

describe('the words of the differences', () => {
  it('says each kind in words', () => {
    expect(CHANGE_WORDS).toEqual({ entrata: 'Entrata', uscita: 'Uscita', cambiata: 'Cambiata' });
  });

  it('counts them in a line', () => {
    const changes = compareSnapshots([norm('1', '1'), norm('2', '2'), norm('4', '4')], [norm('3', '3'), norm('5', '5'), norm('4', '4-bis')]);
    expect(changesLine(changes)).toBe('2 entrate, 2 uscite, 1 cambiata');
    expect(changesLine([])).toBe('Nessuna differenza');
  });
});
