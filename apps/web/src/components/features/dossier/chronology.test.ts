import { describe, expect, it } from 'vitest';
import type { DossierItem } from '../../../types';
import { buildChronology, isoDay, noteDate } from './chronology';

const note = (id: string, data: string): DossierItem => ({ id, type: 'note', addedAt: '2026-11-19T10:00:00Z', data });
const decision = (id: string, extra: Record<string, unknown>): DossierItem => ({
  id, type: 'sentenza', addedAt: '2026-11-19T10:00:00Z',
  data: { corte: 'cassazione', archivio: 'civile', numero: 1, anno: 2024, etichetta: `Sentenza ${id}`, ...extra } as never,
});

describe('noteDate', () => {
  it.each([
    ['12/03/2025 — Diffida', '2025-03-12', 'Diffida'],
    ['12.03.2025: Diffida', '2025-03-12', 'Diffida'],
    ['12-03-2025, Diffida', '2025-03-12', 'Diffida'],
    ['2025-03-12 - Diffida', '2025-03-12', 'Diffida'],
    ['1/3/2025 Diffida', '2025-03-01', 'Diffida'],
    ['  **12/03/2025** — Diffida', '2025-03-12', 'Diffida'],
    ['# 12/03/2025\nDiffida', '2025-03-12', 'Diffida'], // a date as a heading, the words under it
    ['12/03/2025 — prima riga\nseconda', '2025-03-12', 'prima riga'],
  ])('reads %j', (text, date, rest) => {
    expect(noteDate(text)).toEqual({ date, text: rest });
  });

  it('reads day first: 03/04 is the 3rd of April, never 4 March', () => {
    expect(noteDate('03/04/2025 x')?.date).toBe('2025-04-03');
  });

  it.each([
    'Il 12/03/2025 è arrivata la diffida', // not at the start
    '31/02/2025 x',
    '29/02/2025 x', // 2025 is no leap year
    '13/25/2025 x', // no swapping of day and month
    '12/03/25 x', // a year of two digits
    '12/03-2025 x', // two separators
    '12/03/20251 x',
    '2025-13-01 x',
    '',
  ])('refuses %j', (text) => {
    expect(noteDate(text)).toBeNull();
  });

  it('takes 29 February in a leap year', () => {
    expect(isoDay(2024, 2, 29)).toBe('2024-02-29');
    expect(isoDay(2023, 2, 29)).toBeNull();
  });
});

describe('buildChronology', () => {
  const items: DossierItem[] = [
    note('late', '05/01/2025 — Udienza'),
    note('none', 'Verificare la decorrenza'),
    decision('cass', { data_deposito: '2024-07-10' }),
    decision('eu', { corte: 'corte_giustizia_ue', archivio: undefined, data_decisione: '2023-02-01' }),
    decision('nodate', {}),
    decision('bad', { data_deposito: '10/07/2024' }),
    note('early', '2024-07-10 Atto di citazione'),
    { id: 'norm', type: 'norma', addedAt: '', data: { tipo_atto: 'legge', numero_articolo: '1' } } as DossierItem,
  ];

  it('orders by date, oldest first, same day in the dossier\'s order, grouped by year', () => {
    const { years } = buildChronology(items);
    expect(years.map((y) => [y.year, y.entries.map((e) => e.id)])).toEqual([
      ['2023', ['eu']],
      ['2024', ['cass', 'early']],
      ['2025', ['late']],
    ]);
    expect(years[1].entries.map((e) => e.source)).toEqual(['sentenza', 'nota']);
  });

  it('turns to newest first', () => {
    expect(buildChronology(items, true).years.map((y) => y.year)).toEqual(['2025', '2024', '2023']);
  });

  it('counts only the notes without a date: decisions and norms cannot be given one there', () => {
    expect(buildChronology(items).undatedNotes).toBe(1);
  });

  it('keeps a note about an article pointing at it', () => {
    const [entry] = buildChronology([{ ...note('a', '01/01/2020 x'), aboutItemId: 'art' } as DossierItem]).years[0].entries;
    expect(entry.aboutItemId).toBe('art');
  });
});
