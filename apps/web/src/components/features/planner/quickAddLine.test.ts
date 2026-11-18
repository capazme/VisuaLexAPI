import { describe, expect, it } from 'vitest';
import { RECURRENCE_RULES } from '../../../types/tasks';
import { readQuickAddLine, suggestDossiers } from './quickAddLine';

const TODAY = '2026-11-17';
const DOSSIERS = [
  { id: 'd1', title: 'Rossi c. Bianchi' },
  { id: 'd2', title: 'Verdi' },
  { id: 'd3', title: 'Verdi appello' },
  { id: 'd4', title: 'Società Àlfa' },
];
const read = (text: string, options: Partial<Parameters<typeof readQuickAddLine>[2]> = {}) =>
  readQuickAddLine(text, TODAY, { dossiers: DOSSIERS, ...options });
const kinds = (text: string) => read(text).parts.map((p) => p.kind);

describe('readQuickAddLine', () => {
  it('reads every symbol together and keeps the rest as the title', () => {
    const line = read('Deposito memoria venerdì alle 10 #Rossi @udienza p1 {20/11}');
    expect(line.title).toBe('Deposito memoria');
    expect(line.parts.map(({ kind, raw }) => [kind, raw])).toEqual([
      ['date', 'venerdì alle 10'],
      ['dossier', '#Rossi'],
      ['label', '@udienza'],
      ['priority', 'p1'],
      ['due', '{20/11}'],
    ]);
    expect(line.parts.find((p) => p.kind === 'dossier')).toMatchObject({ id: 'd1' });
    expect(line.parts.find((p) => p.kind === 'due')).toMatchObject({ value: { date: '2026-11-20', time: null } });
  });

  it('reads a repetition into one of the five rules', () => {
    const line = read('Controllo PEC ogni giorno lavorativo alle 9');
    expect(line.title).toBe('Controllo PEC');
    expect(line.parts[0]).toMatchObject({ kind: 'date', value: { recurrence: RECURRENCE_RULES.workingDays, time: '09:00', date: TODAY } });
  });

  it('keeps a dossier that does not exist as text, and offers to choose one', () => {
    const line = read('Chiamare #Neri domani');
    expect(line.title).toBe('Chiamare #Neri');
    expect(line.parts.map((p) => p.kind)).toEqual(['date']);
    expect(line.dossierQuery).toBeNull(); // the caret is past «domani»: the dossier is not being typed
    expect(read('Chiamare #Ne', { caret: 12 }).dossierQuery).toEqual({ start: 9, end: 12, query: 'Ne' });
  });

  it('keeps a word that begins two dossiers as text, and takes the longest whole title', () => {
    expect(read('Atto #Verdi').parts[0]).toMatchObject({ kind: 'dossier', id: 'd2' });
    expect(read('Atto #Verdi appello domani').parts.map((p) => [p.kind, p.raw])).toEqual([['dossier', '#Verdi appello'], ['date', 'domani']]);
    expect(read('Atto #Ver').parts).toEqual([]);
    // Without case and accents.
    expect(read('Atto #società alfa').parts[0]).toMatchObject({ id: 'd4', raw: '#società alfa' });
  });

  it('reads no dossier in the dossier panel', () => {
    const line = read('Atto #Rossi', { dossierLocked: true });
    expect(line.parts).toEqual([]);
    expect(line.title).toBe('Atto #Rossi');
    expect(line.dossierQuery).toBeNull();
    // Not in silence: the field says the task stays in this dossier (LC83).
    expect(line.lockedHash).toBe(true);
    expect(read('Atto mario#rossi', { dossierLocked: true }).lockedHash).toBe(false);
    expect(read('Atto #Rossi').lockedHash).toBe(false);
  });

  it('takes a new label as typed', () => {
    const line = read('Studio @nuova-etichetta, poi bozza');
    expect(line.parts[0]).toMatchObject({ kind: 'label', label: 'nuova-etichetta' });
    expect(line.title).toBe('Studio, poi bozza');
  });

  it('reads symbols only at the start of a word', () => {
    expect(kinds('Scrivere a mario@studio.it')).toEqual([]);
    expect(kinds('Modulo p10 e mp1')).toEqual([]);
    expect(kinds('Issue#4')).toEqual([]);
  });

  it('keeps a braced phrase that is not a date, or repeats, as text', () => {
    expect(read('Atto {da vedere}').title).toBe('Atto {da vedere}');
    expect(read('Atto {ogni giorno}').parts).toEqual([]);
    expect(read('Atto {domani alle 12}').parts[0]).toMatchObject({ kind: 'due', value: { date: '2026-11-18', time: '12:00' } });
  });

  it('turns a part clicked away back into text, and reads nothing else out of it', () => {
    const first = read('Riunione domani alle 10 p2');
    const date = first.parts.find((p) => p.kind === 'date')!;
    const again = read('Riunione domani alle 10 p2', { dismissed: new Set([date.key]) });
    expect(again.parts.map((p) => p.kind)).toEqual(['priority']);
    expect(again.title).toBe('Riunione domani alle 10');
    const label = read('Atto @udienza').parts[0];
    expect(read('Atto @udienza', { dismissed: new Set([label.key]) }).title).toBe('Atto @udienza');
  });

  it('leaves an empty title when the line is only symbols', () => {
    expect(read('domani p1').title).toBe('');
  });
});

describe('suggestDossiers', () => {
  it('lists those that begin with the words first, then those that contain them', () => {
    expect(suggestDossiers('ver', DOSSIERS).map((d) => d.id)).toEqual(['d2', 'd3']);
    expect(suggestDossiers('bianchi', DOSSIERS).map((d) => d.id)).toEqual(['d1']);
    expect(suggestDossiers('', DOSSIERS, 2)).toHaveLength(2);
  });
});
