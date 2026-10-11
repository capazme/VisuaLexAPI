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
import { NUMBERED_ACT_SPELLINGS, toApiArticleNumber } from './citationParser';
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

/**
 * One act type's forms: its names and its abbreviation, from the convention's table (`ACT_TYPES`),
 * and the other spellings the palette accepts for it (`NUMBERED_ACT_SPELLINGS`: «legge cost.»).
 */
interface ActTypeForms {
  actType: string;
  source: string;
  whole: RegExp;
  /** The forms anywhere in a folded text, not inside a word (`insideAnotherType`). */
  anywhere: RegExp;
}

/** «d.lgs.» → «d.lgs.», «dlgs», «d. lgs», «D.Lgs.» (folded): every dot optional, a space allowed after one. */
function abbreviationSource(abbreviation: string): string {
  return abbreviation
    .split(/[.\s]+/)
    .filter(Boolean)
    .map((part) => `${escapeRegExp(part)}\\.?`)
    .join('\\s*');
}

/** «decreto legislativo» → «decreto\s+legislativo». */
function nameSource(name: string): string {
  return escapeRegExp(name).replace(/\s+/g, '\\s+');
}

/**
 * The act types grouped by abbreviation (`decreto legge` and `decreto-legge` are one type), each
 * named by the table's first key for it, with its forms longest first: the table's names, its
 * abbreviation, and the palette's other spellings of the type.
 */
const ACT_TYPE_FORMS: ActTypeForms[] = (() => {
  const groups = new Map<string, { actType: string; names: string[] }>();
  for (const [name, abbreviation] of Object.entries(ACT_TYPES)) {
    const group = groups.get(abbreviation);
    if (group) group.names.push(name);
    else groups.set(abbreviation, { actType: name, names: [name] });
  }
  const spellings = new Map<string, string[]>();
  for (const [spelling, actType] of NUMBERED_ACT_SPELLINGS) {
    const abbreviation = ACT_TYPES[actType];
    if (abbreviation) spellings.set(abbreviation, [...(spellings.get(abbreviation) ?? []), foldForSearch(spelling)]);
  }
  return [...groups.entries()].map(([abbreviation, { actType, names }]) => {
    const base = [...names.map(nameSource), abbreviationSource(abbreviation)];
    const baseWhole = new RegExp(`^(?:${base.join('|')})$`, 'u');
    const others = (spellings.get(abbreviation) ?? [])
      .filter((spelling) => !baseWhole.test(spelling))
      .map((spelling) => (spelling.includes('.') ? abbreviationSource(spelling) : nameSource(spelling)));
    const forms = [...new Set([...base, ...others])].sort((a, b) => b.length - a.length);
    const source = `(?:${forms.join('|')})`;
    return {
      actType,
      source,
      whole: new RegExp(`^${source}$`, 'u'),
      anywhere: new RegExp(`(?<![\\p{L}\\p{N}])${source}`, 'gu'),
    };
  });
})();

/** Where an act type may start: not inside a word, not after a dot («d.l.» inside «r.d.l.»). */
const TYPE_START = "(?<![\\p{L}\\p{N}.'])";
const ANY_ACT_TYPE = `(?:${ACT_TYPE_FORMS.map((f) => f.source).sort((a, b) => b.length - a.length).join('|')})`;

const NUMBER_WORD = '(?:n|nr|num|numero)\\.?\\s*';
/** The day and month of a date: «22 dicembre », «1° marzo », or in figures «22.12.», «30/5/». */
const DAY_MONTH = '(?:\\d{1,2}[°º]?\\s+\\p{L}+\\s+|\\d{1,2}\\s*[./-]\\s*\\d{1,2}\\s*[./-]\\s*)';
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
 * 219/17», «n. 219 del 22 dicembre 2017», «22 dicembre 2017, n. 219» and «22.12.2017, n. 219».
 */
function numberYearSource(s: NumberYearSlots): string {
  const a = `(?:${NUMBER_WORD})?(?<![\\d/])${s.numberA}(?!\\d)\\s*(?:\\/\\s*${s.slashYear}|,?\\s+del\\s+(?:${DAY_MONTH})?${s.delYear})(?!\\d)`;
  const b = `(?:del\\s+)?${DAY_MONTH}${s.dateYear}\\s*,?\\s*${NUMBER_WORD}${s.numberB}(?!\\d)`;
  return `(?:${a}|${b})`;
}

/** How far before an act its articles may be. */
const ARTICLE_REACH = 160;

/**
 * What may sit between an article and its act (spec §13.2), and nothing else: the article's comma,
 * letter or number («, comma 2», «co. 2», «lett. b)», «n. 3», «numero 3»), further articles of the
 * same act («art. 1 e l'art. 2», «artt. 1, 2 e 3»), commas and spaces, and «del», «della»,
 * «dell'», «di cui al», «di cui alla» before the act. Any other word, a full stop or a semicolon
 * breaks the link: the article is then not this act's.
 */
const ARTICLE_QUALIFIER =
  `\\s*,?\\s*(?:(?:comma|co\\.)\\s*${ARTICLE_ITEM}|(?:lett\\.?|lettera)\\s*\\p{L}\\)?|(?:n\\.?|numero)\\s*${ARTICLE_ITEM})`;
const ARTICLE_WITH_QUALIFIERS = `${ARTICLE_WORD}\\s*${ARTICLE_LIST}(?:${ARTICLE_QUALIFIER})*`;
const ARTICLE_JOIN = "\\s*(?:,\\s*(?:(?:e|ed)\\s+)?|(?:e|ed)\\s+)(?:l'\\s*|gli\\s+)?";
const ACT_LINK = "\\s*,?\\s*(?:(?:della|del|dell'|di\\s+cui\\s+(?:alla|al))\\s*)?";
/** The articles right before an act, up to it: matched against the text that ends where the act starts. */
const ARTICLES_BEFORE = new RegExp(`${ARTICLE_WITH_QUALIFIERS}(?:${ARTICLE_JOIN}${ARTICLE_WITH_QUALIFIERS})*${ACT_LINK}$`, 'u');

/** A code named by its name or abbreviation («Cost.», «c.c.», «cod. pen.», «codice»), or an act of the Union. */
const CODE_NAME =
  '(?<!\\p{L})(?:codice|cod\\.|costituzione|cost(?:\\.|(?!\\p{L}))|c\\.\\s*\\p{L}\\.|disp\\.|preleggi|regolamento|reg\\.|direttiva|dir\\.|tue|tfue|cdfue)';
/** Another act or a code right after an article: the article is that one's. */
const ANOTHER_ACT_NEXT = new RegExp(`^${ACT_LINK}(?:${TYPE_START}${ANY_ACT_TYPE}(?!\\p{L})|${CODE_NAME})`, 'u');

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

/**
 * Words a decision's citation may start with: the court, the section, the kind of decision. «c.»
 * alone is not one (it may be «comma»); «C. cost.» is.
 */
const DECISION_HEAD =
  '(?:cass|cassazione|corte|c\\.\\s*cost|cons|consiglio|tar|trib|tribunale|app|sent|sentenza|ord|ordinanza|sez|sezione|sezioni|s\\.\\s*u|ss\\.\\s*uu)(?!\\p{L})';
const QUERY_DECISION = new RegExp(
  `^(?<head>${DECISION_HEAD}[^/]*?[\\s.,]+)?(?<numberWord>${NUMBER_WORD})?(?<number>\\d+)\\s*(?:\\/\\s*(?<slashYear>\\d{4}|\\d{2})|,?\\s+del\\s+(?<delYear>\\d{4}))$`,
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

/**
 * A decision's number and year, read only with a court or a decision marker («Cass.», «sent.»,
 * «S.U.», «n.»), or bare as «N/YYYY» with a four-digit year: «12/12», «3/04» are not decisions.
 */
function readDecision(folded: string): QueryCitation | null {
  const m = QUERY_DECISION.exec(folded);
  if (!m?.groups) return null;
  const { head, numberWord, number, slashYear, delYear } = m.groups;
  if (!head && !numberWord && slashYear?.length !== 4) return null;
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

const ARTICLE_MENTION = new RegExp(`${ARTICLE_WORD}\\s*(${ARTICLE_LIST})`, 'gu');
const ARTICLE_AFTER = new RegExp(`^\\s*,?\\s*${ARTICLE_WORD}\\s*(${ARTICLE_LIST})(?:${ARTICLE_QUALIFIER})*`, 'u');

/**
 * The act's article written before it, linked to it by nothing but `ARTICLES_BEFORE`'s gap, or
 * right after it and not followed by another act or a code: the widened span, or null. Before the
 * act the span starts at the first of the linked articles that names `article`.
 */
function withArticle(folded: string, [start, end]: Span, article: string): Span | null {
  const from = Math.max(0, start - ARTICLE_REACH);
  const before = ARTICLES_BEFORE.exec(folded.slice(from, start));
  if (before) {
    const named = [...before[0].matchAll(ARTICLE_MENTION)].find((m) => listHas(m[1], article));
    if (named) return [from + before.index + (named.index ?? 0), end];
  }
  const rest = folded.slice(end);
  const after = ARTICLE_AFTER.exec(rest);
  if (after && listHas(after[1], article) && !ANOTHER_ACT_NEXT.test(rest.slice(after[0].length))) {
    return [start, end + after[0].length];
  }
  return null;
}

/** How far before an act type a longer type's name may begin («regio decreto-legge»). */
const OTHER_TYPE_REACH = 48;

/**
 * Whether the type at `[start, end)` is the tail of another type's name: «legge» in «decreto-legge»
 * or «regio decreto legge», «l.» in «d. l.». Read from the act-type table, every type alike.
 */
function insideAnotherType(folded: string, start: number, end: number, actType: string): boolean {
  const head = folded.slice(0, end);
  const from = Math.max(0, start - OTHER_TYPE_REACH);
  return ACT_TYPE_FORMS.some((f) => {
    if (f.actType === actType) return false;
    f.anywhere.lastIndex = from;
    for (let m = f.anywhere.exec(head); m && m.index < start; m = f.anywhere.exec(head)) {
      if (m.index + m[0].length >= end) return true;
    }
    return false;
  });
}

/** The spans naming an act of this type with this number and year: from the type to the number or year. */
function actTypeSpans(folded: string, forms: ActTypeForms, number: string, year: string): Span[] {
  const n = escapeRegExp(number);
  const re = new RegExp(
    `${TYPE_START}(?<type>${forms.source})\\s*,?\\s*` +
      numberYearSource({ numberA: n, numberB: n, slashYear: slashYearSource(year), delYear: year, dateYear: year }),
    'gu',
  );
  const spans: Span[] = [];
  for (const m of folded.matchAll(re)) {
    const start = m.index ?? 0;
    if (insideAnotherType(folded, start, start + (m.groups?.type.length ?? 0), forms.actType)) continue;
    spans.push([start, start + m[0].length]);
  }
  return spans;
}

function actSpans(folded: string, c: Extract<QueryCitation, { kind: 'act' }>): Span[] {
  const forms = ACT_TYPE_FORMS.find((f) => f.actType === c.actType);
  if (!forms) return [];
  const spans = actTypeSpans(folded, forms, c.number, c.year);
  const { article } = c;
  if (!article) return spans;
  return spans.flatMap((span) => {
    const widened = withArticle(folded, span, article);
    return widened ? [widened] : [];
  });
}

/**
 * A decision's number and year in every form; never where they belong to an act (any type in the
 * table), as in «legge n. 219 del 2017» for «n. 219/2017».
 */
function decisionSpans(folded: string, c: Extract<QueryCitation, { kind: 'decision' }>): Span[] {
  const re = new RegExp(
    `(?:(?<![\\p{L}\\p{N}])${NUMBER_WORD})?(?<![\\d/])(?<!\\d[.,])${escapeRegExp(c.number)}(?!\\d)\\s*` +
      `(?:\\/\\s*${slashYearSource(c.year)}|,?\\s+del\\s+(?:${DAY_MONTH})?${c.year})(?!\\d)`,
    'gu',
  );
  const acts = ACT_TYPE_FORMS.flatMap((forms) => actTypeSpans(folded, forms, c.number, c.year));
  return [...folded.matchAll(re)]
    .map((m): Span => [m.index ?? 0, (m.index ?? 0) + m[0].length])
    .filter(([s, e]) => !acts.some(([a, b]) => s < b && a < e));
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
  if (citation.kind === 'act') return actSpans(folded, citation);
  return decisionSpans(folded, citation);
}

/**
 * Two lists of matches as one: ordered by start, and overlapping matches joined into one (their
 * union), so the counter counts each place once.
 */
export function mergeMatches(a: readonly Span[], b: readonly Span[]): Span[] {
  const all = [...a, ...b].sort((x, y) => x[0] - y[0] || y[1] - x[1]);
  const out: Span[] = [];
  for (const [start, end] of all) {
    const last = out[out.length - 1];
    if (last && start < last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}
