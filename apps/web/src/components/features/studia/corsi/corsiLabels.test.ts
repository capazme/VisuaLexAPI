import { describe, expect, it } from 'vitest';
import { competenceNumbers, competencesLine, completeSentence, longDay, missingLines, nextStepLabel, shortDay } from './corsiLabels';
import { listed } from './__fixtures__/corsi';

describe('«Percorsi»\'s words', () => {
  it('writes a competence\'s numbers in every state (§4)', () => {
    const base = { codice: 'C3', testo: 'x' };
    expect(competenceNumbers({ ...base, stato: 'da-iniziare', sessioni: 0, prossimaDal: null, ultima: null })).toBe('Ancora nessuna sessione valida');
    expect(competenceNumbers({ ...base, stato: 'in-corso', sessioni: 1, prossimaDal: '2026-11-03', ultima: 85 })).toBe('1 di 2 sessioni · la prossima vale dal 3/11 · ultima 85%');
    expect(competenceNumbers({ ...base, stato: 'acquisita', sessioni: 2, prossimaDal: '2026-11-10', ultima: 80 })).toBe('2 di 2 sessioni · ultima 80%');
    expect(competenceNumbers({ ...base, stato: 'da-riprendere', sessioni: 0, prossimaDal: '2026-11-20', ultima: 40 })).toBe('0 di 2 sessioni per riprenderla · la prossima vale dal 20/11 · ultima 40%');
  });

  it('says what a course in preparation lacks, one line each', () => {
    expect(missingLines({ moduli: { contati: 9, previsti: 10 }, esame: true, schede: [{ codice: 'C4', schede: 1, minimo: 5 }] }))
      .toEqual(['9 di 10 moduli', 'manca l’esame finale', 'C4 ha 1 scheda su 5']);
    expect(missingLines({ moduli: { contati: 10, previsti: 10 }, esame: false, schede: [] })).toEqual([]);
    expect(completeSentence('IP', { moduli: { contati: 10, previsti: 10 }, esame: false, schede: [] })).toBe('Completa il percorso «IP» in VisuaLex.');
  });

  it('names the next step of a course in the list', () => {
    expect(nextStepLabel(listed())).toBe('Prossimo: modulo 4, Il marchio di fatto');
    expect(nextStepLabel(listed({ prossimo: { tipo: 'esame', id: 'e' } }))).toBe('Prossimo: l’esame finale');
    expect(nextStepLabel(listed({ stato: 'superato', prossimo: null }))).toBe('Percorso superato');
    expect(nextStepLabel(listed({ prossimo: null, moduli: { contati: 0, previsti: 5 } }))).toMatch(/^Nessun modulo ancora/);
    expect(nextStepLabel(listed({ prossimo: null }))).toBe('In attesa del tuo assistente');
    expect(competencesLine({ acquisite: 3, totale: 8 })).toBe('3 di 8 competenze');
  });

  it('writes Rome days as the page does', () => {
    expect(shortDay('2026-11-03')).toBe('3/11');
    expect(longDay('2026-11-03')).toBe('3 novembre 2026');
    expect(shortDay('nonsense')).toBe('nonsense');
  });
});
