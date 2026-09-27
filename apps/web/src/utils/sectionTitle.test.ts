import { describe, it, expect } from 'vitest';
import { cleanSectionTitle } from './sectionTitle';

describe('cleanSectionTitle', () => {
  it('strips the amendment markers Normattiva wraps headings in', () => {
    expect(cleanSectionTitle('((§ 3 DEL SISTEMA CON CONSIGLIO DI SORVEGLIANZA))'))
      .toBe('§ 3 DEL SISTEMA CON CONSIGLIO DI SORVEGLIANZA');
  });

  it('drops a stray guillemet', () => {
    expect(cleanSectionTitle('((§ 4 DEL COMITATO PER IL CONTROLLO SULLA GESTIONE»))'))
      .toBe('§ 4 DEL COMITATO PER IL CONTROLLO SULLA GESTIONE');
  });

  it('falls back to a neutral label when nothing readable is left', () => {
    // The codice civile really does carry a "((...))" heading.
    expect(cleanSectionTitle('((...))')).toBe('Articoli');
  });

  it('leaves an ordinary heading alone', () => {
    expect(cleanSectionTitle('LIBRO PRIMO DELLE PERSONE E DELLA FAMIGLIA'))
      .toBe('LIBRO PRIMO DELLE PERSONE E DELLA FAMIGLIA');
  });
});
