import type { DecisionText } from '../types/decisions';

/**
 * Whether the source gave any block of text. A decision found without its text comes with
 * `testo` `{}` and the notice `testo_non_disponibile`, and then no text block is drawn at all.
 * Any block counts: many Corte costituzionale ordinanze have no motivazione.
 */
export function hasDecisionText(testo: DecisionText): boolean {
  return Boolean(testo.epigrafe || testo.motivazione || testo.dispositivo);
}

/**
 * The lines of a received decision text, grouped into paragraphs at empty lines. Only `\n` is
 * dropped: every other character, spaces included, reaches a text node (design 2026-10-01 S6,
 * the same contract as gotcha 23 for articles).
 */
export function decisionParagraphs(text: string): string[][] {
  const paragraphs: string[][] = [];
  let current: string[] = [];
  for (const line of text.split('\n')) {
    if (line === '') {
      if (current.length > 0) paragraphs.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) paragraphs.push(current);
  return paragraphs;
}
