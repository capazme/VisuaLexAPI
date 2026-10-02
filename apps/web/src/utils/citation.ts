import type { ArticleValidity, NormaVisitata } from '../types';
import { abbreviateActType, formatDateForCitation } from './dateUtils';

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

// The codes and the Constitution are cited by their abbreviation, with no number
// and no date; any other act by its type, date and number. Keys are lower case:
// the palette spells `Codice Civile`, the resolver `codice civile` (gotcha 28).
const ACT_ABBREVIATIONS: Record<string, string> = {
  'codice civile': 'c.c.',
  'codice penale': 'c.p.',
  'codice di procedura civile': 'c.p.c.',
  'codice di procedura penale': 'c.p.p.',
  'costituzione': 'Cost.',
  // Part of R.D. 262/1942 and cited by their own name: "art. 12 preleggi" is not
  // "art. 12, r.d. 16 marzo 1942, n. 262", which would name an article of the decree.
  'preleggi': 'preleggi',
  "disposizioni per l'attuazione del codice civile e disposizioni transitorie": 'disp. att. c.c.',
  "disposizioni per l'attuazione del codice di procedura civile e disposizioni transitorie": 'disp. att. c.p.c.',
};

function actDesignation(norma: CitedNorma): { text: string; isCode: boolean } {
  const abbreviation = ACT_ABBREVIATIONS[(norma.tipo_atto || '').trim().toLowerCase()];
  if (abbreviation) return { text: abbreviation, isCode: true };
  // An aliased act ("codice in materia di protezione dei dati personali") is
  // cited by the act it is: "d.lgs. 30 giugno 2003, n. 196".
  const type = abbreviateActType(norma.tipo_atto_reale || norma.tipo_atto).toLowerCase();
  const date = norma.data ? ` ${formatDateForCitation(norma.data)}` : '';
  const number = norma.numero_atto ? `, n. ${norma.numero_atto}` : '';
  return { text: `${type}${date}${number}`, isCode: false };
}

function articleHead(norma: CitedNorma): string {
  const act = actDesignation(norma);
  // A code's default annex is how Normattiva files its text, not part of how it is cited.
  const annex = !act.isCode && norma.allegato ? ` (Allegato ${norma.allegato})` : '';
  return act.isCode
    ? `art. ${norma.numero_articolo} ${act.text}`
    : `art. ${norma.numero_articolo}, ${act.text}${annex}`;
}

/**
 * The citation of a past text, or null when there is nothing honest to cite:
 * the text in force (the plain citation stays as it is), an article that did
 * not exist on the day, or a version whose window does not contain the day.
 */
export function formatNormCitation(context: CitationContext): NormCitation | null {
  const { norma, validity, requestedDate, original, consultedAt } = context;
  if (validity?.state === 'not_yet' || validity?.request_in_window === false) return null;
  if (!requestedDate && !original) return null;

  const head = articleHead(norma);
  const asked = requestedDate ? formatDateForCitation(requestedDate) : undefined;
  const short = `${head}, ${asked ? `nel testo in vigore al ${asked}` : 'nel testo originale'}`;

  const from = validity?.valid_from ? formatDateForCitation(validity.valid_from) : undefined;
  const to = validity?.valid_to ? formatDateForCitation(validity.valid_to) : undefined;
  const window = from || to ? `in vigore${from ? ` dal ${from}` : ''}${to ? ` al ${to}` : ''}` : undefined;
  const clause = original
    ? `nel testo originale${window ? `, ${window}` : ''}`
    : window
      ? `nel testo ${window}`
      : `nel testo in vigore al ${asked}`;
  const source = `Normattiva, testo consolidato${consultedAt ? `, consultato il ${formatDateForCitation(consultedAt)}` : ''}`;

  return { short, long: `${head}, ${clause} (${source})` };
}

/**
 * The text a copy action puts on the clipboard. A past text starts with its
 * citation, so the quotation cannot travel without the version it quotes; the
 * text in force keeps the trailer it always had.
 */
export function withCitation(text: string, citation: NormCitation | null, trailer: string): string {
  return citation ? `${citation.long}\n\n${text}` : `${text}${trailer}`;
}
