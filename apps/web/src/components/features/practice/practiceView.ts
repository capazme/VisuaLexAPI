import type { Practice } from '../../../utils/practice';

/** The words of «Chiudi la pratica»'s confirmation (spec §3.1): the scope and what is not touched. */
export const CLOSE_PRACTICE_MESSAGE =
  'Gli atti e le sentenze della pratica verranno tolti dal tavolo. Dossier, note ed evidenziazioni non saranno toccati.';

/** Whether a practice holds nothing to draw: no act, no decision, no topic search. */
export function isEmptyPractice(practice: Practice): boolean {
  return practice.acts.length === 0 && practice.decisions.length === 0 &&
    !practice.beside.some((b) => b.kind === 'decision-search');
}

/**
 * A practice's id and name as one string, and back: a `useShallow` selector of a list of practices
 * compares strings by value, so a component re-renders only when an id or a name changes. The
 * separator is a character no id or name holds.
 */
export function practicePair(practice: Pick<Practice, 'id' | 'label'>): string {
  return `${practice.id}\u0000${practice.label}`;
}

export function fromPracticePair(pair: string): { id: string; label: string } {
  const at = pair.indexOf('\u0000');
  return { id: pair.slice(0, at), label: pair.slice(at + 1) };
}
