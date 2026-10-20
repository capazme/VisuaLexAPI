/**
 * The citations of a document, as «Analizza documento» lists them: grouped by the act they cite
 * («Codice civile · 4», «l. 241/1990 · 2»), each with its article and the passage around it.
 * Pure: the page reads the document and finds the citations (`extractCitations`), this only arranges them.
 */
import { formatCitationLabel, type CitationMatch } from '../../../utils/citationMatcher';
import { NAMED_HEADINGS, shortAct } from '../../../utils/sources';

/** What the list quotes around a citation: one line of the document at most, cut at a word. */
export interface CitedPassage {
  before: string;
  match: string;
  after: string;
  /** The line goes on beyond what is quoted: the list shows «…». */
  cutBefore: boolean;
  cutAfter: boolean;
}

export interface CitationEntry {
  /** The citation's position in the array `extractCitations` returned: the page's selection. */
  index: number;
  citation: CitationMatch;
  /** «art. 1453»: the act is the group's heading. */
  article: string;
  passage: CitedPassage;
}

export interface ActGroup {
  key: string;
  /** A code by its name («Codice civile»), any other act in little room («l. 241/1990»). */
  heading: string;
  entries: CitationEntry[];
}

/** Shown when nothing is found, as what the page recognises; `citationGroups.test.ts` checks each is found. */
export const RECOGNISED_EXAMPLES = ['art. 2043 c.c.', 'legge 241/1990 art. 3', 'regolamento (UE) 2016/679, art. 5'] as const;

const BEFORE = 48;
const AFTER = 80;

const words = (value: string): string => value.replace(/\s+/g, ' ');
const normalised = (value?: string): string => (value ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');

/**
 * An act is its type, its number and its year: «l. 241/90» and «legge 7 agosto 1990, n. 241» are one act,
 * whichever of the two the document wrote first.
 */
function actKey(citation: CitationMatch): string {
  const { act_type, act_number, date } = citation.parsed;
  const year = /^\d{4}/.exec((date ?? '').trim())?.[0] ?? '';
  return [normalised(act_type), (act_number ?? '').trim(), year].join('|');
}

function heading(citation: CitationMatch): string {
  const { act_type, act_number, date } = citation.parsed;
  return NAMED_HEADINGS[normalised(act_type)] ?? shortAct({ tipo_atto: act_type, numero_atto: act_number, data: date });
}

function articleLabel(citation: CitationMatch): string {
  const article = citation.parsed.article.trim();
  return article ? `art. ${article}` : formatCitationLabel(citation.parsed);
}

/**
 * The passage around `text[start, end)`, on its own line only: a run of spaces or a tab reads as one
 * space here, in the list. The document's own text is never changed (it is drawn as it is).
 */
export function citedPassage(text: string, start: number, end: number): CitedPassage {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const newline = text.indexOf('\n', end);
  const lineEnd = newline < 0 ? text.length : newline;

  const cutBefore = start - BEFORE > lineStart;
  let before = text.slice(cutBefore ? start - BEFORE : lineStart, start);
  if (cutBefore) before = before.replace(/^\S*\s+/, '');

  const cutAfter = end + AFTER < lineEnd;
  let after = text.slice(end, cutAfter ? end + AFTER : lineEnd);
  if (cutAfter) after = after.replace(/\s+\S*$/, '');

  return { before: words(before), match: words(text.slice(start, end)), after: words(after), cutBefore, cutAfter };
}

/** The citations by act, the acts in the order the document first cites them, each act's citations in the text's order. */
export function groupCitationsByAct(text: string, citations: readonly CitationMatch[]): ActGroup[] {
  const groups = new Map<string, ActGroup>();
  citations.forEach((citation, index) => {
    const key = actKey(citation);
    let group = groups.get(key);
    if (!group) {
      group = { key, heading: heading(citation), entries: [] };
      groups.set(key, group);
    }
    group.entries.push({
      index,
      citation,
      article: articleLabel(citation),
      passage: citedPassage(text, citation.startIndex, citation.endIndex),
    });
  });
  return Array.from(groups.values());
}

/** «12 citazioni in 5 atti», «1 citazione in 1 atto». */
export function citationCountLabel(citations: number, acts: number): string {
  return `${citations} ${citations === 1 ? 'citazione' : 'citazioni'} in ${acts} ${acts === 1 ? 'atto' : 'atti'}`;
}
