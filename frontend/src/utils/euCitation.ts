/**
 * EU act citations — the reading of "A/B" shared by the palette parser
 * (`citationParser.ts`) and the in-text matcher (`citationMatcher.ts`).
 *
 * The Official Journal numbers EU acts year-first since 2015 ("Regolamento
 * (UE) 2016/679", "Regolamento (UE) 2024/2847"); directives always did
 * ("Direttiva 95/46/CE", "Direttiva 2002/58/CE"); pre-2015 regulations are
 * number-first ("Regolamento (CE) n. 1/2003", "Regolamento (CEE) n. 2913/92");
 * and Italian practice writes any of them the Italian way round ("reg. ue
 * 679/2016"). The number/year rule that serves every national act read
 * "2024/2847" as act number 2024 of the year 2847, built the EUR-Lex URL the
 * wrong way round, and the answer was "articolo non trovato" for a regulation
 * that exists. The backend mirrors this logic in `nl_parser.py`.
 */

import { expandTwoDigitYear } from './dateUtils';

export type EuActKind = 'regolamento' | 'direttiva';

/** Act-type values the rest of the frontend uses (`constants/actTypes.ts`). */
export const EU_ACT_TYPES: Record<EuActKind, string> = {
  regolamento: 'Regolamento UE',
  direttiva: 'Direttiva UE',
};

/** "ue" / "ce" / "cee" / "euratom", with or without parentheses. */
const EU_MARKER_SOURCE = '\\(?\\s*(?:cee|ce|ue|euratom)\\s*\\)?';

/** "regolamento di esecuzione (UE) 2015/2447", "regolamento delegato (UE) 2015/2446". */
const EU_QUALIFIER_SOURCE = '(?:\\s+(?:di\\s+esecuzione|di\\s+attuazione|delegat[oa]))?';

/**
 * Head of an EU citation as one capture group: the act word, an optional
 * marker and an optional "n.". The marker is always optional here; a caller
 * that needs it for regulations (the in-text matcher: in an article body a
 * bare "regolamento n. 5/2020" is usually a national one) checks
 * `hasEuMarker` on the head, or the trailing marker of the pair, afterwards.
 */
export function buildEuHeadSource(): string {
  const marker = `(?:${EU_MARKER_SOURCE})?`;
  const reg = `(?:regolamento${EU_QUALIFIER_SOURCE}|reg\\.?)\\s*${marker}`;
  const dir = `(?:direttiva${EU_QUALIFIER_SOURCE}|dir\\.?)\\s*${marker}`;
  return `(${reg}|${dir})\\s*(?:n\\.?\\s*)?`;
}

/** Whether a head or a trailing marker names a Community/Union at all. */
export function hasEuMarker(text: string): boolean {
  return /\b(?:ue|cee?|euratom)\b/i.test(text);
}

/**
 * The pair as three capture groups: first half, second half, and the trailing
 * marker of the old directives ("2002/58/CE"). A third numeric group after the
 * pair means a day/month/year date, never an act: "direttiva 1/2/2016" is not
 * directive 1 of the year 2.
 */
export const EU_PAIR_SOURCE = '(\\d{1,4})\\s*/\\s*(\\d{1,4})(\\s*/\\s*(?:cee|ce|ue|euratom))?(?!\\s*/\\s*\\d)';

export function euKindOf(head: string): EuActKind {
  return head.trim().toLowerCase().startsWith('dir') ? 'direttiva' : 'regolamento';
}

/** "(CE)" and "(CEE)" name the pre-Lisbon Communities: such an act predates 2009. */
export function isOldEuMarker(head: string): boolean {
  return /\bcee?\b/i.test(head);
}

export interface EuPair {
  actNumber: string;
  year: string;
}

const YEAR_FLOOR = 1950;
const NEW_NUMBERING_FROM = 2015;

function isYearLike(half: string, ceiling: number): boolean {
  if (!/^\d{4}$/.test(half)) return false;
  const n = parseInt(half, 10);
  return n >= YEAR_FLOOR && n <= ceiling;
}

/** Only a two-digit or a four-digit half can be the year of an act. */
function canBeYear(half: string): boolean {
  return half.length === 2 || half.length === 4;
}

/**
 * Decide which half of "first/second" is the year, or null when neither can be.
 *
 * - a trailing marker on a directive ("2002/58/CE") is the old directive
 *   format: year first; on a regulation ("1049/2001/CE") it says nothing
 *   about the order, which the rules below decide;
 * - one half looks like a year and the other does not: that one is the year
 *   ("2024/2847", "679/2016", "1/2003");
 * - both look like years: year first from 2015 on, number first before
 *   ("Regolamento (CE) n. 2006/2004" is number 2006 of 2004) — and a "(CE)"
 *   or "(CEE)" act is always number first, because those Communities ended
 *   in 2009 ("Regolamento (CE) n. 2015/2006" is number 2015 of 2006);
 * - a two-digit year is in play otherwise: "2913/92" is number first, "95/46"
 *   is year first, and two two-digit halves follow the kind — directives were
 *   always year first, regulations number first.
 */
export function resolveEuPair(
  first: string,
  second: string,
  opts: { kind: EuActKind; trailingMarker: boolean; oldMarker?: boolean; currentYear?: number }
): EuPair | null {
  const ceiling = (opts.currentYear ?? new Date().getFullYear()) + 1;
  const firstIsYear = isYearLike(first, ceiling);
  const secondIsYear = isYearLike(second, ceiling);
  const yearFirst = (): EuPair | null =>
    canBeYear(first) ? { year: expandTwoDigitYear(first), actNumber: second } : null;
  const numberFirst = (): EuPair | null =>
    canBeYear(second) ? { actNumber: first, year: expandTwoDigitYear(second) } : null;

  if (opts.trailingMarker && opts.kind === 'direttiva') return yearFirst();
  if (firstIsYear && !secondIsYear) return yearFirst();
  if (secondIsYear && !firstIsYear) return numberFirst();
  if (firstIsYear && secondIsYear) {
    return !opts.oldMarker && parseInt(first, 10) >= NEW_NUMBERING_FROM ? yearFirst() : numberFirst();
  }
  if (first.length === 2 && second.length === 2) {
    return opts.kind === 'direttiva' ? yearFirst() : numberFirst();
  }
  if (first.length === 2) return yearFirst();
  return numberFirst();
}
