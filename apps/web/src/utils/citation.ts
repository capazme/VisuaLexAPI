import type { ArticleValidity, NormaVisitata } from '../types';
import { formatDateForCitation, withPreposition } from './dateUtils';
import { citeNorm, inForceCitation } from './sources';
import { isEuropeanAct, requestIsHistorical, type VersionRequest } from './versionDisplay';

/**
 * How a lawyer cites a norm "in the text in force at …".
 *
 * One pure function builds the wording, so the toolbar, the banner, the
 * dossier and the copy actions cannot drift apart. The golden file
 * (`__fixtures__/citationGolden.ts`) is the specification: the wording is a
 * legal call, and the owner reads those lines, not this code. The style is the
 * owner's: "art. 2, l. 7 agosto 1990, n. 241" for an act cited by type, date
 * and number; "art. 1284 c.c." for a code and the Constitution, with no comma.
 *
 * It states which TEXT was in force, never which discipline governs a fact:
 * the window of days says the first and cannot say the second.
 */

export interface NormCitation {
  /** "art. 1284 c.c., nel testo in vigore al 29 dicembre 2007" */
  short: string;
  /** The short form with the window and the source: for the top of a copied text. */
  long: string;
}

type CitedNorma = Pick<NormaVisitata, 'tipo_atto' | 'numero_articolo'>
  & Partial<Pick<NormaVisitata, 'tipo_atto_reale' | 'numero_atto' | 'data' | 'allegato'>>;

export interface CitationContext {
  norma: CitedNorma;
  /** What the source's page stated; absent when it could not be read. */
  validity?: ArticleValidity;
  /** The ISO day the reader asked for. */
  requestedDate?: string;
  /** The original text was asked for (no day). */
  original?: boolean;
  /** The ISO day of the consultation (today, in Rome). */
  consultedAt?: string;
}

// The head is the source convention's citation (utils/sources): «art. 2, l. 7 agosto 1990,
// n. 241», «art. 1284 c.c.». This file adds the version clause.
function articleHead(norma: CitedNorma): string {
  return citeNorm(norma);
}

/**
 * The citation of a past text, or null when there is nothing honest to cite:
 * the text in force (the plain citation stays as it is), an article that did
 * not exist on the day, a version whose window does not contain the day, an act
 * of the Union (the server ignores the day and the source is not Normattiva), a
 * repealed article with no repeal day stated.
 */
export function formatNormCitation(context: CitationContext): NormCitation | null {
  const { norma, validity, requestedDate, original, consultedAt } = context;
  if (validity?.state === 'not_yet' || validity?.request_in_window === false) return null;
  if (isEuropeanAct(norma.tipo_atto)) return null;

  const head = articleHead(norma);
  const source = `Normattiva, testo consolidato${consultedAt ? `, consultato ${withPreposition('il', formatDateForCitation(consultedAt))}` : ''}`;
  const from = validity?.valid_from ? formatDateForCitation(validity.valid_from) : undefined;
  const to = validity?.valid_to ? formatDateForCitation(validity.valid_to) : undefined;
  const repealed = validity?.state === 'abrogated';
  // For a repealed article `valid_from` is the day of the REPEAL, not the day the text came into force.
  const window = !repealed && (from || to) ? `in vigore${from ? ` ${withPreposition('dal', from)}` : ''}${to ? ` ${withPreposition('al', to)}` : ''}` : undefined;

  if (!requestedDate && !original) {
    // Reached with no day: a past version still goes out with its window.
    if (validity?.state !== 'historical' || !window) return null;
    const short = `${head}, nel testo ${window}`;
    return { short, long: `${short} (${source})` };
  }

  if (repealed && requestedDate) {
    if (!from) return null;
    const short = `${head}, abrogato ${withPreposition('dal', from)}`;
    return { short, long: `${short} (${source})` };
  }

  const asked = requestedDate ? formatDateForCitation(requestedDate) : undefined;
  const inForceAt = asked ? `nel testo in vigore ${withPreposition('al', asked)}` : 'nel testo originale';
  const short = `${head}, ${inForceAt}`;

  const clause = original
    ? `nel testo originale${window ? `, ${window}` : ''}`
    : window
      ? `nel testo ${window}`
      : inForceAt;

  return { short, long: `${head}, ${clause} (${source})` };
}

/**
 * The text a copy action puts on the clipboard: it starts with its citation, so a
 * quotation never travels without what it quotes. A past text by its version
 * (`citation`), the text in force by `inForce` (`inForceCitation` of utils/sources: D8,
 * owner, 4 October 2026).
 */
export function withCitation(text: string, citation: NormCitation | null, inForce: string): string {
  return [citation ? citation.long : inForce, text].filter(Boolean).join('\n\n');
}

/**
 * The citation a copy starts with when `formatNormCitation` cites no version: the text in
 * force's (`inForceCitation`, D8); for a past text that has none (a repealed article with no
 * repeal day stated) the bare citation, never «testo vigente» on a text that is not. An act of
 * the Union is always its text in force: the server ignores the day.
 */
export function unversionedCitation(norma: CitedNorma & VersionRequest, consultedAt: string): string {
  return requestIsHistorical(norma) && !isEuropeanAct(norma.tipo_atto) ? citeNorm(norma) : inForceCitation(norma, consultedAt);
}
