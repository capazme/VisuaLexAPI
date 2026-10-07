/**
 * A court decision as lawyers type or paste it in the palette (design 2026-10-05 §1). It reads
 * only an input that starts with a court, so it never takes a norm away from the norm parser;
 * what it cannot read whole is null. The section is kept in the source's short codes ("III",
 * "U", "L", "F"): the route resolves it, as it does for the page's address.
 *
 * Runs on every keystroke: every pattern is flat (no nested quantifiers) and the text scanned
 * is capped, so a long paste cannot make it backtrack.
 */
import type { DecisionArchive, DecisionReference } from '../types/decisions';
import { FIRST_YEAR, MAX_NUMERO } from './decisionLinks';
import { expandTwoDigitYear } from './dateUtils';

const MAX_SCANNED = 600;

const COURT =
  /^\s*(?:(corte\s+cost(?:ituzionale)?\.?|c\.\s*cost\.?)|(cass(?:azione)?\.?)|(s\.?\s*u\.?)(?=\s*,?\s*(?:n\.?\s*)?\d))(?=[\s,]|$)/i;
const ARCHIVE = /\b(civ(?:ile)?|pen(?:ale)?)\b/i;
// A sub-section ("VI-1") is read but its suffix dropped: the server's normalize_section does not know it.
const SECTION =
  /\bsez(?:ione|ioni)?\.?\s*(un(?:ite)?\.?|lav(?:oro)?\.?|fer(?:iale)?\.?|[IVX]{1,4}(?:-[1-9L])?|[1-7](?:-[1-9L])?|[LUF])(?=[\s,.]|$)|\b(SU|S\.U\.)(?=[\s,]|$)/i;
// A pair "n. 10787/2024" or "n. 10787 del 2024". A two-digit year after "del" that opens a date
// ("del 21 aprile", "del 15/12/1999") is a day, not a year; the date's own year is read below.
// The bare "10787/2024" must not be a piece of a date either.
const NUMBER_YEAR =
  /\bn(?:\.|um(?:ero)?\.?)?\s*(\d{1,6})\s*(?:\/(\d{4}|\d{2})|del\s+(\d{4}|\d{2}))(?![\s/.-]*\d|\s+[a-zà-ù])\b|(?<![\d/.-])\b(\d{1,6})\s*\/\s*(\d{4}|\d{2})(?![/.-]?\d)\b/i;
const NUMBER_ONLY = /\bn(?:\.|um(?:ero)?\.?)?\s*(\d{1,6})\b/i;
// The Cassazione numbers a decision when it is deposited: "dep." with a full date or a bare year.
const DEPOSIT_YEAR =
  /\bdep(?:\.|osit(?:ata|ato|o))?\s*(?:il\s+)?(?:\d{1,2}[°º]?\s+[a-zà-ù]{3,9}\s+(\d{4})|\d{1,2}[/.-]\d{1,2}[/.-](\d{4})|(\d{4}))\b/i;
const DATE_YEAR =
  /\b\d{1,2}[°º]?\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})\b|\b\d{1,2}[/.-]\d{1,2}[/.-](\d{4})\b/i;

function sectionCode(raw: string): string {
  const s = raw.replace(/\./g, '').toLowerCase().split('-')[0];
  if (s.startsWith('un')) return 'U';
  if (s.startsWith('lav')) return 'L';
  if (s.startsWith('fer')) return 'F';
  return s.toUpperCase();
}

const stripDots = (w: string): string => w.replace(/\./g, '').toLowerCase();

export function parseDecisionCitation(
  input: string,
  options: { aliasTriggers?: string[]; now?: Date } = {},
): DecisionReference | null {
  const now = options.now ?? new Date();
  const text = input.trim().slice(0, MAX_SCANNED);
  const first = text.split(/[\s.,]+/, 1)[0]?.toLowerCase() ?? '';
  if (options.aliasTriggers?.some((t) => stripDots(t) === first)) return null;
  const court = COURT.exec(text);
  if (!court) return null;
  const corte = court[1] ? 'corte_costituzionale' : 'cassazione';
  const rest = text.slice(court[0].length);

  const pair = NUMBER_YEAR.exec(rest);
  const numero = pair ? Number(pair[1] ?? pair[4]) : Number(NUMBER_ONLY.exec(rest)?.[1]);
  const pairYear = pair ? pair[2] ?? pair[3] ?? pair[5] : undefined;
  const dep = corte === 'cassazione' ? DEPOSIT_YEAR.exec(rest) : null;
  const date = DATE_YEAR.exec(rest);
  const rawYear = dep ? dep[1] ?? dep[2] ?? dep[3] : pairYear ?? date?.[1] ?? date?.[2];
  const anno = rawYear ? Number(expandTwoDigitYear(rawYear)) : undefined;
  if (!Number.isInteger(numero) || anno === undefined) return null;
  if (numero < 1 || numero > MAX_NUMERO || anno < FIRST_YEAR[corte] || anno > now.getFullYear()) return null;

  const ref: DecisionReference = { corte, numero, anno };
  if (corte === 'cassazione') {
    const archive = ARCHIVE.exec(rest);
    if (archive) ref.archivio = (archive[1].toLowerCase().startsWith('civ') ? 'civile' : 'penale') as DecisionArchive;
    if (court[3]) ref.sezione = 'U';
    const section = SECTION.exec(rest);
    if (section) ref.sezione = section[2] ? 'U' : sectionCode(section[1]);
  }
  return ref;
}
