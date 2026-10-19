import { describe, expect, it } from 'vitest';
import { studyImportSentence } from './studyImportReport';

const empty = { dossiers: [], notes: { added: 0, skipped: 0 }, highlights: { added: 0, skipped: 0 }, quickNorms: { added: 0, skipped: 0 }, aliases: { added: 0, skipped: 0 }, refused: 0 };

describe('studyImportSentence', () => {
  it('says what was added, what was already there and what could not be read', () => {
    expect(studyImportSentence({
      ...empty,
      dossiers: [{ id: 'a', name: 'A', entries: 3 }, { id: 'b', name: 'B', entries: 1 }],
      notes: { added: 1, skipped: 2 }, highlights: { added: 3, skipped: 0 }, refused: 1,
    })).toBe('Aggiunti: 2 dossier di studio, 1 nota, 3 evidenziazioni. Già tuoi o senza posizione nel testo, quindi non aggiunti: 2. Non leggibili e lasciati fuori: 1.');
  });
  it('says so when nothing was added', () => {
    expect(studyImportSentence(empty)).toBe('Nessun dossier aggiunto.');
  });
});
