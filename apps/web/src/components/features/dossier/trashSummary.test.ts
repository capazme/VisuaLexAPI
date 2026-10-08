import { describe, expect, it } from 'vitest';
import { trashCardsSummary, trashItemsSummary, trashWhen } from './trashSummary';

const L247 = 'l. 31 dicembre 2012, n. 247';
const norm = (n: string, act = L247, joiner = ', ') => ({ itemType: 'norm', citation: `art. ${n}${joiner}${act}`, actCitation: act });

describe('trashItemsSummary', () => {
  it('groups the articles by act, then counts notes and decisions', () => {
    expect(trashItemsSummary([
      norm('3'), norm('25'), norm('2043', 'c.c.', ' '),
      { itemType: 'note', citation: null, actCitation: null },
      { itemType: 'sentenza', citation: null, actCitation: null },
    ])).toBe(`${L247}: artt. 3, 25 · c.c.: art. 2043 · 1 nota · 1 sentenza`);
  });
  it('names a decision by the server\'s citation, after the acts', () => {
    expect(trashItemsSummary([
      { itemType: 'sentenza', citation: 'Cass. civ., sez. un., sent. 6 dicembre 2024, n. 31310', actCitation: null },
      norm('2043', 'c.c.', ' '),
      { itemType: 'note', citation: null, actCitation: null },
    ])).toBe('c.c.: art. 2043 · Cass. civ., sez. un., sent. 6 dicembre 2024, n. 31310 · 1 nota');
  });
  it('keeps an annex with its article', () => {
    expect(trashItemsSummary([{ itemType: 'norm', citation: 'art. 1, d.lgs. 31 marzo 2023, n. 36 (Allegato I.1)', actCitation: 'd.lgs. 31 marzo 2023, n. 36' }]))
      .toBe('d.lgs. 31 marzo 2023, n. 36: art. 1 (Allegato I.1)');
  });
  it('counts what it cannot name, never drops it', () => {
    expect(trashItemsSummary([{ itemType: 'norm', citation: null, actCitation: null }, { itemType: 'note', citation: null, actCitation: null }, { itemType: 'note', citation: null, actCitation: null }]))
      .toBe('1 voce · 2 note');
  });
});

describe('trashCardsSummary', () => {
  const card = (d: string) => ({ istituto: 'Contratto', domanda: d });
  it('shows the first questions, then how many more', () => {
    expect(trashCardsSummary([card('Che cos’è?'), card('Quando?'), card('Chi?'), card('Come?')])).toBe('«Che cos’è?» · «Quando?» · «Chi?» e altre 1');
    expect(trashCardsSummary([card('Che cos’è?')])).toBe('«Che cos’è?»');
  });
});

describe('trashWhen', () => {
  it('says who removed it, when, and until when it stays', () => {
    expect(trashWhen({ clientName: 'Claude Code', byApplication: true, deletedAt: '2026-10-04T10:00:00Z', expiresAt: '2026-11-03T10:00:00Z' }))
      .toBe('Rimosso da Claude Code il 4 ottobre 2026 · resta nel cestino fino al 3 novembre 2026');
    expect(trashWhen({ clientName: null, byApplication: true, deletedAt: '2026-10-01T10:00:00Z', expiresAt: '2026-10-31T10:00:00Z' }))
      .toBe("Rimosso da un'applicazione collegata il 1° ottobre 2026 · resta nel cestino fino al 31 ottobre 2026");
    expect(trashWhen({ clientName: null, byApplication: false, deletedAt: '2026-10-01T10:00:00Z', expiresAt: '2026-10-31T10:00:00Z' }))
      .toBe('Rimosso da te il 1° ottobre 2026 · resta nel cestino fino al 31 ottobre 2026');
  });
});
