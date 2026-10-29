import { describe, expect, it } from 'vitest';
import { closingOpensExam, competenceNumbers, competencesLine, completeSentence, fromDay, longDay, missingLines, nextStepLabel, onDay, shortDay, thePercent } from './corsiLabels';
import { listed, missingOf } from './__fixtures__/corsi';

describe('«Percorsi»\'s words', () => {
  it('writes a competence\'s numbers in every state (§4)', () => {
    const base = { codice: 'C3', ordine: 3, testo: 'x' };
    const sessions = (contate: number) => ({ contate, servono: 2 });
    const last = (percentuale: number) => ({ giorno: '2026-10-27', percentuale });
    expect(competenceNumbers({ ...base, stato: 'da-iniziare', sessioni: sessions(0), prossimaDal: null, ultima: null })).toBe('Ancora nessuna sessione valida');
    expect(competenceNumbers({ ...base, stato: 'in-corso', sessioni: sessions(1), prossimaDal: '2026-11-03', ultima: last(85) })).toBe('1 di 2 sessioni · la prossima vale dal 3/11 · ultima 85%');
    expect(competenceNumbers({ ...base, stato: 'in-corso', sessioni: sessions(1), prossimaDal: '2026-11-11', ultima: last(80) })).toBe('1 di 2 sessioni · la prossima vale dall’11/11 · ultima 80%');
    expect(competenceNumbers({ ...base, stato: 'acquisita', sessioni: sessions(2), prossimaDal: '2026-11-10', ultima: last(80) })).toBe('2 di 2 sessioni · ultima 80%');
    expect(competenceNumbers({ ...base, stato: 'da-riprendere', sessioni: sessions(0), prossimaDal: '2026-11-20', ultima: last(40) })).toBe('0 di 2 sessioni per riprenderla · la prossima vale dal 20/11 · ultima 40%');
  });

  it('says what a course in preparation lacks, one line each', () => {
    expect(missingLines(missingOf({ moduli: { contati: 9, previsti: 10 }, manca: { esame: true }, competenzeSenzaModulo: ['C2'], schede: [{ codice: 'C4', schede: 1, servono: 5 }] })))
      .toEqual(['9 di 10 moduli', 'manca l’esame finale', 'C2 senza un modulo', 'C4 ha 1 scheda su 5']);
    expect(missingLines(missingOf({ moduli: { contati: 10, previsti: 10 } }))).toEqual([]);
    expect(completeSentence('IP', missingOf({ moduli: { contati: 10, previsti: 10 } }))).toBe('Completa il percorso «IP» in VisuaLex.');
  });

  it('says closing the programme opens the exam only when modules are all the course lacks', () => {
    expect(closingOpensExam(missingOf({ moduli: { contati: 9, previsti: 10 } }))).toBe(true);
    expect(closingOpensExam(missingOf({ manca: { esame: true } }))).toBe(false);
    expect(closingOpensExam(missingOf({ competenzeSenzaModulo: ['C3'] }))).toBe(false);
    expect(closingOpensExam(missingOf({ schede: [{ codice: 'C1', schede: 4, servono: 5 }] }))).toBe(false);
  });

  it('names the next step of a course in the list', () => {
    expect(nextStepLabel(listed())).toBe('Prossimo: modulo 4, Il marchio di fatto');
    expect(nextStepLabel(listed({ prossimo: { tipo: 'esame', id: 'e' } }))).toBe('Prossimo: l’esame finale');
    expect(nextStepLabel(listed({ stato: 'superato', prossimo: null }))).toBe('Percorso superato');
    expect(nextStepLabel(listed({ prossimo: null, moduli: { contati: 0, previsti: 5 } }))).toMatch(/^Nessun modulo ancora/);
    expect(nextStepLabel(listed({ prossimo: null }))).toBe('In attesa del tuo assistente');
    expect(competencesLine({ acquisite: 3, totale: 8 })).toBe('3 di 8 competenze');
  });

  it('elides the article before a number read with a vowel', () => {
    expect([1, 8, 11, 70, 85, 100].map(thePercent)).toEqual(['l’1%', 'l’8%', 'l’11%', 'il 70%', 'l’85%', 'il 100%']);
    expect(onDay('2026-11-01')).toBe('l’1 novembre 2026');
    expect(onDay('2026-11-03')).toBe('il 3 novembre 2026');
    expect(fromDay('2026-11-08')).toBe('dall’8 novembre 2026');
    expect(fromDay('2026-11-20')).toBe('dal 20 novembre 2026');
  });

  it('writes Rome days as the page does', () => {
    expect(shortDay('2026-11-03')).toBe('3/11');
    expect(longDay('2026-11-03')).toBe('3 novembre 2026');
    expect(shortDay('nonsense')).toBe('nonsense');
  });
});
