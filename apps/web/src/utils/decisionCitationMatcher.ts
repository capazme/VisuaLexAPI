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
import { decisionPath, linkableDecisionPath, parseDecisionPath } from './decisionLinks';
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
/** The same for a kind of decision («sentenza n. 207 del 2018») inside a Corte costituzionale decision. */
const SYNTHETIC_CORTE_COSTITUZIONALE = 'Corte cost. ';

/** The court of the text being read: it decides which citations without a court are read as its own (D2). */
export type DecisionContext = 'cassazione' | 'corte_costituzionale';

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
// «CTR Lazio», «CTP di Milano», «la Ctr della Lombardia», «CTR dell'Emilia-Romagna»: a capitalised place follows.
const TAX_PLACE = /^\s+(?:(?:di|del|della|dello|dell['’]|degli|dei|delle)\s*)?\p{Lu}/u;
const UPPERCASE_CASE_LETTER = new RegExp(`[CT](?=\\s*${EU_DASH}?\\s*\\d)`);
// Courts the app cannot open. They are never linked, but a section written after one belongs to it and
// not to the Cassazione (the context rule reads a section only when no court is written before it).
// The Tribunale of the Union and the administrative tribunals are courts the app opens: they start at the
// same place as a supported head, which wins.
const UNSUPPORTED_HEADS = new RegExp(
  `${LEFT}(?:corte\\s+d(?:i\\s+|['’]\\s*)appello|c\\.\\s*app(?:ello)?\\.?|app\\.|tribunale|(?<!sez(?:ione)?\\.?\\s*|\\(\\s*)trib\\.|corte\\s+edu|cedu|c\\.\\s*e\\.\\s*d\\.\\s*u\\.?` +
    `|corte\\s+europea\\s+dei\\s+diritti\\s+dell['’]\\s*uomo|comm(?:issione)?\\.?\\s*trib(?:utaria)?\\.?|giudice\\s+di\\s+pace|g\\.\\s*d\\.\\s*p\\.|c\\.\\s*t\\.\\s*[pr]\\.?|ct[pr])(?![\\p{L}\\p{N}])`,
  'giu',
);
// «Corte di cassazione», «Suprema Corte di Cassazione»: the span starts at the first of these words.
const CORTE_DI = /(?<![\p{L}\p{N}])(?:suprema\s+)?corte\s+(?:suprema\s+)?di\s+$/u;
const CORTE_DI_REACH = 30;
// A publication date is not the decision's: the tail ends where the Gazzetta Ufficiale begins.
const GAZZETTA = /\(\s*in\s+g\.\s*u\b|(?<![\p{L}\p{N}.])g\.\s*u\.(?!\s*e\b)|(?<![\p{L}\p{N}])gazzetta\s+ufficiale/u;
const UNITED_SECTIONS = /^s\.?\s*u\.?$/i;
// «sentenza n. 207 del 2018», «sent. 207/2018», «ordinanze n. 1 del 2010 e n. 2 del 2011»: a kind of decision and its number.
const KIND_HEADS = new RegExp(`${LEFT}(sentenz[ae]|sent\\.|ordinanz[ae]|ord\\.)(?=\\s*(?:n(?:r|um(?:ero)?)?\\.?\\s*)?\\d)`, 'giu');
// After a plural kind: «, e n. 12 del 2010» is the next decision of the list.
const LIST_NEXT = /\s*(?:,|e|ed)\s*(n(?:r|um(?:ero)?)?\.?\s*\d{1,6}\s*(?:\/\s*\d{4}|del\s+\d{4}))/y;
// A court named right after a citation is its court: «sentenza n. 1234 del 2015 della Corte di cassazione».
const AFTER_CITATION = /^[\s,]*(?:(?:della|del|dello|dell['’]|dalla|dal|di|emessa|pronunciata|resa|adottata)\s*)+/u;
const CORTE_DI_AFTER = /^(?:suprema\s+)?corte\s+(?:suprema\s+)?di\s+/u;

interface Head {
  start: number;
  end: number;
  /** A court head cuts the tail of the heads before it; a case number or a section does not cut a court's. */
  court: boolean;
  /** A section standing without its court: read as if «Cass.» were written before it. */
  section: boolean;
  /** A kind of decision and its number inside a Corte costituzionale decision: read as if «Corte cost.» were written before it. */
  kind?: boolean;
  /** «sentenze», «ordinanze»: the numbers that follow, joined by «e» or a comma, are decisions too. */
  plural?: boolean;
  /** A court the app cannot open: it links nothing and covers what follows it. */
  unsupported?: boolean;
}

function findHeads(text: string, folded: string, within: DecisionContext | undefined): Head[] {
  const heads: Head[] = [];
  for (const m of folded.matchAll(COURT_HEADS)) {
    heads.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, court: true, section: false });
  }
  const supported = new Set(heads.map((h) => h.start));
  for (const m of folded.matchAll(UNSUPPORTED_HEADS)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    // «CTP» is also the consulente tecnico di parte: a court only with a place name after it («CTP Milano»)
    const bare = /^ct[pr]$/i.test(m[0]);
    if (bare && !TAX_PLACE.test(text.slice(end, end + 40))) continue;
    if (!supported.has(start)) heads.push({ start, end, court: true, section: false, unsupported: true });
  }
  for (const m of folded.matchAll(CASE_HEADS)) {
    const start = m.index ?? 0;
    // «c-12/2020» in lower case is not a case number
    if (UPPERCASE_CASE_LETTER.test(text.slice(start, start + m[0].length))) {
      heads.push({ start, end: start + m[0].length, court: false, section: false });
    }
  }
  if (within === 'corte_costituzionale') {
    for (const m of folded.matchAll(KIND_HEADS)) {
      const start = m.index ?? 0;
      heads.push({ start, end: start + m[0].length, court: false, section: false, kind: true, plural: /e$/.test(m[1]) });
    }
  }
  if (within === 'cassazione') {
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

/** Whether a court is named right after `end`: «… del 2015 della Corte di cassazione». */
function courtFollows(folded: string, end: number): boolean {
  const after = folded.slice(end, end + 70);
  const joined = AFTER_CITATION.exec(after);
  if (!joined) return false;
  const here = end + joined[0].length;
  const skipped = CORTE_DI_AFTER.exec(folded.slice(here, here + 30));
  for (const at of skipped ? [here, here + skipped[0].length] : [here]) {
    for (const heads of [COURT_HEADS, UNSUPPORTED_HEADS]) {
      const re = new RegExp(heads.source, 'iuy');
      re.lastIndex = at;
      if (re.test(folded)) return true;
    }
  }
  return false;
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
  'art', 'artt', 'giust', 'trib', 'amm', 'decr', 'par', 'cd', 'ss', 'uu', 'aut', 'lett', 'co', 'cfr', 'app', 'comm', 'reg', 'prov', 'min', 'sorv',
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
  'sent', 'sentenza', 'sentenze', 'ord', 'ordinanza', 'ordinanze', 'decr', 'decreto', 'ad', 'adunanza', 'plen', 'plenaria', 'aut', 'ampliata', 'bis', 'ter', 'quater',
  'ud', 'udienza', 'trib', 'tributaria', 'causa', 'cause', 'riunite', 'giust', 'giustizia', 'ue', 'unione', 'europea', 'europee', 'comunita', 'primo', 'grado', 'stato', 'cost',
  'costituzionale', 'per', 'sede', 'di', 'del', 'dello', 'della', 'dell', 'dei', 'delle', 'e', 'ed', 'con', 'il', 'la', 'lo', 'in', 'data',
  'n', 'nr', 'num', 'numero', 'dep', 'depositata', 'depositato', 'deposito', 'depositi',
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
]);
const ROMAN = /^[ivx]+$/;

// Between two pieces of one citation (the number, its date, its deposit) only the words that join them.
const JOINING_WORDS = new Set(['del', 'dell', 'il', 'in', 'data', 'dep', 'depositata', 'depositato', 'deposito']);
// The kind of decision between its date and its number: «15 aprile 2020, ord. n. 7890». After the number it
// is not the citation's: «n. 1234, il decreto 3 marzo 2021» is another act, whose date is not the year.
const JOINING_BEFORE_NUMBER = new Set([...JOINING_WORDS, 'sent', 'sentenza', 'ord', 'ordinanza', 'decr', 'decreto']);
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
    // single letters and Roman numerals (a section) stand in a preamble, never between the pieces of a number
    if (words.has(word) || (words !== JOINING_WORDS && words !== JOINING_BEFORE_NUMBER && (word.length <= 1 || ROMAN.test(word)))) continue;
    if (properNames && /^\p{Lu}/u.test(m[0])) continue;
    return false;
  }
  return true;
}

// What may stand between a court's name and its own section: a seat, the court's kind («reg.», «prov.»).
const COVER_WORDS = new Set([
  ...CITATION_WORDS, 'reg', 'regionale', 'prov', 'provinciale', 'pace', 'appello', 'secondo',
  'min', 'minorenni', 'sorv', 'sorveglianza', 'dal', 'dalla', 'dallo', 'dalle', 'dai', 'al', 'alla',
]);
const MAX_COVER_GAP = 60;
const CONJUNCTION = /^[\s,]*(?:e|ed)(?![\p{L}\p{N}])/iu;

/** Whether a section at `to` stands in the citation of the court whose name ends at `from`, not in prose after it. */
function inCourtCitation(text: string, from: number, to: number): boolean {
  return to - from <= MAX_COVER_GAP && citationGap(text.slice(from, to), COVER_WORDS, true);
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
  options: { within?: DecisionContext; now?: Date } = {},
): DecisionCitationSpan[] {
  const now = options.now ?? new Date();
  const folded = foldForSearch(text);
  const heads = findHeads(text, folded, options.within);
  const starts = heads.map((h) => h.start);
  const courtStarts = heads.filter((h) => h.court).map((h) => h.start);
  const found: DecisionCitationSpan[] = [];
  let acts: Array<[number, number]> | null = null;
  let consumed = 0;
  // A section written in a court's citation belongs to that court: the context rule covers only a bare section.
  let lastCourt: { end: number; coverEnd: number } | null = null;

  for (const head of heads) {
    if (head.start < consumed) continue;
    if ((head.section || head.kind) && lastCourt && head.start < lastCourt.coverEnd && inCourtCitation(text, lastCourt.end, head.start)) continue;
    consumed = head.end;
    const cut = head.court ? courtStarts : starts;
    const next = firstAtOrAfter(cut, head.end);
    const limit = Math.min(head.start + MAX_TAIL, next < cut.length ? cut[next] : folded.length);
    const tailEnd = sentenceEnd(text, folded, head.start, limit);
    if (head.court) lastCourt = { end: head.end, coverEnd: tailEnd };
    if (head.unsupported) continue;
    const prefix = head.kind ? SYNTHETIC_CORTE_COSTITUZIONALE : head.section ? SYNTHETIC_COURT : '';
    const read = readDecisionCitation(prefix + folded.slice(head.start, tailEnd), { aliasTriggers: [], now });
    if (!read || read.words.length === 0) continue;

    const at = (offset: number): number => head.start + offset - prefix.length;
    const pieces = [...read.words].sort((a, b) => a[0] - b[0]);
    const properNames = read.reference.corte === 'tar';
    let cursor = at(Math.max(read.headEnd, prefix.length));
    // «Consiglio di Stato e la sentenza n. 7 del 2017»: an «e» right after the court ends its citation, and the
    // number after it is not its. (A list inside one citation, «Cass., sez. III, n. 1/2020 e n. 2/2021», is untouched.)
    if (head.court && CONJUNCTION.test(text.slice(cursor, at(pieces[0][0])))) continue;
    let clean = true;
    const number = read.words[0]; // the parsers list the number (or the pair) first
    pieces.forEach((piece, i) => {
      const [from, to] = piece;
      const allowed = i === 0 ? CITATION_WORDS : piece === number ? JOINING_BEFORE_NUMBER : JOINING_WORDS;
      if (at(from) > cursor && !citationGap(text.slice(cursor, at(from)), allowed, properNames)) clean = false;
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
    if (head.kind && courtFollows(folded, end)) continue;

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
    if (head.court && lastCourt) lastCourt.coverEnd = end;

    // «sentenze n. 253 del 2009 e n. 12 del 2010»: each number of the list is a decision of its own
    for (let more = head.plural ? end : -1; more >= 0; ) {
      LIST_NEXT.lastIndex = more;
      const item = LIST_NEXT.exec(folded);
      if (!item) break;
      const itemStart = more + item[0].length - item[1].length;
      const itemEnd = itemStart + item[1].length;
      const listed = readDecisionCitation(`${prefix}sentenza ${folded.slice(itemStart, itemEnd)}`, { aliasTriggers: [], now });
      if (!listed || courtFollows(folded, itemEnd)) break;
      const overlapping = firstEndingAfter(acts, itemStart);
      if (overlapping < acts.length && acts[overlapping][0] < itemEnd) break;
      if (linkableDecisionPath(listed.reference, now) === null) break;
      found.push({ start: itemStart, end: itemEnd, reference: listed.reference, path: decisionPath(listed.reference) });
      consumed = itemEnd;
      more = itemEnd;
    }
  }
  return found;
}

// --- The links in a rendered text ---

// A tag that ends a line of text: the scanner must not read a citation across it.
const BLOCK_TAG = /^<\/?(?:div|p|br|li|ul|ol|h[1-6]|blockquote|tr|td|th|table|section|article)\b/i;

const decodedEntities = new Map<string, string>();
const MAX_DECODED_ENTITIES = 2000;
let decoder: HTMLTextAreaElement | null = null;

/** An entity as the browser reads it («&rsquo;» is «’»; one it does not know stays as written). */
function decodeEntity(entity: string): string {
  const known = decodedEntities.get(entity);
  if (known !== undefined) return known;
  decoder ??= document.createElement('textarea');
  decoder.innerHTML = entity;
  const value = decoder.value;
  if (decodedEntities.size < MAX_DECODED_ENTITIES) decodedEntities.set(entity, value);
  return value;
}

// The reader does not see these, and a word or a number they cut is still one: findInText ignores them too.
const INVISIBLE = /[\u00ad\u200b]/g;

/** The text a reader sees, and for each of its characters where it sits in the HTML. */
interface VisibleText {
  text: string;
  /** `from[i]`: the HTML offset where the character `i` begins; `to[i]`: where its source ends (a tag or an entity is one source). */
  from: number[];
  to: number[];
}

const HTML_PIECE = /<[^>]+>|&(?:#\d{1,7}|#x[\da-f]{1,6}|[a-z][a-z\d]{1,31});|[^<&]+|[<&]/gi;

/**
 * The text a reader sees: no tag (so a mark in the middle of a word or of a number does not cut it), an
 * entity as the character it is, a line break where a tag ends a block. `from` and `to` map its offsets
 * back to the HTML, which is where the links are put.
 */
function visibleText(html: string): VisibleText {
  let text = '';
  const from: number[] = [];
  const to: number[] = [];
  const push = (raw: string, start: number, end: number): void => {
    const chars = raw.replace(INVISIBLE, '');
    text += chars;
    for (let i = 0; i < chars.length; i += 1) {
      from.push(start);
      to.push(end);
    }
  };
  for (const m of html.matchAll(HTML_PIECE)) {
    const piece = m[0];
    const start = m.index ?? 0;
    if (piece[0] === '<' && piece.length > 1 && piece.endsWith('>')) {
      if (BLOCK_TAG.test(piece)) push('\n', start, start + piece.length);
    } else if (piece[0] === '&' && piece.length > 1) {
      push(decodeEntity(piece), start, start + piece.length);
    } else {
      for (let i = 0; i < piece.length; i += 1) {
        if (piece[i] === '\u00ad' || piece[i] === '\u200b') continue;
        text += piece[i];
        from.push(start + i);
        to.push(start + i + 1);
      }
    }
  }
  return { text, from, to };
}

/** The HTML ranges that the norm links (`wrapCitationsInHtml`) hold: a decision link never claims one. */
function normLinkRanges(html: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const m of html.matchAll(/<span class="citation-hover"[^>]*>([^<]*)<\/span>/g)) {
    const start = (m.index ?? 0) + m[0].indexOf('>') + 1;
    ranges.push([start, start + m[1].length]);
  }
  return ranges;
}

const pathParts = (path: string): { slug: string; numero: string; anno: string } => {
  const [, , slug = '', numero = '', anno = ''] = path.split('?')[0].split('/');
  return { slug, numero, anno };
};

/** Whether `path` names the decision `self` does: the same number and year, and a court that agrees
 *  (a Cassazione or a TAR written without its archive or seat agrees with any). */
function sameDecision(path: string, self: string): boolean {
  const a = pathParts(path);
  const b = pathParts(self);
  if (a.numero !== b.numero || a.anno !== b.anno) return false;
  if (a.slug === b.slug) return true;
  const bare = (x: string, y: string): boolean => (x === 'cassazione' && y.startsWith('cassazione-')) || (x === 'tar' && y.startsWith('tar-'));
  return bare(a.slug, b.slug) || bare(b.slug, a.slug);
}

const escapeAttribute = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

export interface WrapDecisionOptions {
  /** The court of the text being read (`extractDecisionCitations`'s context rule). */
  within?: DecisionContext;
  /** The reading decision's own address: a span that names it is not linked. */
  selfPath?: string;
  now?: Date;
}

/**
 * The decisions a rendered text cites, wrapped as `<span class="decision-cite" data-decision-path
 * data-cache-key>`, per text segment (a citation split by a highlight's `<mark>` is two spans with
 * one key), adding no character (root rule 23). Run it after `wrapCitationsInHtml`: a range the
 * norm links already hold is never claimed, the whole decision span being left out.
 */
export function wrapDecisionCitationsInHtml(html: string, options: WrapDecisionOptions = {}): string {
  if (!html) return html;
  const norms = normLinkRanges(html);
  const visible = visibleText(html);
  const spans = extractDecisionCitations(visible.text, { within: options.within, now: options.now })
    .filter((s) => !(options.selfPath && sameDecision(s.path, options.selfPath)))
    .map((s) => ({ start: visible.from[s.start], end: visible.to[s.end - 1], path: s.path }))
    .filter((s) => !norms.some(([a, b]) => s.start < b && a < s.end));
  if (spans.length === 0) return html;

  // From the end, so the offsets of the spans still to wrap stay right
  let result = html;
  for (let i = spans.length - 1; i >= 0; i -= 1) {
    const { start, end, path } = spans[i];
    const attribute = escapeAttribute(path);
    const open = `<span class="decision-cite" data-decision-path="${attribute}" data-cache-key="${attribute}">`;
    const wrapped = result.substring(start, end).replace(/<[^>]*>|[^<]+/g, (piece) => (piece.startsWith('<') ? piece : `${open}${piece}</span>`));
    result = result.substring(0, start) + wrapped + result.substring(end);
  }
  return result;
}

/** The reference a decision link's address reads back to, or null when it does not read. */
export function decisionReferenceOfPath(path: string, now?: Date): DecisionReference | null {
  const url = new URL(path, 'http://link.invalid');
  const { slug, numero, anno } = pathParts(url.pathname);
  const read = parseDecisionPath({ corte: slug, numero, anno }, url.searchParams, now);
  return read.ok ? read.reference : null;
}

/**
 * Whether `to` (a mouseleave's relatedTarget) is still inside the same decision link as `from`: a
 * citation wrapped per segment is several spans with one key, and crossing between them is not leaving.
 */
export function isSameDecisionTarget(from: Element, to: EventTarget | null): boolean {
  const candidate = to as Element | null;
  if (!candidate || typeof candidate.closest !== 'function') return false;
  const target = candidate.closest('.decision-cite');
  return Boolean(target) && target!.getAttribute('data-cache-key') === from.getAttribute('data-cache-key');
}
