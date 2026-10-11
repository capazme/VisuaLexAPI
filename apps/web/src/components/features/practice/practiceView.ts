import type { Practice } from '../../../utils/practice';

/** The words of «Chiudi la pratica»'s confirmation (spec §3.1): the scope and what is not touched. */
export const CLOSE_PRACTICE_MESSAGE =
  'Gli atti e le sentenze della pratica verranno tolti dal tavolo. Dossier, note ed evidenziazioni non saranno toccati.';

/** Whether a practice holds nothing to draw: no act, no decision, no topic search. */
export function isEmptyPractice(practice: Practice): boolean {
  return practice.acts.length === 0 && practice.decisions.length === 0 &&
    !practice.beside.some((b) => b.kind === 'decision-search');
}
