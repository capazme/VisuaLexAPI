import { describe, expect, it } from 'vitest';
import { CHANGE_WORDS, changesLine, compareSnapshots, type SnapshotItem } from './dossierVersionsDiff';

const item = (id: string, over: Partial<SnapshotItem> = {}): SnapshotItem => ({ id, itemType: 'norm', title: `art. ${id} c.c.`, content: { urn: id }, position: 0, ...over });

describe('compareSnapshots', () => {
  it('finds the entries that came, went and changed', () => {
    const from = [item('1'), item('2'), item('n', { itemType: 'note', title: 'Nota', content: 'Il termine è di trenta giorni.' })];
    const to = [item('1'), item('3'), item('n', { itemType: 'note', title: 'Nota', content: 'Il termine è di sessanta giorni.' })];
    const changes = compareSnapshots(from, to);
    expect(changes.map((c) => [c.kind, c.item.id])).toEqual([['entrata', '3'], ['cambiata', 'n'], ['uscita', '2']]);
    const words = changes[1].words!;
    expect(words.filter((w) => w.removed).map((w) => w.value.trim())).toEqual(['trenta']);
    expect(words.filter((w) => w.added).map((w) => w.value.trim())).toEqual(['sessanta']);
  });

  it('does not count a reorder as a change', () => {
    expect(compareSnapshots([item('1', { position: 0 }), item('2', { position: 1 })], [item('2', { position: 0 }), item('1', { position: 1 })])).toEqual([]);
  });

  it('marks a norm whose content changed, with no word diff', () => {
    const [change] = compareSnapshots([item('1')], [item('1', { content: { urn: '1', status: 'read' } })]);
    expect(change).toMatchObject({ kind: 'cambiata', words: undefined });
  });
});

describe('the words of the differences', () => {
  it('says each kind in words', () => {
    expect(CHANGE_WORDS).toEqual({ entrata: 'Entrata', uscita: 'Uscita', cambiata: 'Cambiata' });
  });

  it('counts them in a line', () => {
    const changes = compareSnapshots([item('1'), item('2'), item('4')], [item('3'), item('5'), item('4', { title: 'art. 4-bis c.c.' })]);
    expect(changesLine(changes)).toBe('2 entrate, 2 uscite, 1 cambiata');
    expect(changesLine([])).toBe('Nessuna differenza');
  });
});
