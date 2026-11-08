/**
 * «Analizza documento»: the citations of a document, found in the browser and read with the search's own reading
 * (design docs/superpowers/specs/2026-10-29-document-analysis-design.md §4). Pure: no request, no state.
 *
 * 1. **The vocabulary** (§4.2): the names that identify an act on their own («c.c.», «gdpr», «statuto dei
 *    lavoratori») — the server's `act_names`, or the client's own names when the server is silent — and the
 *    user's aliases.
 * 2. **Candidates** (§4.3): spans of the text, each with the query string a lawyer would type in the search bar
 *    for it; four kinds, claimed in this order, a character belonging to one candidate at most.
 * 3. **Resolution** (§4.4): each distinct query string read by the client parser (`readNormQuery`), the rest by
 *    `/parse_query_batch` (the caller asks: `documentServer.ts`).
 * 4. **Inheritance** (§4.6, G-402): a bare article takes an act named before only when the text ties it to one —
 *    «del medesimo decreto», «della stessa legge», «Reg. cit.», «ivi», «dello stesso art. 18»; otherwise it is to
 *    complete.
 * 5. **The fallback** (§4.7): for a candidate the server could not read, today's matcher's matches inside it.
 *
 * Every pattern reads a run of spaces in one way only (never two adjacent `\s*`), as the in-text matcher does
 * (`apps/web/CLAUDE.md`, gotcha on `euCitation.ts`): documents are long, and a quadratic pattern freezes the tab.
 */
import type { CustomAlias } from '../../../types';
import { ARTICLE_SUFFIX_ALTERNATION } from '../../../utils/articleSuffixes';
import { CLIENT_ACT_NAMES, isSearchReady, toApiArticleNumber, type ParsedCitation } from '../../../utils/citationParser';
import { extractCitations, type CitationMatch } from '../../../utils/citationMatcher';
import { EU_PAIR_SOURCE, buildEuHeadSource } from '../../../utils/euCitation';
import { citationFromServer, readNormQuery, type ServerNormReading } from '../../../utils/normQuery';
import { identifiesAct, isNumberedActType } from '../../../utils/sources/numberedActTypes';

/** A query string is at most this long (the server's own limit); a longer span is not a candidate. */
export const MAX_QUERY_LENGTH = 200;

// ── The vocabulary ───────────────────────────────────────────────────────────────────────────────────────────

/** The names a document's acts may be written with, as one pattern (`buildVocabulary`). */
export interface Vocabulary {
  /** The names, longest first, folded to lower case. */
  names: readonly string[];
  /** Built from the server's names (`true`) or from the client's own, because the server did not answer. */
  fromServer: boolean;
  /** The pattern source of one name, longest first; empty when there is none. */
  source: string;
  /**
   * What is sent for a name read in the text (by `spellingKey`): the vocabulary's own spelling, which the server's
   * tables know («St.lav.» is sent «st. lav.», §4.8), and for a user's shortcut its expansion («cdc» → «codice del
   * consumo»), which the store, not the parser, resolves.
   */
  spellings: ReadonlyMap<string, string>;
}

/** A name as written and as listed compare without case, spaces, or the apostrophe's shape. */
export const spellingKey = (value: string) => value.toLowerCase().replace(/\s+/g, '').replace(/’/g, "'");

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One name as a pattern: each word whole, any run of spaces between words, a dot followed by a space or not
 * («cod. civ.», «cod.civ.»), the apostrophe either way.
 */
function nameSource(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    // A dot inside a word may be followed by a space too: «c.c.» reads «c. c.».
    .map((word) => escapeRegExp(word).replace(/['’]/g, "['’]").replace(/\\\.(?=.)/g, '\\.\\s*'))
    .join('\\s+')
    .replace(/\\\.\\s\+/g, '\\.\\s*');
}

/**
 * The vocabulary of a page: the server's names (`/fetch_alias_catalog`'s `act_names`), or, when it did not answer,
 * the client's own act names; then the triggers of the user's aliases that name an act, as the search reads them.
 */
export function buildVocabulary(serverNames: readonly string[] | null, customAliases: readonly CustomAlias[] = []): Vocabulary {
  const names = new Set<string>();
  const spellings = new Map<string, string>();
  const add = (name: string, sent: string) => {
    names.add(name);
    if (!spellings.has(spellingKey(name))) spellings.set(spellingKey(name), sent);
  };
  // The user's own first: a trigger of theirs wins over a preset of the same spelling, as in the search.
  for (const alias of customAliases) {
    const folded = alias.trigger?.trim().toLowerCase();
    if (!folded || folded.length < 2) continue;
    if (alias.type === 'reference' && identifiesAct(alias.searchParams)) add(folded, folded);
    const expansion = alias.expandTo?.trim();
    if (alias.type === 'shortcut' && expansion && !isNumberedActType(expansion)) add(folded, expansion);
  }
  for (const name of serverNames ?? CLIENT_ACT_NAMES) {
    const folded = name.trim().toLowerCase();
    if (folded.length >= 2 && !/^\d+$/.test(folded)) add(folded, folded);
  }
  const sorted = [...names].sort((a, b) => b.length - a.length || a.localeCompare(b));
  return { names: sorted, fromServer: serverNames !== null, source: sorted.map(nameSource).join('|'), spellings };
}

// ── The patterns of a candidate ─────────────────────────────────────────────────────────────────────────────

const MONTHS = 'gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre';
/** «legge», «l.», «d.lgs.», «decreto legislativo», «d.l.», «decreto-legge», «d.P.R.», «r.d.», «d.m.», «d.p.c.m.», «l. cost.». */
const TYPE_WORD =
  'legge(?:\\s+costituzionale)?|l\\.\\s*cost\\.|l\\.|' +
  'd\\.\\s*lgs\\.?|dlgs|decreto\\s+legislativo|' +
  'd\\.\\s*l\\.|decreto[-\\s]legge|' +
  'd\\.\\s*p\\.\\s*c\\.\\s*m\\.|dpcm|d\\.\\s*p\\.\\s*r\\.|dpr|decreto\\s+del\\s+presidente\\s+della\\s+repubblica|' +
  'r\\.\\s*d\\.|regio\\s+decreto|d\\.\\s*m\\.|decreto\\s+ministeriale';
/** «7 agosto 1990», «1° settembre 1993», «7/8/1990». */
const DATE = `\\d{1,2}(?:\\s*[°º])?\\s+(?:${MONTHS})\\s+\\d{4}|\\d{1,2}\\/\\d{1,2}\\/\\d{4}`;
/** `N/YYYY`, `n. N/YY`, `n. N del YYYY`, `n. N del 7 agosto 1990`, `7 agosto 1990, n. N`, `7/8/1990, n. N`. */
const NUMBER_FORMS =
  '(?:n\\.\\s*)?\\d+\\s*\\/\\s*(?:\\d{4}|\\d{2})(?![\\d\\/])' +
  `|n\\.\\s*\\d+\\s+del\\s+(?:${DATE}|\\d{4})(?!\\d)` +
  `|(?:${DATE})\\s*(?:,\\s*)?n\\.\\s*\\d+(?!\\d)`;
const NUMBERED_ACT = `(?:${TYPE_WORD})\\s*(?:${NUMBER_FORMS})`;
const EU_ACT = `${buildEuHeadSource()}${EU_PAIR_SOURCE}(?!\\d)`;
/** Not inside a word, a number or an abbreviation. */
const NOT_AFTER_WORD = '(?<![\\p{L}\\p{N}_.])';
const NOT_BEFORE_WORD = '(?![\\p{L}\\p{N}])';
/** After a name: not inside a longer one either («c.c» is not read in «c.c.i.»). */
const NOT_BEFORE_NAME = '(?!\\.?[\\p{L}\\p{N}])';

const SUFFIX = `(?:\\s*(?:-\\s*)?(?:${ARTICLE_SUFFIX_ALTERNATION})\\b)?`;
/** «art.», «artt.», «articolo», «articoli», after a non-letter («l'art.»); «art» with no dot only before a digit. */
const ARTICLE_HEAD = new RegExp('(?<!\\p{L})(?:artt?\\.\\s*(?=\\d)|artt?\\s+(?=\\d)|articol[oi]\\s+(?=\\d))', 'giu');
/**
 * A number with its suffix, or a range («1362-1371»); never the head of a longer word or number («art. 15x»), nor a
 * number with «°», which is a comma's («art. 2697, 1° comma»).
 */
const ARTICLE_ITEM = new RegExp(`\\d+${SUFFIX}(?:\\s*-\\s*\\d+${SUFFIX})?(?![\\p{L}\\p{N}°º])`, 'yiu');
/** How far after a bare article an act may start and still make it «followed by something else». */
const NEAR_ACT_REACH = 40;
/** A list longer than this is not a citation a lawyer wrote: the numbers after it are left alone. */
const MAX_LIST_ITEMS = 60;
/** «, » or « e » between two numbers of a list. */
const LIST_JOIN = /\s*(?:,|e(?!\p{L}))\s*(?=\d)/yiu;
/** «e ss.», «e segg.», «e seguenti»: the list ends, its first article «e seguenti». */
const AND_FOLLOWING = /\s+e\s+(?:seguenti|segg|ss)\.?(?!\p{L})/yiu;
const ORDINAL = 'primo|secondo|terzo|quarto|quinto|sesto|settimo|ottavo|nono|decimo';
/** One clause after the list: read and kept for the row, never put in the query string. */
const CLAUSE = new RegExp(
  '\\s*(?:,\\s*)?(?:' +
    // «comma 2», «commi 1 e 2», «comma 1°», «comma primo», «par. 1»
    `(?:commi|comma|co\\.|parr\\.?|par\\.?|paragrafi|paragrafo)\\s*` +
      `(?:\\d+[°º]?${SUFFIX}(?:\\s*(?:,|e(?!\\p{L}))\\s*\\d+[°º]?${SUFFIX})*|(?:${ORDINAL})(?!\\p{L}))` +
    // «primo comma», «1° comma», «2° co.»
    `|(?:\\d+[°º]|${ORDINAL})\\s+(?:comma|co\\.)` +
    '|(?:lettere|lettera|lett\\.?)\\s*[a-z](?:\\.\\d+)?\\)?(?:\\s*(?:,|ed?(?!\\p{L}))\\s*[a-z]\\))*' +
    '|nn?\\.?\\s*\\d+' +
  ')(?!\\p{L})',
  'yiu',
);
/**
 * Between the article and the act after it: a comma or spaces, then «del», «della», …, «dell'». Never a line break: a
 * paragraph is a line (§4.6), and an act at the head of the next one is not this article's.
 */
const SEPARATOR = /(?=[^\S\n]|,)[^\S\n]*(?:,[^\S\n]*)?(?:(?:del|della|dello|dei|degli|delle)[^\S\n]+|dell['’][^\S\n]*)?/yiu;
/** Between an act and the article after it: «d.lgs. 196/2003, art. 7», «legge 241/1990 art. 3»; on one line. */
const ACT_ARTICLE_GAP = /[^\S\n]*(?:,[^\S\n]*)?/y;

/** §4.3: an act alone is context only when it is numbered or of the Union, or a name that opens with an act word. */
const CONTEXT_PHRASE = new RegExp(`^(?:${EU_ACT}|${NUMBERED_ACT})$`, 'iu');
const ACT_WORD = /^(?:codice|cod\.|legge|l\.|decreto|testo\s+unico|t\.\s*u\.|tu\s|regolamento|direttiva|statuto|disp\.|ordinamento)/iu;
// ── The words that tie a bare article to an act named before (§4.6, G-402) ──────────────────────────────────

/**
 * The kind of act a back-reference names: «del medesimo **decreto**», «della stessa **legge**», «**Reg.** cit.».
 * `any` for the words that name no kind («del medesimo **provvedimento**», «del medesimo»), «ivi», «ult. cit.».
 */
export type ActKind =
  | 'any' | 'decree' | 'legislative decree' | 'decree-law' | 'presidential decree' | 'ministerial decree'
  | 'prime minister decree' | 'law' | 'code' | 'consolidated text' | 'regulation' | 'directive' | 'constitution' | 'treaty';

/** The nouns a back-reference names, longest first, each with its kind. */
const KIND_NOUNS: ReadonlyArray<readonly [ActKind, string]> = [
  // «d.lgs» takes its dot whenever it has one: never «d.lgs» before «. n. 196», which would look like a noun alone.
  ['legislative decree', 'decreto\\s+legislativo|d\\.\\s*lgs(?:\\.|(?!\\.))|dlgs'],
  ['decree-law', 'decreto[-\\s]legge|d\\.\\s*l\\.'],
  ['presidential decree', 'decreto\\s+del\\s+presidente\\s+della\\s+repubblica|d\\.\\s*p\\.\\s*r\\.|dpr'],
  ['prime minister decree', 'd\\.\\s*p\\.\\s*c\\.\\s*m\\.|dpcm'],
  ['ministerial decree', 'decreto\\s+ministeriale|d\\.\\s*m\\.'],
  ['decree', 'decreto'],
  ['consolidated text', 'testo\\s+unico|t\\.\\s*u\\.'],
  ['any', 'testo\\s+normativo|provvedimento|articolato|testo|atto'],
  ['law', 'legge|l\\.'],
  ['code', 'codice|cod\\.'],
  ['regulation', 'regolamento|reg\\.'],
  ['directive', 'direttiva|dir\\.'],
  ['constitution', 'costituzione|cost\\.'],
  ['treaty', 'trattato'],
];
const KIND_NOUN = KIND_NOUNS.map(([, source]) => `(?:${source})`).join('|');
const KIND_OF_NOUN = KIND_NOUNS.map(([kind, source]) => [kind, new RegExp(`^(?:${source})$`, 'iu')] as const);
/** The kind a noun names; `any` for one of the general nouns. */
const kindOfNoun = (noun: string): ActKind =>
  KIND_OF_NOUN.find(([, pattern]) => pattern.test(noun.replace(/\s+/g, ' ')))?.[0] ?? 'any';
/** The first noun of a kind in an act as written: «l. fall.» is a law, «nuovo codice appalti» a code. */
const WRITTEN_NOUN = new RegExp(`(?<![\\p{L}.])(?=(${KIND_NOUN}))\\1(?!\\p{L})`, 'iu');
const DECREES: ReadonlySet<ActKind> = new Set([
  'decree', 'legislative decree', 'decree-law', 'presidential decree', 'ministerial decree', 'prime minister decree',
]);
/**
 * The word a lawyer uses for an act of each kind, whole or abbreviated: what, written in passing, may be another act of
 * it («la l.r. Lombardia 12/2005», «il reg. condominiale», «il cod. etico»).
 */
const DECREE_WORD = 'decret|d\\.\\s*(?:lgs|l|m|p\\.\\s*r|p\\.\\s*c\\.\\s*m)\\.?';
const KIND_WORD: Partial<Record<ActKind, string>> = {
  decree: DECREE_WORD, 'legislative decree': DECREE_WORD, 'decree-law': DECREE_WORD, 'presidential decree': DECREE_WORD,
  'ministerial decree': DECREE_WORD, 'prime minister decree': DECREE_WORD, law: 'legg|l\\.', code: 'codic|cod\\.',
  'consolidated text': 'testo\\s+unico|t\\.\\s*u\\.', regulation: 'regolament|reg\\.', directive: 'direttiv|dir\\.',
  constitution: 'costituzion|cost\\.', treaty: 'trattat',
};
/** «medesimo», «stessa», «citato», «predetta»…, and «cit.» after a preposition («del cit. decreto»). */
const SAME_WORD = '(?:medesim|stess|citat|predett|suddett|anzidett|ricordat|richiamat|menzionat)[oaie](?!\\p{L})';
const PREPOSITION = "(?:del|della|dello|dei|degli|delle)\\s+|dell['’]\\s*";
/**
 * A noun that goes on, on its line, with a number, a date or a bracket («del citato d.lgs. n. 196», «della medesima
 * legge 7 agosto 1990») names an act of its own, not one named before; nor is «la stessa legge regionale» a state law.
 * A full stop ends the noun: «della medesima legge.» then «7. Il provvedimento» on the next line is a back-reference.
 */
const NOT_AN_ACT_OF_ITS_OWN = '(?![^\\S\\n]*(?:n[.°º]|\\d|\\()|\\s+(?:regional|provincial|costituzional|delega|quadro|comunitari|europe))';
/**
 * What follows a bare article and ties it to an act named before:
 * - «del medesimo decreto», «della stessa legge», «del citato decreto-legge», «del predetto», «dello stesso testo»;
 * - «Reg. cit.», «della legge cit.», «d.lgs. ult. cit.»;
 * - «cit.» alone, or «citato», «stesso», «predetto» with no preposition («l'art. 13 citato»): the article cited
 *   before, with that citation's act.
 *
 * The noun is read whole (a lookahead, then the same text again): «del citato decreto legislativo 30 giugno 2003» is
 * never read as «del citato decreto», which the number after it would no longer rule out.
 */
const BACK_REFERENCE_AFTER = new RegExp(
  '^\\s*(?:,\\s*)?(?:' +
    // the noun after «medesimo»; a «medesimo» with no noun is followed by no word at all.
    `(?:(?<prep>${PREPOSITION})?${SAME_WORD}|(?<citPrep>${PREPOSITION})cit\\.)` +
      `(?:\\s*(?=(?<noun>${KIND_NOUN}))\\k<noun>(?!\\p{L})${NOT_AN_ACT_OF_ITS_OWN}|(?=\\s*(?:[^\\p{L}\\s]|$)))` +
    // the noun before «cit.»
    `|(?:${PREPOSITION})?(?=(?<citedNoun>${KIND_NOUN}))\\k<citedNoun>\\s*(?:ult\\.\\s*)?cit\\.` +
    // «ult. cit.» alone, «cit.» alone
    '|(?<ult>ult\\.\\s*)?cit\\.' +
  ')',
  'iu',
);
/** «(ivi, art. 30)»: right before the article, the place cited last. Never «ivi compreso l'art. 5». */
const IVI_BEFORE = /(?<!\p{L})ivi[^\S\n]*,?[^\S\n]*$/iu;
/** «dello stesso art. 18», «il citato art. 18»: right before the article, the article cited before. */
const SAME_ARTICLE_BEFORE = /(?<!\p{L})(?:medesim|stess|citat|predett|suddett|richiamat|ricordat)[oaie][^\S\n]+$/iu;

/** How the words around a bare article tie it to an act the text named before (§4.6). */
export interface BackReference {
  /** The kind of act the words name: the act inherited is the last one of that kind. */
  kind: ActKind;
  /** «dello stesso art. 18», «art. 18 cit.»: the act of the last citation of this very article. */
  sameArticle?: boolean;
}

/** The back-reference in the words after a bare article (`tail`); none if none. */
function referenceAfter(tail: string): (BackReference & { length: number }) | null {
  const match = BACK_REFERENCE_AFTER.exec(tail);
  const after = match?.groups;
  if (!match || !after) return null;
  const length = match[0].length;
  const noun = after.noun ?? after.citedNoun;
  if (noun) return { kind: kindOfNoun(noun), length };
  // «ult. cit.»: the act cited last; «cit.» alone, «citato» with no preposition: the article cited before.
  if (after.ult) return { kind: 'any', length };
  if (after.prep || after.citPrep) return { kind: 'any', length };
  return { kind: 'any', sameArticle: true, length };
}

/** The back-reference in the words right before a bare article, on its line (`before`); none if none. */
function referenceBefore(before: string): BackReference | null {
  if (IVI_BEFORE.test(before)) return { kind: 'any' };
  if (SAME_ARTICLE_BEFORE.test(before)) return { kind: 'any', sameArticle: true };
  return null;
}

/** The kind of an act as written, from its first noun of a kind; none when it has none («GDPR», «c.c.»). */
export function writtenKind(phrase: string): ActKind | null {
  const noun = WRITTEN_NOUN.exec(phrase)?.[1];
  return noun ? kindOfNoun(noun) : null;
}

/** An act written with a noun of kind `written` answers to a back-reference of kind `kind`. */
function fitsWrittenKind(kind: ActKind, written: ActKind | null): boolean {
  if (kind === 'any') return true;
  if (!written || written === 'any') return false;
  return written === kind || (kind === 'decree' && DECREES.has(written));
}

/** An act of this type answers to a back-reference of this kind. */
export function fitsKind(kind: ActKind, actType: string): boolean {
  const type = actType.toLowerCase();
  switch (kind) {
    case 'any': return true;
    case 'decree': return /(?:^|\s)decreto(?:\s|$)/.test(type);
    case 'legislative decree': return type.startsWith('decreto legislativo');
    case 'decree-law': return type === 'decreto legge' || type === 'regio decreto legge';
    case 'presidential decree': return type === 'decreto del presidente della repubblica';
    case 'ministerial decree': return type === 'decreto ministeriale';
    case 'prime minister decree': return type === 'decreto del presidente del consiglio dei ministri';
    case 'law': return type.startsWith('legge');
    case 'code': return type.startsWith('codice') || type.startsWith('codici');
    case 'consolidated text': return type.startsWith('testo unico') || /(?:^|\s)decreto(?:\s|$)/.test(type);
    case 'regulation': return type.startsWith('regolamento');
    case 'directive': return type.startsWith('direttiva');
    case 'constitution': return type === 'costituzione';
    case 'treaty': return type === 'tue' || type === 'tfue' || type.startsWith('trattato');
  }
}
/** «del contratto», «delle condizioni generali»: the article belongs to something the page could not read. */
const OF_SOMETHING = /^\s*(?:,\s*)?(?:(?:del|della|dello|dei|degli|delle)\s+|dell['’]\s*)\S/iu;
/** …or a capital, or an abbreviation of up to four letters with a dot («St.», «T.U.»). */
const SOMETHING_ELSE = /^\s*(?:,\s*)?(?:\p{Lu}|\p{Ll}{1,4}\.)/u;
/** What is shown after a bare article, «seguito da «del contratto»»: the preposition and one word. */
const FOLLOWED_BY = /^\s*(?:,\s*)?((?:(?:del|della|dello|dei|degli|delle)\s+|dell['’]\s*)?[^\s,;:()]+)/u;

/** The words after a bare article, a sentence's full stop left out («del contratto.»), an abbreviation's kept («St.»). */
function followedWords(tail: string): string {
  const words = FOLLOWED_BY.exec(tail)?.[1] ?? tail.trim().split(/\s+/)[0] ?? '';
  return /\p{L}{5,}\.$/u.test(words) ? words.slice(0, -1) : words;
}

function actPhrase(vocabulary: Vocabulary, flags: string): RegExp {
  const names = vocabulary.source ? `|(?:${vocabulary.source})${NOT_BEFORE_NAME}` : '';
  return new RegExp(`${NOT_AFTER_WORD}(?:${EU_ACT}|${NUMBERED_ACT}${NOT_BEFORE_WORD}${names})`, flags);
}

/**
 * The act patterns of a vocabulary, compiled once: with some 420 names each takes tens of milliseconds to build, and a
 * page builds the same vocabulary for every document. Keyed by the pattern's source; the last few are kept.
 */
const ACT_PATTERNS = new Map<string, { sticky: RegExp; global: RegExp; search: RegExp }>();
function actPatterns(vocabulary: Vocabulary) {
  let patterns = ACT_PATTERNS.get(vocabulary.source);
  if (!patterns) {
    patterns = { sticky: actPhrase(vocabulary, 'yiu'), global: actPhrase(vocabulary, 'giu'), search: actPhrase(vocabulary, 'iu') };
    if (ACT_PATTERNS.size >= 4) ACT_PATTERNS.delete(ACT_PATTERNS.keys().next().value!);
    ACT_PATTERNS.set(vocabulary.source, patterns);
  }
  return patterns;
}

// ── Candidates ───────────────────────────────────────────────────────────────────────────────────────────────

export type CandidateKind = 'article-act' | 'act-article' | 'act' | 'bare';

/** One article of a candidate's list, where its number stands. */
export interface CandidateArticle {
  /** In the API's form: «1223», «21-octies», «1362-1371». */
  article: string;
  start: number;
  end: number;
  /** «art. 167 e ss.»: the list closed with «e seguenti» on this, its only article. */
  following?: boolean;
}

export interface Candidate {
  kind: CandidateKind;
  start: number;
  end: number;
  /** The words a lawyer would type in the search bar for it; none for a bare article, which is never sent. */
  query: string | null;
  /** The act as written, for a candidate that names one: what a back-reference compares its noun with (§4.6). */
  actPhrase?: string;
  articles: CandidateArticle[];
  /** A bare article tied to an act named before («del medesimo decreto», «ivi», «Reg. cit.»): the only one inherited. */
  backReference?: BackReference;
  /**
   * Where the words of the back-reference after it end («l'art. 6 della medesima legge|»): an inherited row is
   * remembered from there, so that its own «legge» does not stop the next («; l'art. 7 della stessa legge»).
   */
  referenceEnd?: number;
  /** A bare article followed by something else («del contratto», a capital, «St.»): never inherited. */
  followedBy?: string;
}

interface ArticleRun {
  articles: CandidateArticle[];
  /** Where the list ends, «e ss.» included. */
  listEnd: number;
  /** Where its clauses end («, comma 2, lett. b)»). */
  end: number;
}

/** The list and the clauses after an article head that ends at `from`. */
function readArticleRun(text: string, from: number): ArticleRun | null {
  const articles: CandidateArticle[] = [];
  let at = from;
  for (;;) {
    ARTICLE_ITEM.lastIndex = at;
    const item = ARTICLE_ITEM.exec(text);
    if (!item) break;
    articles.push({ article: toApiArticleNumber(item[0]).toLowerCase(), start: item.index, end: item.index + item[0].length });
    at = item.index + item[0].length;
    if (articles.length >= MAX_LIST_ITEMS) break;
    LIST_JOIN.lastIndex = at;
    const join = LIST_JOIN.exec(text);
    if (!join) break;
    // Only a number after the joint makes it a joint: «art. 5, comma 2» stops here.
    ARTICLE_ITEM.lastIndex = join.index + join[0].length;
    if (!ARTICLE_ITEM.test(text)) break;
    at = join.index + join[0].length;
  }
  if (articles.length === 0) return null;
  AND_FOLLOWING.lastIndex = at;
  const following = AND_FOLLOWING.exec(text);
  if (following) {
    at = following.index + following[0].length;
    if (articles.length === 1) articles[0].following = true;
  }
  const listEnd = at;
  for (;;) {
    CLAUSE.lastIndex = at;
    const clause = CLAUSE.exec(text);
    if (!clause || clause[0].length === 0) break;
    at = clause.index + clause[0].length;
  }
  return { articles, listEnd, end: at };
}

const fold = (value: string) => value.replace(/\s+/g, ' ').trim();

/** The act as sent: a numbered or EU act as written, a name of the vocabulary in the vocabulary's spelling. */
function sentAct(vocabulary: Vocabulary, act: string): string {
  const written = fold(act);
  if (CONTEXT_PHRASE.test(written)) return written;
  const listed = vocabulary.spellings.get(spellingKey(written));
  // Written as listed but for the case («GDPR»): as written, the user's own words. Otherwise the listed spelling.
  return listed === undefined || listed.toLowerCase() === written.toLowerCase() ? written : listed;
}

/** The query string of an article with its act: «art. 7 e 8 legge 7 agosto 1990, n. 241». */
function articleQuery(vocabulary: Vocabulary, articles: readonly CandidateArticle[], act: string): string {
  return `art. ${articles.map((a) => a.article).join(' e ')} ${sentAct(vocabulary, act)}`;
}

/** §4.3's rule for an act named alone, and for an act before an article. */
function canBeContext(act: string): boolean {
  return CONTEXT_PHRASE.test(fold(act)) || ACT_WORD.test(fold(act));
}

/**
 * The candidates of a text (§4.3), in the order of the text: «article, then act», then «act, then article», then
 * «act alone», then «bare article», each kind claimed over the whole text before the next, a character belonging to
 * one candidate at most.
 */
export function findCandidates(text: string, vocabulary: Vocabulary): Candidate[] {
  const used = new Uint8Array(text.length);
  const free = (from: number, to: number) => {
    for (let i = from; i < to; i += 1) if (used[i]) return false;
    return true;
  };
  const take = (from: number, to: number) => used.fill(1, from, to);
  const candidates: Candidate[] = [];
  const { sticky: stickyAct, global: globalAct, search: nearAct } = actPatterns(vocabulary);

  const heads: Array<{ start: number; end: number; run: ArticleRun }> = [];
  ARTICLE_HEAD.lastIndex = 0;
  for (let head = ARTICLE_HEAD.exec(text); head; head = ARTICLE_HEAD.exec(text)) {
    const run = readArticleRun(text, head.index + head[0].length);
    if (run) heads.push({ start: head.index, end: head.index + head[0].length, run });
  }

  // «art. 7 della legge 7 agosto 1990, n. 241», «art. 82 GDPR».
  for (const { start, run } of heads) {
    if (!free(start, run.end)) continue;
    SEPARATOR.lastIndex = run.end;
    const separator = SEPARATOR.exec(text);
    if (!separator) continue;
    stickyAct.lastIndex = separator.index + separator[0].length;
    const act = stickyAct.exec(text);
    if (!act) continue;
    const end = act.index + act[0].length;
    const query = articleQuery(vocabulary, run.articles, act[0]);
    if (query.length > MAX_QUERY_LENGTH || !free(start, end)) continue;
    candidates.push({ kind: 'article-act', start, end, query, actPhrase: fold(act[0]), articles: run.articles });
    take(start, end);
  }

  const headAt = new Map(heads.map((head) => [head.start, head]));
  const acts: Array<{ start: number; end: number; phrase: string }> = [];
  globalAct.lastIndex = 0;
  for (let act = globalAct.exec(text); act; act = globalAct.exec(text)) {
    if (act[0].length === 0) { globalAct.lastIndex += 1; continue; }
    const end = act.index + act[0].length;
    if (!free(act.index, end)) {
      // An act that overlaps a candidate may hide one that starts inside it: look again one character on.
      globalAct.lastIndex = act.index + 1;
      continue;
    }
    acts.push({ start: act.index, end, phrase: act[0] });
  }

  // «d.lgs. 196/2003, art. 7»: the act held to the context rule, and not «…, art. 3 della relazione».
  for (const act of acts) {
    ACT_ARTICLE_GAP.lastIndex = act.end;
    const gap = ACT_ARTICLE_GAP.exec(text);
    const head = headAt.get(act.end + (gap ? gap[0].length : 0));
    if (!head || !canBeContext(act.phrase)) continue;
    if (OF_SOMETHING.test(text.slice(head.run.end, head.run.end + 60))) continue;
    const query = articleQuery(vocabulary, head.run.articles, act.phrase);
    if (query.length > MAX_QUERY_LENGTH || !free(act.start, head.run.end)) continue;
    candidates.push({ kind: 'act-article', start: act.start, end: head.run.end, query, actPhrase: fold(act.phrase), articles: head.run.articles });
    take(act.start, head.run.end);
  }

  // «Regolamento (UE) 2016/679», «statuto dei lavoratori»: context for the bare articles after it.
  for (const act of acts) {
    if (!free(act.start, act.end) || !canBeContext(act.phrase)) continue;
    const query = sentAct(vocabulary, act.phrase);
    if (query.length > MAX_QUERY_LENGTH) continue;
    candidates.push({ kind: 'act', start: act.start, end: act.end, query, actPhrase: fold(act.phrase), articles: [] });
    take(act.start, act.end);
  }

  // «l'art. 21-octies, comma 2»: never sent.
  for (const { start, run } of heads) {
    if (!free(start, run.end)) continue;
    const tail = text.slice(run.end, run.end + 60);
    // The words right before it, on its line: «(ivi, art. 30)», «dello stesso art. 18».
    const before = text.slice(Math.max(0, start - 30), start);
    const after = referenceAfter(tail);
    // An act a few words on, on the same line and before a «;», is this article's even when the words between could
    // not be read («art. 18, ottavo e nono comma, della legge …»): never another act's by inheritance.
    const line = text.slice(run.end, run.end + NEAR_ACT_REACH + MAX_QUERY_LENGTH).split(/[;\n]/)[0];
    const found = after ? null : nearAct.exec(line);
    const near = found && found.index <= NEAR_ACT_REACH ? found : null;
    const other = !after && (OF_SOMETHING.test(tail) || SOMETHING_ELSE.test(tail) || near !== null);
    // The words before count only when nothing after names something else: «il citato art. 2 del contratto», «ivi,
    // art. 30 del regolamento condominiale» are the contract's and the regulation's.
    const reference = after ?? (other ? null : referenceBefore(before.slice(before.lastIndexOf('\n') + 1)));
    candidates.push({
      kind: 'bare', start, end: run.end, query: null, articles: run.articles,
      ...(reference ? { backReference: { kind: reference.kind, ...(reference.sameArticle ? { sameArticle: true } : {}) } } : {}),
      ...(after ? { referenceEnd: run.end + after.length } : {}),
      ...(other ? { followedBy: near && !OF_SOMETHING.test(tail) && !SOMETHING_ELSE.test(tail) ? fold(near[0]) : followedWords(tail) } : {}),
    });
    take(start, run.end);
  }

  return candidates.sort((a, b) => a.start - b.start);
}

// ── Resolution ──────────────────────────────────────────────────────────────────────────────────────────────

/** The distinct query strings of the candidates, in the order the text first writes them. */
export function candidateQueries(candidates: readonly Candidate[]): string[] {
  return [...new Set(candidates.flatMap((c) => (c.query ? [c.query] : [])))];
}

/** A candidate's reading is enough: it identifies the act, and for a candidate with articles it can be searched. */
function settles(reading: ParsedCitation | null, withArticles: boolean): boolean {
  return withArticles ? isSearchReady(reading) : identifiesAct(reading);
}

/**
 * The client half (§4.4 point 3): the readings of the client parser, with the user's aliases, that already settle
 * their candidate. What it leaves out goes to the server.
 */
export function readOnClient(candidates: readonly Candidate[], customAliases: CustomAlias[] = []): Map<string, ParsedCitation> {
  const settled = new Map<string, ParsedCitation>();
  for (const candidate of candidates) {
    if (!candidate.query || settled.has(candidate.query)) continue;
    const { citation } = readNormQuery(candidate.query, customAliases);
    if (settles(citation, candidate.articles.length > 0)) settled.set(candidate.query, citation!);
  }
  return settled;
}

/** The server's answers that settle their candidate, by query string. */
export function settledByServer(candidates: readonly Candidate[], answers: ReadonlyMap<string, ServerNormReading>): Map<string, ParsedCitation> {
  const settled = new Map<string, ParsedCitation>();
  for (const candidate of candidates) {
    if (!candidate.query || settled.has(candidate.query)) continue;
    const answer = answers.get(candidate.query);
    if (!answer) continue;
    const citation = citationFromServer(answer);
    if (settles(citation, candidate.articles.length > 0)) settled.set(candidate.query, citation!);
  }
  return settled;
}

// ── The citations ───────────────────────────────────────────────────────────────────────────────────────────

export type CitationState = 'resolved' | 'inherited' | 'incomplete';

/** One row of the page: one article, where it stands in the text, and the act it was given. */
export interface DocumentCitation {
  /** The mark: for a list, each article on its own number, the first with the head, the last with the act. */
  start: number;
  end: number;
  article: string;
  /** «art. 167 e ss.». */
  following?: boolean;
  state: CitationState;
  /** The act, for a resolved or an inherited row. */
  act?: { act_type: string; act_number?: string; date?: string; annex?: string };
  /** Resolved by the browser's own matcher because the server did not answer (§4.7). */
  fallback?: boolean;
  /** The query string of an explicit candidate the page could not read; none for a bare article. */
  query?: string;
  /** A bare article followed by something else: «del contratto». */
  followedBy?: string;
}

export interface DocumentAnalysis {
  citations: DocumentCitation[];
  /** Some candidates were left to the browser because the server or the catalog did not answer. */
  degraded: boolean;
  /**
   * The acts named alone that the readings settled («Regolamento (UE) 2016/679»), where they stand: the context of the
   * bare articles, and the acts the picker offers first (#376 §5.3).
   */
  actsNamed?: Array<{ start: number; act: NonNullable<DocumentCitation['act']> }>;
  /** Read with «Riconosci solo nel browser» on: nothing was asked of the server (#376 §6.3). */
  local?: boolean;
}

/** The readings the resolution gathered: the client's and the server's, each settling its query. */
export interface Readings {
  /** query → the reading that settles it. */
  settled: ReadonlyMap<string, ParsedCitation>;
  /** The queries the server was asked about and did not answer (an error, a timeout, a refusal). */
  unanswered: ReadonlySet<string>;
}

function actOf(reading: ParsedCitation): NonNullable<DocumentCitation['act']> {
  return {
    act_type: reading.act_type!,
    ...(reading.act_number ? { act_number: reading.act_number } : {}),
    ...(reading.date ? { date: reading.date } : {}),
    ...(reading.annex ? { annex: reading.annex } : {}),
  };
}

/** The marks of a candidate's articles: the first from the candidate's start, the last to its end (§4.5). */
function marks(candidate: Candidate): Array<{ start: number; end: number; item: CandidateArticle }> {
  const items = candidate.articles;
  if (items.length === 1) return [{ start: candidate.start, end: candidate.end, item: items[0] }];
  return items.map((item, i) => ({
    start: i === 0 ? candidate.start : item.start,
    end: i === items.length - 1 ? candidate.end : item.end,
    item,
  }));
}

/** How many acts read before a bare article it may look back on: a reference further back is to complete. */
const HISTORY = 64;

/** An act read before, with the articles cited of it there and its paragraph: what a back-reference looks for. */
interface ReadAct {
  act: NonNullable<DocumentCitation['act']>;
  /** The kind its own words name («l. fall.» a law, «nuovo codice appalti» a code), whatever the server's type. */
  written: ActKind | null;
  articles: readonly string[];
  line: number;
  /** Where its citation ends in the text. */
  end: number;
}

const sameActAs = (a: ReadAct['act'], b: ReadAct['act']) =>
  a.act_type.toLowerCase() === b.act_type.toLowerCase() && a.act_number === b.act_number && a.date === b.date && a.annex === b.annex;

/** Acts that are never another kind's under a name: the Costituzione, the Treaties, the Charter. */
const ONLY_ITSELF = new Set(['costituzione', 'tue', 'tfue', 'cdfue']);

/** An act a kind search may not pass over: its words say no kind, it has no number, or it is a code (§4.6). */
function mayBeOfAnyKind({ act, written }: ReadAct): boolean {
  const type = act.act_type.toLowerCase();
  if (ONLY_ITSELF.has(type)) return false;
  return written === null || written === 'any' || !act.act_number || type.startsWith('codice') || written === 'code';
}

/**
 * The act a back-reference names: the last one of its kind (by the server's type or by its own words), or the last
 * cited with this very article. None when:
 * - nothing fits;
 * - the search would pass over an act whose own words do not say its kind («c.c.», «jobs act», «tusl»), an act with no
 *   number, or a code: each may well be of the kind under another name (the Codice privacy is a legislative decree,
 *   the jobs act a law);
 * - the paragraph of the act found names another that fits as well («l'art. 5 del d.lgs. 28/2010, come modificato dal
 *   d.lgs. 149/2022 … l'art. 12-bis del medesimo decreto»): the words could mean either;
 * - the word of the kind is written, outside any citation, between the act found and the article («il regolamento
 *   condominiale, all'art. 5 del medesimo regolamento»): it may be that one, which the page cannot read.
 */
function referredAct(
  history: readonly ReadAct[], reference: BackReference, articles: readonly CandidateArticle[],
  mentioned: (kind: ActKind, from: number) => boolean,
) {
  const byKind = !reference.sameArticle && reference.kind !== 'any';
  const fits = ({ act, written, articles: cited }: ReadAct) => (reference.sameArticle
    ? articles.every((a) => cited.includes(a.article))
    : fitsKind(reference.kind, act.act_type) || fitsWrittenKind(reference.kind, written));
  let found = -1;
  for (let i = history.length - 1; i >= 0 && found < 0; i -= 1) {
    if (fits(history[i])) found = i;
    else if (byKind && mayBeOfAnyKind(history[i])) return null;
  }
  if (found < 0) return null;
  const { act, line, end } = history[found];
  if (history.some((other) => other.line === line && fits(other) && !sameActAs(other.act, act))) return null;
  if (byKind && mentioned(reference.kind, end)) return null;
  return history[found];
}

/**
 * The rows of a document (§4.4–§4.7), in the order of the text: what the readings settle is resolved; a bare
 * article the text ties to an act named before («del medesimo decreto», «ivi», «Reg. cit.») inherits that act; a
 * candidate the server did not answer keeps the browser matcher's matches inside it; the rest is to complete.
 *
 * Inheritance is never a guess (G-402): a bare article with no such words is to complete, even right after an act.
 * The words choose the act: the last read of the kind they name («del citato decreto-legge»), or the last cited with
 * the same article («dello stesso art. 18», «art. 18 cit.»). Two things end what may be referred to: a candidate
 * that names an act the page could not read, and a bare article followed by something else («del contratto»).
 */
export function settleCitations(text: string, candidates: readonly Candidate[], readings: Readings): DocumentAnalysis {
  const citations: DocumentCitation[] = [];
  let history: ReadAct[] = [];
  let line = 0;
  let counted = 0;
  const lineAt = (position: number) => {
    for (let i = text.indexOf('\n', counted); i !== -1 && i < position; i = text.indexOf('\n', i + 1)) line += 1;
    counted = Math.max(counted, position);
    return line;
  };
  const remember = (act: ReadAct['act'], written: ActKind | null, candidate: Candidate, at: number) => {
    const end = Math.max(candidate.end, candidate.referenceEnd ?? 0);
    history.push({ act, written, articles: candidate.articles.map((a) => a.article), line: at, end });
    if (history.length > HISTORY) history = history.slice(-HISTORY);
  };
  // Where the word of each kind is written outside every candidate, found once per kind when first asked.
  const words = new Map<string, number[]>();
  const outside = (position: number) => {
    let low = 0;
    let high = candidates.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (candidates[middle].start <= position) low = middle + 1;
      else high = middle - 1;
    }
    return high < 0 || position >= candidates[high].end;
  };
  /** The word of `kind` is written, outside any candidate, after `from` and before `to`. */
  const mentionedBetween = (kind: ActKind, from: number, to: number) => {
    const stem = KIND_WORD[kind];
    if (!stem) return false;
    let positions = words.get(stem);
    if (!positions) {
      positions = [...text.matchAll(new RegExp(`(?<!\\p{L})(?:${stem})`, 'giu'))].map((m) => m.index).filter(outside);
      words.set(stem, positions);
    }
    let low = 0;
    let high = positions.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (positions[middle] < from) low = middle + 1;
      else high = middle;
    }
    return low < positions.length && positions[low] < to;
  };
  let fallbackMatches: CitationMatch[] | null = null;
  let degraded = false;
  const actsNamed: NonNullable<DocumentAnalysis['actsNamed']> = [];

  for (const candidate of candidates) {
    const at = lineAt(candidate.start);
    if (candidate.query) {
      const reading = readings.settled.get(candidate.query);
      if (reading) {
        const act = actOf(reading);
        remember(act, candidate.actPhrase ? writtenKind(candidate.actPhrase) : null, candidate, at);
        if (candidate.kind === 'act') actsNamed.push({ start: candidate.start, act });
        for (const { start, end, item } of marks(candidate)) {
          citations.push({ start, end, article: item.article, ...(item.following ? { following: true } : {}), state: 'resolved', act });
        }
        continue;
      }
      history = [];
      if (readings.unanswered.has(candidate.query)) {
        degraded = true;
        fallbackMatches ??= extractCitations(text);
        const inside = fallbackMatches.filter((m) => m.startIndex >= candidate.start && m.endIndex <= candidate.end);
        if (inside.length > 0 || candidate.articles.length === 0) {
          for (const match of inside) {
            const { act_type, act_number, date, article } = match.parsed;
            citations.push({
              start: match.startIndex, end: match.endIndex, article, state: 'resolved', fallback: true,
              act: { act_type, ...(act_number ? { act_number } : {}), ...(date ? { date } : {}) },
            });
          }
          continue;
        }
      }
      for (const { start, end, item } of marks(candidate)) {
        citations.push({ start, end, article: item.article, ...(item.following ? { following: true } : {}), state: 'incomplete', query: candidate.query });
      }
      continue;
    }

    // A bare article.
    const reference = candidate.backReference;
    const referred = reference
      ? referredAct(history, reference, candidate.articles, (kind, from) => mentionedBetween(kind, from, candidate.start))
      : null;
    const inherits = referred?.act ?? null;
    if (candidate.followedBy) history = [];
    if (referred) remember(referred.act, referred.written, candidate, at);
    for (const { start, end, item } of marks(candidate)) {
      citations.push({
        start, end, article: item.article,
        ...(item.following ? { following: true } : {}),
        ...(inherits ? { state: 'inherited' as const, act: inherits } : { state: 'incomplete' as const }),
        ...(candidate.followedBy ? { followedBy: candidate.followedBy } : {}),
      });
    }
  }

  citations.sort((a, b) => a.start - b.start);
  return { citations, degraded, actsNamed };
}

/** The rows the list shows today (resolved and inherited) in the matcher's shape, which the list and the text draw. */
export function listedMatches(text: string, citations: readonly DocumentCitation[]): CitationMatch[] {
  return citations.flatMap((citation) => {
    if (citation.state === 'incomplete' || !citation.act) return [];
    const { act_type, act_number, date, annex } = citation.act;
    return [{
      text: text.slice(citation.start, citation.end),
      startIndex: citation.start,
      endIndex: citation.end,
      parsed: {
        act_type, article: citation.article, confidence: 0.9,
        ...(act_number ? { act_number } : {}), ...(date ? { date } : {}), ...(annex ? { annex } : {}),
        ...(citation.following ? { following: true } : {}),
      },
      cacheKey: [act_type, act_number ?? '', date ?? '', annex ?? '', citation.article].join('::'),
    }];
  });
}

// ── The whole path ──────────────────────────────────────────────────────────────────────────────────────────

export interface AnalysisRun {
  analysis: DocumentAnalysis;
  /** Every answer the server gave for this document, kept so «Riprova» asks only for the rest. */
  answers: Map<string, ServerNormReading>;
}

/**
 * A document's citations, from its text to its rows: the vocabulary (the server's names, or the client's when
 * `serverNames` is null), the candidates, the client's readings, the server's for the rest through `ask` (given the
 * strings not already in `known`), the rows. The page's one call; pure but for `ask`.
 */
export async function analyseDocument(
  text: string,
  options: {
    serverNames: readonly string[] | null;
    customAliases?: CustomAlias[];
    known?: ReadonlyMap<string, ServerNormReading>;
    ask: (queries: string[]) => Promise<{ answers: ReadonlyMap<string, ServerNormReading>; unanswered: readonly string[] }>;
    /**
     * «Riconosci solo nel browser» (#376 §6.3, Q3): nothing is asked; what the client parser cannot settle is read by the
     * browser's own matcher inside its candidate, as when the server is silent (§4.7), but by choice — not «degraded».
     */
    localOnly?: boolean;
  },
): Promise<AnalysisRun> {
  const vocabulary = buildVocabulary(options.serverNames, options.customAliases);
  const candidates = findCandidates(text, vocabulary);
  const client = readOnClient(candidates, options.customAliases);
  const answers = new Map(options.known ?? []);
  const toAsk = candidateQueries(candidates).filter((query) => !client.has(query) && !answers.has(query));
  let unanswered: readonly string[] = [];
  if (options.localOnly) {
    unanswered = toAsk;
  } else if (toAsk.length > 0) {
    const reading = await options.ask(toAsk);
    reading.answers.forEach((answer, query) => answers.set(query, answer));
    unanswered = reading.unanswered;
  }
  const settled = new Map([...settledByServer(candidates, answers), ...client]);
  const analysis = settleCitations(text, candidates, { settled, unanswered: new Set(unanswered) });
  if (options.localOnly) return { analysis: { ...analysis, degraded: false, local: true }, answers };
  return { analysis: { ...analysis, degraded: analysis.degraded || !vocabulary.fromServer }, answers };
}
