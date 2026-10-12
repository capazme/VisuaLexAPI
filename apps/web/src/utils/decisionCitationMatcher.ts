/**
 * The court decisions a running text cites, with where they are written (design
 * 2026-10-13-decision-citations-in-texts). Pure and read-only: it returns `[start, end)` offsets of the
 * text it was given and touches nothing (root rule 23); wrapping them in links is the caller's.
 *
 * The court is read, not guessed (D2): a citation is found from a court head — the palette parser's own
 * vocabulary (`decisionCitationParser.ts`) — and the words after it, a bounded tail, go to that same
 * parser, so the golden file stays the one definition of how a decision is written. A bare «n. 123/2020»
 * is never a decision. The one context rule: inside a Cassazione decision (`within: 'cassazione'`) a
 * section written without the court («Sez. U, n. 9100 del 2015», «S.U. n. …») reads as the Cassazione.
 *
 * Every pattern is flat (no nested quantifiers) and every tail is at most `MAX_TAIL` characters cut at
 * the next head, so the scan is linear in the text.
 */
import type { DecisionReference } from '../types/decisions';
import { allActSpans } from './citationSearch';
import {
  ADMIN_COURT_HEAD_SOURCE,
  COURT_HEAD_SOURCE,
  EU_COURT_HEAD_SOURCE,
  EU_DASH,
  SECTION_HEAD_SOURCE,
  SEZIONI_UNITE_HEAD_SOURCE,
  readDecisionCitation,
} from './decisionCitationParser';
import { decisionPath, linkableDecisionPath } from './decisionLinks';
import { foldForSearch } from './findInText';

export interface DecisionCitationSpan {
  /** `[start, end)` of the input text, in UTF-16 units. */
  start: number;
  end: number;
  reference: DecisionReference;
  /** The decision's address, `/sentenze/…` (`decisionPath`). */
  path: string;
}

/** How far a citation may reach from its head. */
const MAX_TAIL = 200;
/** What the parser reads when a section stands without its court. */
const SYNTHETIC_COURT = 'Cass. ';

// Where a head may start: not inside a word.
const LEFT = '(?<![\\p{L}\\p{N}])';
const COURT_HEADS = new RegExp(`${LEFT}(?:${COURT_HEAD_SOURCE}|${EU_COURT_HEAD_SOURCE}|${ADMIN_COURT_HEAD_SOURCE})`, 'giu');
// The Union's case number is a head of its own: «C-634/21» (the letter names the court), or after «causa».
const CASE_NUMBER = `\\d{1,4}\\s*/\\s*\\d{2}`;
const CASE_HEADS = new RegExp(
  `(?<![\\p{L}\\p{N}/-])(?:[ct]${EU_DASH}${CASE_NUMBER}|(?:causa|cause\\s+riunite)\\s+[ct]\\s*${EU_DASH}?\\s*${CASE_NUMBER})`,
  'giu',
);
const SECTION_HEADS = new RegExp(`${LEFT}(?:${SECTION_HEAD_SOURCE}|${SEZIONI_UNITE_HEAD_SOURCE})`, 'giu');
const UPPERCASE_CASE_LETTER = /[CT](?=\s*[-‐-—]?\s*\d)/;
const UNITED_SECTIONS = /^s\.?\s*u\.?$/i;

interface Head {
  start: number;
  end: number;
  /** A court head cuts the tail of the heads before it; a case number or a section does not cut a court's. */
  court: boolean;
  /** A section standing without its court: read as if «Cass.» were written before it. */
  section: boolean;
}

function findHeads(text: string, folded: string, within: boolean): Head[] {
  const heads: Head[] = [];
  for (const m of folded.matchAll(COURT_HEADS)) {
    heads.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, court: true, section: false });
  }
  for (const m of folded.matchAll(CASE_HEADS)) {
    const start = m.index ?? 0;
    // «c-12/2020» in lower case is not a case number
    if (UPPERCASE_CASE_LETTER.test(text.slice(start, start + m[0].length))) {
      heads.push({ start, end: start + m[0].length, court: false, section: false });
    }
  }
  if (within) {
    for (const m of folded.matchAll(SECTION_HEADS)) {
      const start = m.index ?? 0;
      const written = text.slice(start, start + m[0].length);
      // «su 12» is a preposition: the Sezioni Unite are written in capitals
      if (UNITED_SECTIONS.test(written) && written !== written.toUpperCase()) continue;
      heads.push({ start, end: start + m[0].length, court: false, section: true });
    }
  }
  return heads.sort((a, b) => a.start - b.start || b.end - a.end);
}

/** The index of the first of `starts` (sorted) that is at or after `position`. */
function firstAtOrAfter(starts: readonly number[], position: number): number {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (starts[mid] < position) low = mid + 1;
    else high = mid;
  }
  return low;
}

// A full stop closes the sentence when a capital follows and the word before it is not an abbreviation
// («Sez.», «n.», «civ.», «sent.»…) or an initial («T.A.R. Lazio»). A question or exclamation mark, or a
// blank line, closes it always. The patterns have no unbounded run to backtrack over.
const SENTENCE_BREAK = /[!?]\s+(?=\p{Lu})|\.\s+(?=\p{Lu})|\n[ \t\r]*\n/gu;
const ABBREVIATIONS = new Set([
  'sez', 'n', 'nr', 'num', 'civ', 'pen', 'sent', 'ord', 'lav', 'fer', 'un', 'cass', 'cost', 'cons', 'st', 'ad', 'plen', 'dep',
  'art', 'artt', 'giust', 'trib', 'amm', 'decr', 'par', 'cd', 'ss', 'uu', 'aut', 'lett', 'co', 'cfr',
]);
const MAX_ABBREVIATION = 6;

/** Where the tail of `[start, limit)` ends: at the first sentence end inside it, or at `limit`. */
function sentenceEnd(text: string, start: number, limit: number): number {
  const piece = text.slice(start, limit);
  for (const m of piece.matchAll(SENTENCE_BREAK)) {
    const at = m.index ?? 0;
    if (m[0][0] === '.') {
      let from = at;
      while (from > 0 && at - from <= MAX_ABBREVIATION && /\p{L}/u.test(piece[from - 1])) from -= 1;
      const word = foldForSearch(piece.slice(from, at));
      if (word.length === 1 || ABBREVIATIONS.has(word)) continue;
    }
    return start + at;
  }
  return limit;
}

// The words that may stand between a court and its number, or between the pieces of a citation: the
// sections, the archives, the kinds of decision, the date's months, a few joining words. Prose is none of
// them, so «la Corte costituzionale ha dichiarato … la legge n. 12/2010» is not one citation. The seat of
// a TAR is a proper name and is let through when it is written in capitals.
const CITATION_WORDS = new Set([
  'civ', 'civile', 'pen', 'penale', 'sez', 'sezione', 'sezioni', 'un', 'unite', 'unita', 'su', 'lav', 'lavoro', 'fer', 'feriale', 'ss', 'uu',
  'sent', 'sentenza', 'ord', 'ordinanza', 'decr', 'decreto', 'ad', 'adunanza', 'plen', 'plenaria', 'aut', 'ampliata', 'bis', 'ter', 'quater',
  'causa', 'cause', 'riunite', 'giust', 'giustizia', 'ue', 'unione', 'europea', 'europee', 'comunita', 'primo', 'grado', 'stato', 'cost',
  'costituzionale', 'per', 'sede', 'di', 'del', 'dello', 'della', 'dell', 'dei', 'delle', 'e', 'ed', 'con', 'il', 'la', 'lo', 'in', 'data',
  'n', 'nr', 'num', 'numero', 'dep', 'depositata', 'depositato', 'deposito', 'depositi',
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
]);
const ROMAN = /^[ivx]+$/;

function onlyCitationWords(written: string, properNames: boolean): boolean {
  for (const m of written.matchAll(/\p{L}+/gu)) {
    const word = foldForSearch(m[0]);
    if (word.length <= 1 || ROMAN.test(word) || CITATION_WORDS.has(word)) continue;
    if (properNames && /^\p{Lu}/u.test(m[0])) continue;
    return false;
  }
  return true;
}

/** The first index of `spans` (sorted, not overlapping) whose end is after `position`. */
function firstEndingAfter(spans: ReadonlyArray<readonly [number, number]>, position: number): number {
  let low = 0;
  let high = spans.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (spans[mid][1] <= position) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function extractDecisionCitations(
  text: string,
  options: { within?: 'cassazione'; now?: Date } = {},
): DecisionCitationSpan[] {
  const now = options.now ?? new Date();
  const folded = foldForSearch(text);
  const heads = findHeads(text, folded, options.within === 'cassazione');
  const starts = heads.map((h) => h.start);
  const courtStarts = heads.filter((h) => h.court).map((h) => h.start);
  const found: DecisionCitationSpan[] = [];
  let acts: Array<[number, number]> | null = null;
  let consumed = 0;

  for (const head of heads) {
    if (head.start < consumed) continue;
    consumed = head.end;
    const cut = head.court ? courtStarts : starts;
    const next = firstAtOrAfter(cut, head.end);
    const limit = Math.min(head.start + MAX_TAIL, next < cut.length ? cut[next] : folded.length);
    const tailEnd = sentenceEnd(text, head.start, limit);
    const prefix = head.section ? SYNTHETIC_COURT : '';
    const read = readDecisionCitation(prefix + folded.slice(head.start, tailEnd), { aliasTriggers: [], now });
    if (!read || read.words.length === 0) continue;

    const at = (offset: number): number => head.start + offset - prefix.length;
    const pieces = [...read.words].sort((a, b) => a[0] - b[0]);
    const properNames = read.reference.corte === 'tar';
    let cursor = at(Math.max(read.headEnd, prefix.length));
    let clean = true;
    for (const [from, to] of pieces) {
      if (at(from) > cursor && !onlyCitationWords(text.slice(cursor, at(from)), properNames)) clean = false;
      cursor = Math.max(cursor, at(to));
    }
    if (!clean) continue;

    // «(dep. 3 gennaio 2000)»: the parenthesis opened inside the span closes with it
    let end = cursor;
    const written = text.slice(head.start, end);
    if (text[end] === ')' && written.split('(').length > written.split(')').length) end += 1;

    acts ??= allActSpans(folded);
    const act = firstEndingAfter(acts, head.start);
    if (act < acts.length && acts[act][0] < end) continue;

    const { reference } = read;
    const openable = linkableDecisionPath(reference, now) !== null || (reference.corte === 'tar' && Boolean(reference.regione));
    if (!openable) continue;
    found.push({ start: head.start, end, reference, path: decisionPath(reference) });
    consumed = end;
  }
  return found;
}
