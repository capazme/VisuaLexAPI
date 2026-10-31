import { rowYear, type YearsOf } from '../../../components/features/search/caseLaw/caseLawYears';
import { formatDecisionShort } from '../../../utils/decisionLinks';
import type { RassegnePasso } from './types';

/** Where a passage comes from: «Rassegna civile 2024 · vol. 1 › CAPITOLO I › § 2 Il danno.». */
export function provenance(p: RassegnePasso): string {
  const head = p.archivio === 'civile' || p.archivio === 'penale' ? `Rassegna ${p.archivio} ${p.anno}` : `Rassegna ${p.anno}`;
  return [
    head + (p.volume.numero ? ` · vol. ${p.volume.numero}` : ''),
    p.capitolo?.nome,
    `§ ${p.sezione.numero} ${p.sezione.titolo}`.trim(),
  ].filter(Boolean).join(' › ');
}

/**
 * The years a passage answers to for the section's year control: those of the decisions it cites
 * (the review's own year is its provenance, not a decision's). A passage citing none with a year
 * has none, and is kept only while no range is set.
 */
export const yearsOfPassage: YearsOf<RassegnePasso> = (passo) =>
  passo.pronunce.flatMap((pronuncia) => rowYear({ year: pronuncia.anno }));

/** What the section's text filter reads of a passage: its text, its provenance and the decisions it cites, as shown. */
export const textOfPassage = (passo: RassegnePasso): string =>
  [passo.testo, provenance(passo), ...passo.autori, ...passo.pronunce.map((p) => formatDecisionShort(p, p.rv))].join(' ');

/**
 * The limits of a keyword search in the reviews, the API's own (`store.py`: `MAX_QUERY_CHARS`,
 * `MAX_TERMS`, `MIN_TERM_CHARS`): a query over them is not sent.
 */
export const MAX_QUERY_CHARS = 200;
export const MAX_WORDS = 8;
const MIN_WORD_CHARS = 2;

export type SearchWords =
  | { kind: 'none' }
  | { kind: 'words'; q: string }
  /** too long, or too many words: the store is not asked, and the panel says why */
  | { kind: 'too_many' };

/**
 * The words the store searches for in the section's text filter, read as the API reads them
 * (`store.terms`): letters and digits, anything else a separator, words of one character dropped,
 * each once. Each word matches the start of a word, accents and case folded, anywhere in a
 * passage's text or where it sits (volume, chapter, section, authors).
 */
export function searchWords(text: string): SearchWords {
  if (text.length > MAX_QUERY_CHARS) return { kind: 'too_many' };
  const words = [...new Set((text.match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= MIN_WORD_CHARS))];
  if (words.length === 0) return { kind: 'none' };
  if (words.length > MAX_WORDS) return { kind: 'too_many' };
  return { kind: 'words', q: words.join(' ') };
}
