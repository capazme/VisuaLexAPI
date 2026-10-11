/**
 * A citation typed in the find window, and the spans of a text that name the same norm or
 * decision in another form (spec §13.2). `readQueryCitation` reads the query: a code's article,
 * a numbered act (with or without an article) or a decision's number and year, or `null` when the
 * query is not a citation and is searched literally only. `findCitationSpans` returns `[start,
 * end)` offsets of the original text: codes through `extractCitations` (the in-text reader of norm
 * links), numbered acts and decisions through patterns over `foldForSearch(text)`, which keeps
 * every offset. A span covers the citation as written: from «art.» or the act type to the year or
 * the number. Pure and read-only: nothing here touches the DOM (root rule 23).
 */

import { ARTICLE_SUFFIX_ALTERNATION } from './articleSuffixes';
import { extractCitations } from './citationMatcher';
import { toApiArticleNumber } from './citationParser';
import { expandTwoDigitYear } from './dateUtils';
import { foldForSearch } from './findInText';
import { ACT_TYPES } from './sources/actTypes';

export type QueryCitation =
  | { kind: 'code'; code: string; article: string }
  | { kind: 'act'; actType: string; number: string; year: string; article?: string }
  | { kind: 'decision'; number: string; year: string };

type Span = [number, number];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// The vocabulary, over folded text (lower case, no accents, typographic
// apostrophes as «'»).
// ---------------------------------------------------------------------------

/** One act type's forms: its names and its abbreviation, from the convention's table (`ACT_TYPES`). */
interface ActTypeForms {
  actType: string;
  source: string;
  whole: RegExp;
}

/** «d.lgs.» → «d.lgs.», «dlgs», «d. lgs», «D.Lgs.» (folded): every dot optional, a space allowed after one. */
function abbreviationSource(abbreviation: string): string {
  return abbreviation
    .split(/[.\s]+/)
    .filter(Boolean)
    .map((part) => `${escapeRegExp(part)}\\.?`)
    .join('\\s*');
}

/**
 * The act types grouped by abbreviation (`decreto legge` and `decreto-legge` are one type), each
 * named by the table's first key for it, with its forms longest first.
 */
const ACT_TYPE_FORMS: ActTypeForms[] = (() => {
  const groups = new Map<string, { actType: string; names: string[] }>();
  for (const [name, abbreviation] of Object.entries(ACT_TYPES)) {
    const group = groups.get(abbreviation);
    if (group) group.names.push(name);
    else groups.set(abbreviation, { actType: name, names: [name] });
  }
  return [...groups.entries()].map(([abbreviation, { actType, names }]) => {
    const forms = [...names.map((n) => escapeRegExp(n).replace(/\s+/g, '\\s+')), abbreviationSource(abbreviation)]
      .sort((a, b) => b.length - a.length);
    const source = `(?:${forms.join('|')})`;
    return { actType, source, whole: new RegExp(`^${source}$`, 'u') };
  });
})();

/**
 * Where an act type may start: not inside a word, not after a dot («d.l.» inside «r.d.l.»), not
 * after «regio» («decreto legge» inside «regio decreto legge»).
 */
const TYPE_START = "(?<![\\p{L}\\p{N}.'])(?<!regio\\s+)";
const ANY_ACT_TYPE = `(?:${ACT_TYPE_FORMS.map((f) => f.source).sort((a, b) => b.length - a.length).join('|')})`;

const NUMBER_WORD = '(?:n|nr|num|numero)\\.?\\s*';
const DAY_MONTH = '\\d{1,2}[°º]?\\s+\\p{L}+\\s+';
const ARTICLE_WORD = "(?<![\\p{L}\\p{N}])art(?:t|icol[oi])?\\.?";
const ARTICLE_ITEM = `\\d+(?:\\s*-?\\s*(?:${ARTICLE_SUFFIX_ALTERNATION})\\b)?`;
const ARTICLE_LIST = `${ARTICLE_ITEM}(?:\\s*(?:,|\\be\\b)\\s*${ARTICLE_ITEM})*`;
const COMMA_CLAUSE =
  `(?:\\s*,?\\s*(?:comma|co\\.)\\s*${ARTICLE_ITEM})?(?:\\s*,?\\s*(?:lett\\.?|lettera)\\s*\\p{L}\\)?)?`;
const PREPOSITION = "(?:(?:della|dello|del|dell')\\s*)?";

interface NumberYearSlots {
  /** The number in «n. 219 del 2017», «219/2017». */
  numberA: string;
  /** The number in «22 dicembre 2017, n. 219». */
  numberB: string;
  /** The year after a slash: four digits, or two. */
  slashYear: string;
  /** The year after «del». */
  delYear: string;
  /** The year of the date before the number. */
  dateYear: string;
}

/**
 * Number and year of an act, in the forms decisions write: «n. 219 del 2017», «219/2017», «n.
 * 219/17», «n. 219 del 22 dicembre 2017», and «22 dicembre 2017, n. 219».
 */
function numberYearSource(s: NumberYearSlots): string {
  const a = `(?:${NUMBER_WORD})?(?<![\\d/])${s.numberA}(?!\\d)\\s*(?:\\/\\s*${s.slashYear}|,?\\s+del\\s+(?:${DAY_MONTH})?${s.delYear})(?!\\d)`;
  const b = `(?:del\\s+)?${DAY_MONTH}${s.dateYear}\\s*,?\\s*${NUMBER_WORD}${s.numberB}(?!\\d)`;
  return `(?:${a}|${b})`;
}

/** A sentence ends at «;», «!», «?», or at «.» or «:» before a capital (read on the original text). */
const SENTENCE_END = /[;!?]|[.:](?=\s+\p{Lu})/gu;
/** How far before an act its article may be. */
const ARTICLE_REACH = 160;

/** Another act or a code named between an article and the act: then the article is not this act's. */
const ANOTHER_ACT = new RegExp(
  `${TYPE_START}${ANY_ACT_TYPE}\\s*,?\\s*(?:${NUMBER_WORD})?\\d|\\d+\\s*\\/\\s*\\d|(?<![\\p{L}])(?:codice|cod\\.|costituzione|cost\\.|c\\.\\s*[cp]\\.)`,
  'u',
);

// ---------------------------------------------------------------------------
// Reading the query
// ---------------------------------------------------------------------------

const QUERY_ACT = new RegExp(
  `^(?:${ARTICLE_WORD}\\s*(?<artBefore>${ARTICLE_ITEM})${COMMA_CLAUSE}\\s*,?\\s*${PREPOSITION})?` +
    `(?<type>${ANY_ACT_TYPE})\\s*,?\\s*` +
    numberYearSource({
      numberA: '(?<numberA>\\d+)',
      numberB: '(?<numberB>\\d+)',
      slashYear: '(?<slashYear>\\d{4}|\\d{2})',
      delYear: '(?<delYear>\\d{4})',
      dateYear: '(?<dateYear>\\d{4})',
    }) +
    `(?:\\s*,?\\s*${ARTICLE_WORD}\\s*(?<artAfter>${ARTICLE_ITEM})${COMMA_CLAUSE})?$`,
  'u',
);

/** Words a decision's citation may start with: the court, the section, the kind of decision. */
const DECISION_HEAD =
  '(?:cass|cassazione|corte|c|cons|consiglio|tar|trib|tribunale|app|sent|sentenza|ord|ordinanza|sez|sezione|sezioni|s\\.\\s*u|ss\\.\\s*uu)(?!\\p{L})';
const QUERY_DECISION = new RegExp(
  `^(?:${DECISION_HEAD}[^/]*?[\\s.,]+)?(?:${NUMBER_WORD})?(?<number>\\d+)\\s*(?:\\/\\s*(?<slashYear>\\d{4}|\\d{2})|,?\\s+del\\s+(?<delYear>\\d{4}))$`,
  'u',
);

function foldQuery(query: string): string {
  return foldForSearch(query.normalize('NFC'))
    .replace(/\s+/g, ' ')
    .trim()
    // A full stop or a comma after the last number ends the sentence, not the citation.
    .replace(/(\d)\s*[.,;:]$/, '$1');
}

function readAct(folded: string): QueryCitation | null {
  const m = QUERY_ACT.exec(folded);
  if (!m?.groups) return null;
  const g = m.groups;
  if (g.artBefore && g.artAfter) return null;
  const forms = ACT_TYPE_FORMS.find((f) => f.whole.test(g.type));
  if (!forms) return null;
  const number = g.numberA ?? g.numberB;
  const year = g.slashYear ? expandTwoDigitYear(g.slashYear) : (g.delYear ?? g.dateYear);
  if (!number || !year) return null;
  const article = g.artBefore ?? g.artAfter;
  return {
    kind: 'act',
    actType: forms.actType,
    number,
    year,
    ...(article ? { article: toApiArticleNumber(article) } : {}),
  };
}

function readCode(query: string, folded: string): QueryCitation | null {
  // A list of articles is not one citation: it is searched literally.
  if (/(?<!\p{L})(?:artt|articoli)(?!\p{L})/u.test(folded)) return null;
  const trimmed = query.trim();
  const found = extractCitations(trimmed);
  if (found.length !== 1) return null;
  const [c] = found;
  if (c.startIndex !== 0 || trimmed.slice(c.endIndex).replace(/[\s.,;:]/g, '') !== '') return null;
  if (c.parsed.act_number || c.parsed.date) return null;
  return { kind: 'code', code: c.parsed.act_type, article: c.parsed.article };
}

function readDecision(folded: string): QueryCitation | null {
  const m = QUERY_DECISION.exec(folded);
  if (!m?.groups) return null;
  const { number, slashYear, delYear } = m.groups;
  const year = slashYear ? expandTwoDigitYear(slashYear) : delYear;
  return year ? { kind: 'decision', number, year } : null;
}

/**
 * The citation `query` reads as, or `null`. It must be the whole query: «art. 580 c.p.» is a
 * citation, «art. 580 c.p. e la legge» is words. A code's abbreviation alone («c.p.»), an act
 * without its number, an article without its act are not citations.
 */
export function readQueryCitation(query: string): QueryCitation | null {
  const folded = foldQuery(query);
  if (folded.length < 2) return null;
  return readAct(folded) ?? readCode(query, folded) ?? readDecision(folded);
}

// ---------------------------------------------------------------------------
// Finding it in a text
// ---------------------------------------------------------------------------

/** The year in a text: four digits, or two that the app's pivot reads as that year (`expandTwoDigitYear`). */
function slashYearSource(year: string): string {
  const short = year.slice(2);
  return expandTwoDigitYear(short) === year ? `(?:${year}|${short})` : year;
}

function listHas(list: string, article: string): boolean {
  return [...list.matchAll(new RegExp(ARTICLE_ITEM, 'gu'))].some((m) => toApiArticleNumber(m[0]) === article);
}

/** Where the sentence holding `pos` begins, looking back at most `reach` characters. */
function sentenceStart(text: string, pos: number, reach: number): number {
  const from = Math.max(0, pos - reach);
  let start = from;
  for (const m of text.slice(from, pos).matchAll(SENTENCE_END)) start = from + (m.index ?? 0) + m[0].length;
  return start;
}

const ARTICLE_MENTION = new RegExp(`${ARTICLE_WORD}\\s*(${ARTICLE_LIST})`, 'gu');
const ARTICLE_AFTER = new RegExp(`^\\s*,?\\s*${ARTICLE_WORD}\\s*(${ARTICLE_LIST})`, 'u');

/** The act's article written before it in the same sentence, or right after it: the widened span, or null. */
function withArticle(text: string, folded: string, [start, end]: Span, article: string): Span | null {
  const from = sentenceStart(text, start, ARTICLE_REACH);
  const before = [...folded.slice(from, start).matchAll(ARTICLE_MENTION)].pop();
  if (before) {
    const mentionStart = from + (before.index ?? 0);
    const gap = folded.slice(mentionStart + before[0].length, start);
    if (listHas(before[1], article) && !ANOTHER_ACT.test(gap)) return [mentionStart, end];
  }
  const after = ARTICLE_AFTER.exec(folded.slice(end));
  if (after && listHas(after[1], article)) return [start, end + after[0].length];
  return null;
}

function actSpans(text: string, folded: string, c: Extract<QueryCitation, { kind: 'act' }>): Span[] {
  const forms = ACT_TYPE_FORMS.find((f) => f.actType === c.actType);
  if (!forms) return [];
  const number = escapeRegExp(c.number);
  const re = new RegExp(
    `${TYPE_START}${forms.source}\\s*,?\\s*` +
      numberYearSource({ numberA: number, numberB: number, slashYear: slashYearSource(c.year), delYear: c.year, dateYear: c.year }),
    'gu',
  );
  const spans: Span[] = [];
  for (const m of folded.matchAll(re)) {
    const span: Span = [m.index ?? 0, (m.index ?? 0) + m[0].length];
    if (!c.article) spans.push(span);
    else {
      const widened = withArticle(text, folded, span, c.article);
      if (widened) spans.push(widened);
    }
  }
  return spans;
}

function decisionSpans(folded: string, c: Extract<QueryCitation, { kind: 'decision' }>): Span[] {
  const re = new RegExp(
    `(?:(?<![\\p{L}\\p{N}])${NUMBER_WORD})?(?<![\\d/])(?<!\\d[.,])${escapeRegExp(c.number)}(?!\\d)\\s*` +
      `(?:\\/\\s*${slashYearSource(c.year)}|,?\\s+del\\s+(?:${DAY_MONTH})?${c.year})(?!\\d)`,
    'gu',
  );
  return [...folded.matchAll(re)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
}

/** «dell'», «all'»… that `extractCitations` reads with the article: the span starts at «art.». */
const LEADING_PREPOSITION = /^(?:dell?|dall?|all?|nell?|sull?)['’]/i;

/** A list read whole («artt. 2, 13 e 32 Cost.»): `extractCitations` names it by its first article only. */
const ARTICLE_LIST_HEAD = /^(?:\p{L}+['’])?(?:artt|articoli)(?!\p{L})/iu;

/** `extractCitations` results of the last texts read: a window searching the same texts for every keystroke parses each once. */
const CITATIONS_CACHE_SIZE = 32;
const citationsCache = new Map<string, ReturnType<typeof extractCitations>>();

function citationsIn(text: string): ReturnType<typeof extractCitations> {
  const hit = citationsCache.get(text);
  if (hit) {
    citationsCache.delete(text);
    citationsCache.set(text, hit);
    return hit;
  }
  const found = extractCitations(text);
  citationsCache.set(text, found);
  if (citationsCache.size > CITATIONS_CACHE_SIZE) citationsCache.delete(citationsCache.keys().next().value as string);
  return found;
}

function codeSpans(text: string, c: Extract<QueryCitation, { kind: 'code' }>): Span[] {
  const code = c.code.toLowerCase();
  return citationsIn(text)
    .filter((m) => !m.parsed.act_number && m.parsed.act_type.toLowerCase() === code)
    .filter((m) => m.parsed.article === c.article || (ARTICLE_LIST_HEAD.test(m.text) && listHas(m.text, c.article)))
    .map((m) => [m.startIndex + (LEADING_PREPOSITION.exec(m.text)?.[0].length ?? 0), m.endIndex]);
}

/** Every span of `text` naming the same norm or decision as `citation`, sorted, as `[start, end)` of the original text. */
export function findCitationSpans(text: string, citation: QueryCitation): Span[] {
  if (citation.kind === 'code') return codeSpans(text, citation);
  const folded = foldForSearch(text);
  if (citation.kind === 'act') return actSpans(text, folded, citation);
  return decisionSpans(folded, citation);
}

/**
 * Two lists of matches as one: ordered by start (the longer first at the same start), and a match
 * that overlaps one already kept is dropped, so an overlap is kept once.
 */
export function mergeMatches(a: readonly Span[], b: readonly Span[]): Span[] {
  const all = [...a, ...b].sort((x, y) => x[0] - y[0] || y[1] - x[1]);
  const out: Span[] = [];
  for (const span of all) {
    if (out.length > 0 && span[0] < out[out.length - 1][1]) continue;
    out.push([span[0], span[1]]);
  }
  return out;
}
