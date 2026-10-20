import { describe, expect, it } from 'vitest';
import { GENERIC_RUBRICS, isGenericRubric, rubricKey } from './genericRubrics';

describe('GENERIC_RUBRICS', () => {
  it('is the list the owners chose, each one recognised as written', () => {
    expect(GENERIC_RUBRICS).toEqual([
      'Definizioni', 'Oggetto', 'Ambito di applicazione', 'Entrata in vigore', 'Abrogazioni', 'Finalità',
    ]);
    for (const rubric of GENERIC_RUBRICS) expect(isGenericRubric(rubric), rubric).toBe(true);
  });

  it.each([
    'DEFINIZIONI', 'definizioni', '  Oggetto  ', 'Oggetto.', ' Entrata in vigore. ', 'Ambito  di\napplicazione',
    'Finalita', 'FINALITÀ', 'finalità.', 'Abrogazioni .',
  ])('ignores case, accents, spaces and a final period: «%s»', (rubric) => {
    expect(isGenericRubric(rubric)).toBe(true);
  });

  it.each([
    'Risarcimento per fatto illecito', 'Definizioni e ambito di applicazione', 'Oggetto del contratto',
    'Entrata in vigore della legge', 'Finalità e principi', 'Oggetto..', '', '   ',
  ])('leaves any other rubric alone: «%s»', (rubric) => {
    expect(isGenericRubric(rubric)).toBe(false);
  });

  it('reads a rubric to its key without accents, case or final period', () => {
    expect(rubricKey('  Finalità.  ')).toBe('finalita');
  });
});
