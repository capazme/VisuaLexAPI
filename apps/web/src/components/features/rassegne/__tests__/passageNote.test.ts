import { describe, expect, it } from 'vitest';
import { MAX_NOTE_LENGTH, passageNote } from '../passageNote';
import type { RassegnePasso } from '../types';

/** An invented passage: no text of the reviews enters the repository. */
function passo(testo: string): RassegnePasso {
  return {
    id: 'a', anno: 2024, archivio: 'civile',
    volume: { id: 1, numero: 1, titolo: 'Massimario 2024 CIVILE Vol. 1' },
    parte: null,
    capitolo: { nome: 'CAPITOLO I', titolo: 'LA RESPONSABILITÀ' },
    sezione: { id: 1, numero: '2', titolo: 'Il danno.' },
    autori: [], url: 'https://example.invalid/rassegne/a', testo,
    evidenziazioni: [], pronunce: [], fonte: 'Ufficio del Massimario',
  };
}

describe('passageNote', () => {
  it('writes where the passage sits, its text and the portal link, as plain text', () => {
    expect(passageNote(passo('Il danno è risarcibile.'))).toBe(
      'Rassegna civile 2024 · vol. 1 › CAPITOLO I › § 2 Il danno.\n'
      + 'Fonte: Ufficio del Massimario della Corte di cassazione\n\n'
      + 'Il danno è risarcibile.\n\n'
      + 'https://example.invalid/rassegne/a',
    );
  });

  it('cuts a long passage with «…» at the note limit and keeps the link whole', () => {
    const note = passageNote(passo('parola '.repeat(1000)));
    expect(note.length).toBeLessThanOrEqual(MAX_NOTE_LENGTH);
    expect(note.length).toBeGreaterThan(MAX_NOTE_LENGTH - 10);
    expect(note.endsWith('…\n\nhttps://example.invalid/rassegne/a')).toBe(true);
  });

  it('never leaves half of a character made of two units at the cut', () => {
    const note = passageNote(passo('😀'.repeat(3000)));
    expect(note.length).toBeLessThanOrEqual(MAX_NOTE_LENGTH);
    expect(note).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('drops the control characters the server refuses, keeping new lines', () => {
    expect(passageNote(passo('uno\u000Cdue\ntre'))).toContain('uno due\ntre');
  });
});
