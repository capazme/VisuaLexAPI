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
  /^\s*(?:(corte\s+cost(?:ituzionale)?\.?|c\.\s*cost\.?)|(cass(?:azione)?\.?)|(s\.?\s*u\.?))(?=[\s,]|$)/i;
const ARCHIVE = /\b(civ(?:ile)?|pen(?:ale)?)\b/i;
const SECTION =
  /\bsez(?:ione|ioni)?\.?\s*(un(?:ite)?\.?|lav(?:oro)?\.?|fer(?:iale)?\.?|[IVX]{1,4}|[1-7])(?=[\s,.]|$)|\b(SU|S\.U\.)(?=[\s,]|$)/i;
const NUMBER_YEAR = /\bn(?:\.|um(?:ero)?\.?)?\s*(\d{1,6})\s*(?:\/|del\s+)(\d{4}|\d{2})\b|\b(\d{1,6})\s*\/\s*(\d{4}|\d{2})\b/i;
const NUMBER_ONLY = /\bn(?:\.|um(?:ero)?\.?)?\s*(\d{1,6})\b/i;
const DEPOSIT_YEAR = /\bdep(?:\.|osit[ao])?\s*(?:il\s+)?\d{1,2}[°º]?\s+[a-zà-ù]{3,9}\s+(\d{4})/i;
const DATE_YEAR =
  /\b\d{1,2}[°º]?\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})\b/i;

function sectionCode(raw: string): string {
  const s = raw.replace(/\./g, '').toLowerCase();
  if (s.startsWith('un')) return 'U';
  if (s.startsWith('lav')) return 'L';
  if (s.startsWith('fer')) return 'F';
  return s.toUpperCase();
}

export function parseDecisionCitation(
  input: string,
  options: { aliasTriggers?: string[]; now?: Date } = {},
): DecisionReference | null {
  const now = options.now ?? new Date();
  const text = input.trim().slice(0, MAX_SCANNED);
  const first = text.split(/[\s.,]+/, 1)[0]?.toLowerCase() ?? '';
  if (options.aliasTriggers?.some((t) => t.toLowerCase() === first)) return null;
  const court = COURT.exec(text);
  if (!court) return null;
  const corte = court[1] ? 'corte_costituzionale' : 'cassazione';
  const rest = text.slice(court[0].length);

  let numero: number | undefined;
  let anno: number | undefined;
  const ny = NUMBER_YEAR.exec(rest);
  if (ny) {
    numero = Number(ny[1] ?? ny[3]);
    anno = Number(expandTwoDigitYear(ny[2] ?? ny[4]));
  } else {
    const n = NUMBER_ONLY.exec(rest);
    const y = DEPOSIT_YEAR.exec(rest) ?? DATE_YEAR.exec(rest);
    if (n && y) {
      numero = Number(n[1]);
      anno = Number(y[1]);
    }
  }
  if (numero === undefined || anno === undefined) return null;
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
