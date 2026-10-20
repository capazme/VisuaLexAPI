/**
 * The rubrics too generic to search the Cassazione by: «Cerca sentenze sul tema dell’articolo» searches
 * the rubric alone, and «Definizioni» or «Oggetto» alone finds the decisions of every act that has one.
 * The link is not offered for these. One list, compared as `rubricKey` reads them.
 */
export const GENERIC_RUBRICS: readonly string[] = [
  'Definizioni',
  'Oggetto',
  'Ambito di applicazione',
  'Entrata in vigore',
  'Abrogazioni',
  'Finalità',
  'Oggetto e ambito di applicazione',
  'Finalità e oggetto',
  'Definizioni e ambito di applicazione',
  'Abrogazione',
];

/** A rubric as the list compares it: no accents, lower case, spaces collapsed and trimmed, no final period. */
export function rubricKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '')
    .trim();
}

const GENERIC_KEYS = new Set(GENERIC_RUBRICS.map(rubricKey));

/** Whether a rubric is one of `GENERIC_RUBRICS`, whatever its case, accents, spaces or final period. */
export function isGenericRubric(text: string): boolean {
  return GENERIC_KEYS.has(rubricKey(text));
}
