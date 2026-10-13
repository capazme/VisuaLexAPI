/**
 * A citation typed in the find window, and the spans of a text that name the same norm or
 * decision in another form (spec §13.2). `readQueryCitation` reads the query: a code's article,
 * a numbered act (with or without an article) or a decision's number and year, or `null` when the
 * query is not a citation and is searched literally only. `findCitationSpans` returns `[start,
 * end)` offsets of the original text: codes through `extractCitations` (the in-text reader of norm
 * links), numbered acts and decisions through patterns over `foldForSearch(text)`, which keeps
 * every offset (a code's article also across the words `extractCitations` does not read, blanked
 * first: «del c.c.», «primo comma», «e ss.»). A span covers the citation as written: from «art.» or
 * the act type to the year or the number; a decision cited date first, from its date to its number.
 * Pure and read-only: nothing here touches the DOM (root rule 23).
 */

import { ARTICLE_SUFFIX_ALTERNATION } from './articleSuffixes';
import { extractCitations, type CitationMatch } from './citationMatcher';
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

/** «decreto legislativo» → «decreto\s+legislativo»; a hyphen may take spaces («decreto- legge», «decreto - legge»). */
function nameSource(name: string): string {
  return escapeRegExp(name).replace(/\s+/g, '\\s+').replace(/-/g, '\\s*-\\s*');
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
/**
 * The date of a decision cited date first, up to its year: «12 aprile », «1° marzo », «12.4.», «12/04/»,
 * with a real month and a day of one or two digits (stricter than `DAY_MONTH`: a decision's date
 * is only read where the year is the query's, so the shape must be a date and nothing else).
 */
const DECISION_DAY = '(?:0?[1-9]|[12]\\d|3[01])';
const DECISION_DATE =
  `(?:${DECISION_DAY}[°º]?\\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\\s+` +
  `|${DECISION_DAY}\\s*[./-]\\s*(?:0?[1-9]|1[0-2])\\s*[./-]\\s*)`;
const ARTICLE_WORD = "(?<![\\p{L}\\p{N}])art(?:t|icol[oi])?\\.?";
const ARTICLE_ITEM = `\\d+(?:\\s*-?\\s*(?:${ARTICLE_SUFFIX_ALTERNATION})\\b)?`;
const ARTICLE_LIST = `${ARTICLE_ITEM}(?:\\s*(?:,|\\be\\b)\\s*${ARTICLE_ITEM})*`;
/** Spaces and at most one comma, in one way only (no backtracking over a long run of spaces). */
const SEP = '\\s*(?:,\\s*)?';
/** «primo comma», «ultimo comma», «secondo e terzo comma». */
const ORDINAL = '(?:primo|secondo|terzo|quarto|quinto|sesto|settimo|ottavo|nono|decimo|ultimo)';
const ORDINAL_COMMA = `${ORDINAL}(?:\\s*(?:,|\\be\\b)\\s*${ORDINAL})*\\s+comma(?!\\p{L})`;
/** «commi 2 e 3», «commi 2-4», «commi 1, 2 e 4»: a list of commi, which «comma» and «co.» do not take. */
const COMMI_LIST = `${ARTICLE_ITEM}(?:\\s*(?:[-\u2013,]|\\be\\b)\\s*${ARTICLE_ITEM})*`;
/** What names the comma of an article: «comma 2», «co. 2», «commi 2 e 3», «primo comma». */
const COMMA_REF = `(?:(?:comma|co\\.)\\s*${ARTICLE_ITEM}|commi\\s*${COMMI_LIST}|${ORDINAL_COMMA})`;
/** «e ss.», «e seguenti», «ss.»: the articles that follow the one named, which is not an article of its own. */
const AND_FOLLOWING = '(?:e\\s+)?(?:ss(?:\\.|(?!\\p{L}))|seguenti(?!\\p{L}))';
const LETTER_REF = '(?:lett\\.?|lettera)\\s*\\p{L}\\)?';
const COMMA_CLAUSE = `(?:${SEP}${AND_FOLLOWING})?(?:${SEP}${COMMA_REF})?(?:${SEP}${LETTER_REF})?`;
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
 * letter or number («, comma 2», «co. 2», «commi 2 e 3», «primo comma», «lett. b)», «n. 3», «numero
 * 3»), «e ss.», further articles of the same act («art. 1 e l'art. 2», «artt. 1, 2 e 3»), commas and
 * spaces, and «del», «della», «dell'», «di cui al», «di cui alla» before the act. Any other word, a
 * full stop or a semicolon breaks the link: the article is then not this act's.
 */
const ARTICLE_QUALIFIER = `${SEP}(?:${COMMA_REF}|${LETTER_REF}|(?:n\\.?|numero)\\s*${ARTICLE_ITEM}|${AND_FOLLOWING})`;
const ARTICLE_WITH_QUALIFIERS = `${ARTICLE_WORD}\\s*${ARTICLE_LIST}(?:${ARTICLE_QUALIFIER})*`;
/** «l'», «all'», «dell'» before an article («e dell'art. 2», «, all'art. 1»). */
const ARTICLE_PREFIX = "(?:(?:l|all|dell)'\\s*)";
const ARTICLE_JOIN = `\\s*(?:,\\s*(?:(?:e|ed)\\s+)?|(?:e|ed)\\s+)(?:${ARTICLE_PREFIX}|gli\\s+)?`;
const ACT_LINK = "\\s*,?\\s*(?:(?:della|del|dell'|di\\s+cui\\s+(?:alla|al))\\s*)?";
/** The articles right before an act, up to it: matched against the text that ends where the act starts. */
const ARTICLES_BEFORE = new RegExp(`${ARTICLE_WITH_QUALIFIERS}(?:${ARTICLE_JOIN}${ARTICLE_WITH_QUALIFIERS})*${ACT_LINK}$`, 'u');

/**
 * A code named by its name or abbreviation («Cost.», «c.c.», «cod. pen.», «codice»), an act of the
 * Union, a charter, a convention or a treaty («Carta», «CEDU», «Convenzione», «Trattato»).
 */
const CODE_NAME =
  '(?<!\\p{L})(?:codice|cod\\.|costituzione|cost(?:\\.|(?!\\p{L}))|c\\.\\s*\\p{L}\\.|disp\\.|preleggi|regolamento|reg\\.|direttiva|dir\\.|tue|tfue|cdfue|(?:carta|cedu|convenzione|trattato)(?!\\p{L}))';
/** Another act or a code right after an article: the article is that one's. */
const ANOTHER_ACT_NEXT = new RegExp(`^${ACT_LINK}(?:${TYPE_START}${ANY_ACT_TYPE}(?!\\p{L})|${CODE_NAME})`, 'u');

// ---------------------------------------------------------------------------
// Reading the query
// ---------------------------------------------------------------------------

const QUERY_ACT = new RegExp(
  `^(?:${ARTICLE_PREFIX}?${ARTICLE_WORD}\\s*(?<artBefore>${ARTICLE_ITEM})${COMMA_CLAUSE}\\s*,?\\s*${PREPOSITION})?` +
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

/** A decision cited date first: «Cass. 12 aprile 2018, n. 8980». The court is required; the number needs its «n.». */
const QUERY_DECISION_DATE_FIRST = new RegExp(
  `^(?<head>${DECISION_HEAD}[^/]*?[\\s.,]+)${DECISION_DATE}(?<year>\\d{4})\\s*(?:,\\s*)?${NUMBER_WORD}(?<number>\\d+)$`,
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

/** «art.13» → «art. 13»: `extractCitations` reads an article only with a space after the dot. */
const ARTICLE_DOT_DIGIT = /(?<![\p{L}\p{N}])art(?:t|icol[oi])?\.(?=\d)/giu;

/** `extractCitations` of `text` with «art.13» read as «art. 13», at the offsets of `text`. */
function extractSpaced(text: string): CitationMatch[] {
  const inserted: number[] = [];
  const spaced = text.replace(ARTICLE_DOT_DIGIT, (m: string, offset: number) => {
    inserted.push(offset + m.length + inserted.length);
    return `${m} `;
  });
  if (inserted.length === 0) return extractCitations(text);
  const back = (i: number) => i - inserted.filter((at) => at < i).length;
  return extractCitations(spaced).map((c) => ({ ...c, startIndex: back(c.startIndex), endIndex: back(c.endIndex), text: text.slice(back(c.startIndex), back(c.endIndex)) }));
}

function readCode(query: string, folded: string): QueryCitation | null {
  // A list of articles is not one citation: it is searched literally.
  if (/(?<!\p{L})(?:artt|articoli)(?!\p{L})/u.test(folded)) return null;
  const trimmed = query.trim().replace(ARTICLE_DOT_DIGIT, '$& ');
  // «art. 2043 del c.c.», «art. 2043, primo comma, c.c.»: read as the code's article, as in a text.
  for (const source of [trimmed, blankCodeLinks(trimmed, foldForSearch(trimmed))]) {
    const found = source ? extractCitations(source) : [];
    if (found.length !== 1) continue;
    const [c] = found;
    if (c.startIndex !== 0 || trimmed.slice(c.endIndex).replace(/[\s.,;:]/g, '') !== '') continue;
    if (c.parsed.act_number || c.parsed.date) continue;
    return { kind: 'code', code: c.parsed.act_type, article: c.parsed.article };
  }
  return null;
}

/**
 * «Cass. 12 aprile 2018, n. 8980» reads as number 8980 and year 2018. Never when an act's name stands
 * between the court and the date («Cass. … legge 12 aprile 2018, n. 8980»): that is an act's citation.
 */
function readDecisionDateFirst(folded: string): QueryCitation | null {
  const m = QUERY_DECISION_DATE_FIRST.exec(folded);
  if (!m?.groups || new RegExp(ACT_WORD, 'u').test(m.groups.head)) return null;
  return { kind: 'decision', number: m.groups.number, year: m.groups.year };
}

/**
 * A decision's number and year, read only with a court or a decision marker («Cass.», «sent.»,
 * «S.U.», «n.»), or bare as «N/YYYY» with a four-digit year: «12/12», «3/04» are not decisions.
 */
function readDecision(folded: string): QueryCitation | null {
  const m = QUERY_DECISION.exec(folded);
  if (!m?.groups) return readDecisionDateFirst(folded);
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
const ARTICLE_AFTER = new RegExp(`^\\s*,?\\s*${ARTICLE_PREFIX}?${ARTICLE_WORD}\\s*(${ARTICLE_LIST})(?:${ARTICLE_QUALIFIER})*`, 'u');

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
 * What names an act for a decision's number (spec §13.2): any form of a type in the tables, or
 * «decreto», «direttiva», «regolamento» («dir.», «reg.»), whole or ending with a dot («l.r.»).
 */
const ACT_WORD = `${TYPE_START}(?:${ANY_ACT_TYPE}|decreto|direttiva|dir\\.|regolamento|reg\\.)(?:(?<=\\.)|(?!\\p{L}))`;
/**
 * A word between an act's name and its number: «regionale», «reg.», «r.», «della», «Regione»,
 * «Friuli-Venezia», «(UE)». Never a court or a decision's marker: «la legge e Cass. n. …» is a decision.
 */
const ACT_NAME_WORD = `(?!${DECISION_HEAD})(?:\\p{L}+(?:-\\p{L}+)*(?!\\p{L})\\.?|\\(\\p{L}+\\))`;
/** Spaces and at most one comma, in one way only (no backtracking over a long run of spaces). */
const ACT_NAME_GAP = '\\s*(?:,\\s*)?';
/** How many such words: «legge della Provincia autonoma di Trento». */
const ACT_NAME_WORDS = 5;

/**
 * The citations of any act with this number and year: an act's name, up to `ACT_NAME_WORDS` words,
 * and the number and year («legge regionale n. 99 del 2015», «Reg. (UE) n. 99/2015», «decreto n.
 * 99 del 2015»). A decision's number is never found inside one.
 */
function anyActSpans(folded: string, number: string, year: string): Span[] {
  const n = escapeRegExp(number);
  const re = new RegExp(
    `${ACT_WORD}(?:${ACT_NAME_GAP}${ACT_NAME_WORD}){0,${ACT_NAME_WORDS}}${ACT_NAME_GAP}` +
      numberYearSource({ numberA: n, numberB: n, slashYear: slashYearSource(year), delYear: year, dateYear: year }),
    'gu',
  );
  return [...folded.matchAll(re)].map((m): Span => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
}

/**
 * The citations of every act in the text, whatever its number and year: `anyActSpans` for all numbers
 * at once, sorted by start. The decisions a text cites are never found inside one.
 */
export function allActSpans(folded: string): Span[] {
  const re = new RegExp(
    `${ACT_WORD}(?:${ACT_NAME_GAP}${ACT_NAME_WORD}){0,${ACT_NAME_WORDS}}${ACT_NAME_GAP}` +
      numberYearSource({ numberA: '\\d{1,6}', numberB: '\\d{1,6}', slashYear: '(?:\\d{4}|\\d{2})', delYear: '\\d{4}', dateYear: '\\d{4}' }),
    'gu',
  );
  return [...folded.matchAll(re)].map((m): Span => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
}

const overlapsAny = (spans: readonly Span[], [s, e]: Span): boolean => spans.some(([a, b]) => s < b && a < e);

/**
 * A decision cited date first («Cass., sez. III, 12 aprile 2018, n. 8980», «sent. 12.4.2018 n.
 * 8980»): the date, whose year is the query's, and the number, joined by a comma and spaces only. The
 * number is whole and bears no other year («n. 8980/2019», «n. 8980 del 2019» are not it).
 */
function decisionDateFirstSpans(folded: string, c: Extract<QueryCitation, { kind: 'decision' }>): Span[] {
  const re = new RegExp(
    `(?<![\\p{N}/.-])${DECISION_DATE}${c.year}(?!\\d)\\s*(?:,\\s*)?${NUMBER_WORD}${escapeRegExp(c.number)}(?!\\d)` +
      '(?!\\s*\\/\\s*\\d)(?!\\s*,?\\s+del\\s+\\d)',
    'gu',
  );
  return [...folded.matchAll(re)].map((m): Span => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
}

/** A decision's number and year in every form; never where they belong to an act (`anyActSpans`). */
function decisionSpans(folded: string, c: Extract<QueryCitation, { kind: 'decision' }>, acts: readonly Span[]): Span[] {
  const re = new RegExp(
    `(?:(?<![\\p{L}\\p{N}])${NUMBER_WORD})?(?<![\\d/])(?<!\\d[.,])${escapeRegExp(c.number)}(?!\\d)\\s*` +
      `(?:\\/\\s*${slashYearSource(c.year)}|,?\\s+del\\s+(?:${DAY_MONTH})?${c.year})(?!\\d)`,
    'gu',
  );
  const numberYear = [...folded.matchAll(re)].map((m): Span => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
  return [...numberYear, ...decisionDateFirstSpans(folded, c)]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .filter((span) => !overlapsAny(acts, span));
}

/**
 * The words `extractCitations` does not read between a code's article and the code: «del», «della»,
 * «dello», «dell'», the article's comma («primo comma», «commi 2 e 3»), «e ss.» (the reader takes
 * «art. 2043 c.c.», not «art. 2043 del c.c.»).
 */
const ARTICLE_THEN_LINKS = new RegExp(
  `^(${ARTICLE_WORD}\\s*${ARTICLE_LIST})((?:${ARTICLE_QUALIFIER})*${SEP}(?:(?:della|dello|del|dell')\\s*)?)`,
  'u',
);
const ARTICLE_WORD_EVERYWHERE = new RegExp(ARTICLE_WORD, 'gu');
/** How far after «art.» the words before a code may reach. */
const LINKS_REACH = 240;

/**
 * `text` with those words blanked to spaces, so that `extractCitations` reads «art. 2043 del c.c.»
 * as «art. 2043     c.c.» at the same offsets; `null` when no article has any. `folded` is
 * `foldForSearch(text)` (same length).
 */
function blankCodeLinks(text: string, folded: string): string | null {
  const ranges: Span[] = [];
  for (const article of folded.matchAll(ARTICLE_WORD_EVERYWHERE)) {
    const from = article.index ?? 0;
    const m = ARTICLE_THEN_LINKS.exec(folded.slice(from, from + LINKS_REACH));
    if (m && /\p{L}/u.test(m[2])) ranges.push([from + m[1].length, from + m[1].length + m[2].length]);
  }
  if (ranges.length === 0) return null;
  let out = '';
  let at = 0;
  for (const [start, end] of ranges) {
    out += text.slice(at, start) + ' '.repeat(end - start);
    at = end;
  }
  return out + text.slice(at);
}

/** «dell'», «all'»… that `extractCitations` reads with the article: the span starts at «art.». */
const LEADING_PREPOSITION = /^(?:dell?|dall?|all?|nell?|sull?)['’]/i;

/** A list read whole («artt. 2, 13 e 32 Cost.»): `extractCitations` names it by its first article only. */
const ARTICLE_LIST_HEAD = /^(?:\p{L}+['’])?(?:artt|articoli)(?!\p{L})/iu;

/**
 * A text as the citation search reads it: folded once (`foldForSearch`), its citations read once
 * (`extractCitations`, on first need). A caller searching the same text for every keystroke keeps
 * one per text (`useFindWindow`, per target) and passes it back.
 */
export interface CitationText {
  readonly text: string;
  readonly folded: string;
  citations?: CitationMatch[];
}

export function citationText(text: string, folded: string = foldForSearch(text)): CitationText {
  return { text, folded };
}

/**
 * The norm citations of a text: `extractCitations`, and what it reads once the words it does not know
 * are blanked (`blankCodeLinks`) where that gives a citation it did not give; its own reading wins.
 */
function textCitations(t: CitationText): CitationMatch[] {
  const own = extractSpaced(t.text);
  const blanked = blankCodeLinks(t.text, t.folded);
  if (!blanked) return own;
  const more = extractSpaced(blanked).filter((c) => !own.some((o) => c.startIndex < o.endIndex && o.startIndex < c.endIndex));
  return [...own, ...more].sort((a, b) => a.startIndex - b.startIndex);
}

function codeSpans(t: CitationText, c: Extract<QueryCitation, { kind: 'code' }>): Span[] {
  const code = c.code.toLowerCase();
  t.citations ??= textCitations(t);
  return t.citations
    .filter((m) => !m.parsed.act_number && m.parsed.act_type.toLowerCase() === code)
    .filter((m) => m.parsed.article === c.article || (ARTICLE_LIST_HEAD.test(m.text) && listHas(m.text, c.article)))
    .map((m) => [m.startIndex + (LEADING_PREPOSITION.exec(m.text)?.[0].length ?? 0), m.endIndex]);
}

/** Every span of the text naming the same norm or decision as `citation`, sorted, as `[start, end)` of the original text. */
export function findCitationSpans(text: string | CitationText, citation: QueryCitation): Span[] {
  const t = typeof text === 'string' ? citationText(text) : text;
  if (citation.kind === 'code') return codeSpans(t, citation);
  if (citation.kind === 'act') return actSpans(t.folded, citation);
  return decisionSpans(t.folded, citation, anyActSpans(t.folded, citation.number, citation.year));
}

const LETTER_DIGIT_OR_DOT = /[\p{L}\p{N}.]/u;
const LETTER = /\p{L}/u;

/**
 * Whether a literal match of a citation query stays: bounded as the citation's spans are (spec
 * §13.2). It never starts right after a letter, a digit or a dot, nor on an act type that is the
 * tail of another type's name («l. 34/2020» in «d. l. 34/2020»); with a final dot in the query it
 * never ends right before a letter («art. 1 c.p.» in «art. 1 c.p.c.»); for a decision it never
 * overlaps an act's citation («n. 219/2017» in «l. n. 219/2017»).
 */
function literalKept(folded: string, query: string, citation: QueryCitation, acts: readonly Span[]): (span: Span) => boolean {
  const endsWithDot = query.trim().endsWith('.');
  const forms = citation.kind === 'act' ? ACT_TYPE_FORMS.find((f) => f.actType === citation.actType) : undefined;
  const typeAt = forms ? new RegExp(forms.source, 'uy') : null;
  return ([start, end]) => {
    if (start > 0 && LETTER_DIGIT_OR_DOT.test(folded[start - 1])) return false;
    if (endsWithDot && end < folded.length && LETTER.test(folded[end])) return false;
    if (typeAt && forms) {
      typeAt.lastIndex = start;
      const type = typeAt.exec(folded);
      if (type && insideAnotherType(folded, start, start + type[0].length, forms.actType)) return false;
    }
    return !overlapsAny(acts, [start, end]);
  };
}

/**
 * What the find window shows for `query` on a text whose literal matches are `literal`
 * (`findMatches`, sorted): `null` when the query is not a citation (the literal matches stand as
 * they are); otherwise the literal matches bounded as the citation's spans are, and the spans,
 * merged (`mergeMatches`).
 */
export function matchesWithCitation(text: string | CitationText, query: string, literal: readonly Span[]): Span[] | null {
  const citation = readQueryCitation(query);
  if (!citation) return null;
  const t = typeof text === 'string' ? citationText(text) : text;
  const acts = citation.kind === 'decision' ? anyActSpans(t.folded, citation.number, citation.year) : [];
  const spans =
    citation.kind === 'decision'
      ? decisionSpans(t.folded, citation, acts)
      : findCitationSpans(t, citation);
  return mergeMatches(literal.filter(literalKept(t.folded, query, citation, acts)), spans);
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
