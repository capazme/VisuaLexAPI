import { describe, expect, it } from 'vitest';
import { GENERIC_RUBRICS, isGenericRubric, rubricKey } from './genericRubrics';

describe('GENERIC_RUBRICS', () => {
  it('is the list the owners chose, each one recognised as written', () => {
    expect(GENERIC_RUBRICS).toEqual([
      'Definizioni', 'Oggetto', 'Ambito di applicazione', 'Entrata in vigore', 'Abrogazioni', 'Finalità',
      'Oggetto e ambito di applicazione', 'Finalità e oggetto', 'Definizioni e ambito di applicazione', 'Abrogazione',
    ]);
    for (const rubric of GENERIC_RUBRICS) expect(isGenericRubric(rubric), rubric).toBe(true);
  });

  it.each([
    'DEFINIZIONI', 'definizioni', '  Oggetto  ', 'Oggetto.', ' Entrata in vigore. ', 'Ambito  di\napplicazione',
    'Finalita', 'FINALITÀ', 'finalità.', 'Abrogazioni .', 'OGGETTO E AMBITO DI APPLICAZIONE.', 'Finalita e oggetto',
    '  definizioni e ambito  di applicazione ', 'Abrogazione.',
  ])('ignores case, accents, spaces and a final period: «%s»', (rubric) => {
    expect(isGenericRubric(rubric)).toBe(true);
  });

  it.each([
    'Risarcimento per fatto illecito', 'Oggetto del contratto', 'Entrata in vigore della legge', 'Finalità e principi',
    'Oggetto e finalità', 'Ambito di applicazione e definizioni', 'Abrogazione di norme', 'Oggetto..', '', '   ',
  ])('leaves any other rubric alone: «%s»', (rubric) => {
    expect(isGenericRubric(rubric)).toBe(false);
  });

  it('reads a rubric to its key without accents, case or final period', () => {
    expect(rubricKey('  Finalità.  ')).toBe('finalita');
  });
});
