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
const UPPERCASE_CASE_LETTER = new RegExp(`[CT](?=\\s*${EU_DASH}?\\s*\\d)`);
// Courts the app cannot open. They are never linked, but a section written after one belongs to it and
// not to the Cassazione (the context rule reads a section only when no court is written before it).
// The Tribunale of the Union and the administrative tribunals are courts the app opens: they start at the
// same place as a supported head, which wins.
const UNSUPPORTED_HEADS = new RegExp(
  `${LEFT}(?:corte\\s+d(?:i\\s+|['’]\\s*)appello|c\\.\\s*app(?:ello)?\\.?|app\\.|tribunale|trib\\.|corte\\s+edu|cedu|c\\.\\s*e\\.\\s*d\\.\\s*u\\.?` +
    `|corte\\s+europea\\s+dei\\s+diritti\\s+dell['’]\\s*uomo|comm(?:issione)?\\.?\\s*trib(?:utaria)?\\.?|giudice\\s+di\\s+pace|g\\.\\s*d\\.\\s*p\\.)(?![\\p{L}\\p{N}])`,
  'giu',
);
// «Corte di cassazione», «Suprema Corte di Cassazione»: the span starts at the first of these words.
const CORTE_DI = /(?<![\p{L}\p{N}])(?:suprema\s+)?corte\s+(?:suprema\s+)?di\s+$/u;
const CORTE_DI_REACH = 30;
// A publication date is not the decision's: the tail ends where the Gazzetta Ufficiale begins.
const GAZZETTA = /\(\s*in\s+g\.\s*u\b|(?<![\p{L}\p{N}])g\.\s*u\.|(?<![\p{L}\p{N}])gazzetta\s+ufficiale/u;
const UNITED_SECTIONS = /^s\.?\s*u\.?$/i;

interface Head {
  start: number;
  end: number;
  /** A court head cuts the tail of the heads before it; a case number or a section does not cut a court's. */
  court: boolean;
  /** A section standing without its court: read as if «Cass.» were written before it. */
  section: boolean;
  /** A court the app cannot open: it links nothing and covers what follows it. */
  unsupported?: boolean;
}

function findHeads(text: string, folded: string, within: boolean): Head[] {
  const heads: Head[] = [];
  for (const m of folded.matchAll(COURT_HEADS)) {
    heads.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, court: true, section: false });
  }
  const supported = new Set(heads.map((h) => h.start));
  for (const m of folded.matchAll(UNSUPPORTED_HEADS)) {
    const start = m.index ?? 0;
    if (!supported.has(start)) heads.push({ start, end: start + m[0].length, court: true, section: false, unsupported: true });
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
// blank line or a semicolon (a list of precedents), closes it always. The patterns have no unbounded run to backtrack over.
const SENTENCE_BREAK = /[!?]\s+(?=\p{Lu})|\.\s+(?=\p{Lu})|\n[ \t\r]*\n|;/gu;
const ABBREVIATIONS = new Set([
  'sez', 'n', 'nr', 'num', 'civ', 'pen', 'sent', 'ord', 'lav', 'fer', 'un', 'cass', 'cost', 'cons', 'st', 'ad', 'plen', 'dep',
  'art', 'artt', 'giust', 'trib', 'amm', 'decr', 'par', 'cd', 'ss', 'uu', 'aut', 'lett', 'co', 'cfr', 'app', 'comm', 'reg',
]);
const MAX_ABBREVIATION = 6;

/** Where the tail of `[start, limit)` ends: at the first sentence end or Gazzetta Ufficiale inside it, or at `limit`. */
function sentenceEnd(text: string, folded: string, start: number, limit: number): number {
  const piece = text.slice(start, limit);
  const gazzetta = GAZZETTA.exec(folded.slice(start, limit));
  if (gazzetta) limit = start + gazzetta.index;
  for (const m of piece.matchAll(SENTENCE_BREAK)) {
    const at = m.index ?? 0;
    if (m[0][0] === '.') {
      let from = at;
      while (from > 0 && at - from <= MAX_ABBREVIATION && /\p{L}/u.test(piece[from - 1])) from -= 1;
      const word = foldForSearch(piece.slice(from, at));
      if (word.length === 1 || ABBREVIATIONS.has(word)) continue;
    }
    if (start + at < limit) return start + at;
    break;
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

// Between two pieces of one citation (the number, its date, its deposit) only the words that join them.
const JOINING_WORDS = new Set(['del', 'dell', 'il', 'dep', 'depositata', 'depositato', 'deposito']);
const MONTHS = 'gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre';
// A date, or a range of days («18-25 luglio 1997»), is the citation's own when it stands between its pieces.
const DATES = new RegExp(
  `\\d{1,2}(?:\\s*[-\u2013]\\s*\\d{1,2})?[°º]?\\s+(?:${MONTHS})\\s+\\d{4}|\\d{1,2}\\s*[/.-]\\s*\\d{1,2}\\s*[/.-]\\s*\\d{4}`,
  'giu',
);
// A number the parser did not use belongs to something else: another citation, an act, a later date.
const STRAY_NUMBER = /(?<![\p{L}\p{N}])n(?:r|um(?:ero)?)?\.?\s*\d|\d\s*\/\s*\d|\d{4}/iu;

/** Whether the words written in a gap of a citation are the citation's: no prose, no number of another. */
function citationGap(written: string, words: ReadonlySet<string>, properNames: boolean): boolean {
  const plain = written.replace(DATES, ' ');
  if (STRAY_NUMBER.test(plain)) return false;
  for (const m of plain.matchAll(/\p{L}+/gu)) {
    const word = foldForSearch(m[0]);
    if (word.length <= 1 || ROMAN.test(word) || words.has(word)) continue;
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
  // A section written after a court belongs to that court: the context rule covers only a bare section.
  let covered = 0;

  for (const head of heads) {
    if (head.start < consumed) continue;
    if (head.section && head.start < covered) continue;
    consumed = head.end;
    const cut = head.court ? courtStarts : starts;
    const next = firstAtOrAfter(cut, head.end);
    const limit = Math.min(head.start + MAX_TAIL, next < cut.length ? cut[next] : folded.length);
    const tailEnd = sentenceEnd(text, folded, head.start, limit);
    if (head.court) covered = tailEnd;
    if (head.unsupported) continue;
    const prefix = head.section ? SYNTHETIC_COURT : '';
    const read = readDecisionCitation(prefix + folded.slice(head.start, tailEnd), { aliasTriggers: [], now });
    if (!read || read.words.length === 0) continue;

    const at = (offset: number): number => head.start + offset - prefix.length;
    const pieces = [...read.words].sort((a, b) => a[0] - b[0]);
    const properNames = read.reference.corte === 'tar';
    let cursor = at(Math.max(read.headEnd, prefix.length));
    let clean = true;
    pieces.forEach(([from, to], i) => {
      if (at(from) > cursor && !citationGap(text.slice(cursor, at(from)), i === 0 ? CITATION_WORDS : JOINING_WORDS, properNames)) clean = false;
      cursor = Math.max(cursor, at(to));
    });
    if (!clean) continue;

    // «(dep. 3 gennaio 2000)»: the parenthesis opened inside the span closes with it
    let end = cursor;
    const written = text.slice(head.start, end);
    if (text[end] === ')' && written.split('(').length > written.split(')').length) end += 1;

    // The reference comes from the span's own words: an archive, a section or a kind written after it is another's.
    const own = readDecisionCitation(prefix + folded.slice(head.start, end), { aliasTriggers: [], now });
    if (!own || own.reference.numero !== read.reference.numero || own.reference.anno !== read.reference.anno) continue;
    const { reference } = own;

    acts ??= allActSpans(folded);
    const act = firstEndingAfter(acts, head.start);
    if (act < acts.length && acts[act][0] < end) continue;

    const openable = linkableDecisionPath(reference, now) !== null || (reference.corte === 'tar' && Boolean(reference.regione));
    if (!openable) continue;
    // «Corte di cassazione»: the span starts at the court's own first word
    let start = head.start;
    if (/^cassazione/.test(folded.slice(start, start + 11))) {
      const lead = CORTE_DI.exec(folded.slice(Math.max(0, start - CORTE_DI_REACH), start));
      const from = lead ? start - lead[0].length : start;
      if (from >= (found.length > 0 ? found[found.length - 1].end : 0)) start = from;
    }
    found.push({ start, end, reference, path: decisionPath(reference) });
    consumed = end;
    if (head.court) covered = end;
  }
  return found;
}
