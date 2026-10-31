/**
 * The marked corpus of spec 2026-10-29-document-analysis (§3.1) and its score (§3.3), in the web suite: the port of
 * the measuring sketch's `corpus.py` and `score.py`. The documents are invented from start to end.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CODES_TABLE } from '../../../../../utils/sources/actTypes';
import type { DocumentCitation } from '../../documentCandidates';

export interface Expected {
  start: number;
  end: number;
  text: string;
  act_type: string;
  act_number: string;
  date: string;
  articles: string[];
  /** `act`: an act named without an article; `ctx`: a bare article whose act the context gives; `out`: outside the sources. */
  flag: '' | 'act' | 'ctx' | 'out';
}

export interface CorpusDocument {
  name: string;
  text: string;
  expected: Expected[];
}

const MARK = /\[\[(.+?)\]\]/g;

/** `[[as written|act type|number|year|articles|flag]]` → the plain text and the expected citations. */
export function readMarked(source: string): { text: string; expected: Expected[] } {
  let text = '';
  let last = 0;
  const expected: Expected[] = [];
  for (const match of source.matchAll(MARK)) {
    text += source.slice(last, match.index);
    const [span, act_type, act_number, date, articles, flag = ''] = match[1].split('|');
    const start = text.length;
    text += span;
    expected.push({
      start, end: text.length, text: span, act_type, act_number, date,
      articles: articles.split(',').filter(Boolean), flag: flag as Expected['flag'],
    });
    last = match.index! + match[0].length;
  }
  return { text: text + source.slice(last), expected };
}

export function corpusDirectory(from: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'docs', 'superpowers', 'specs', '2026-10-29-document-analysis', 'corpus');
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) throw new Error('the corpus of spec 2026-10-29-document-analysis not found above ' + from);
  }
}

export function loadCorpus(from: string): CorpusDocument[] {
  const dir = corpusDirectory(from);
  return readdirSync(dir).filter((f) => f.endsWith('.txt')).sort().map((name) => ({
    name, ...readMarked(readFileSync(join(dir, name), 'utf8')),
  }));
}

const CODES = new Set([...Object.keys(CODES_TABLE).map((k) => k.toLowerCase()), 'tue', 'tfue', 'cdfue', 'cedu']);

/** An act: a code by its name, any other by type, number and year. */
function actKey(type?: string, number?: string, date?: string): string {
  const t = (type ?? '').toLowerCase().trim();
  if (CODES.has(t)) return `code:${t}`;
  return `${t}|${(number ?? '').trim()}|${(date ?? '').slice(0, 4)}`;
}

const sameArticle = (a?: string, b?: string) => (a ?? '').toLowerCase().replace(/\s/g, '') === (b ?? '').toLowerCase().replace(/\s/g, '');
const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

export interface Score {
  /** Article citations expected (each article of a list on its own). */
  total: number;
  found: number;
  inherited: number;
  wrong: number;
  incomplete: number;
  missed: number;
  /** Rows to complete that are no norm (a contract's clause): the user dismisses them. */
  toDismiss: number;
  /** Rows listed as norms where the corpus has none. */
  spurious: number;
  acts: number;
  actsFound: number;
  details: string[];
}

export function emptyScore(): Score {
  return { total: 0, found: 0, inherited: 0, wrong: 0, incomplete: 0, missed: 0, toDismiss: 0, spurious: 0, acts: 0, actsFound: 0, details: [] };
}

/** Scores one document's rows (and the acts the page read as context) against its marks. */
export function scoreDocument(
  doc: CorpusDocument,
  rows: readonly DocumentCitation[],
  contextActs: ReadonlyArray<{ start: number; end: number; act_type: string; act_number?: string; date?: string }>,
  score: Score,
): Score {
  const used = new Set<number>();
  for (const e of doc.expected) {
    if (e.flag === 'out') {
      rows.forEach((r, i) => { if (overlaps(e, r)) used.add(i); });
      continue;
    }
    const key = actKey(e.act_type, e.act_number, e.date);
    if (e.flag === 'act') {
      score.acts += 1;
      rows.forEach((r, i) => { if (overlaps(e, r)) used.add(i); });
      if (contextActs.some((a) => overlaps(e, a) && actKey(a.act_type, a.act_number, a.date) === key)) score.actsFound += 1;
      continue;
    }
    for (const article of e.articles) {
      score.total += 1;
      const over = rows.map((r, i) => [r, i] as const).filter(([r]) => overlaps(e, r));
      over.forEach(([, i]) => used.add(i));
      const same = over.map(([r]) => r).filter((r) => sameArticle(r.article, article));
      const ok = same.filter((r) => r.state !== 'incomplete' && actKey(r.act?.act_type, r.act?.act_number, r.act?.date) === key);
      if (ok.length) {
        score.found += 1;
        if (ok[0].state === 'inherited') score.inherited += 1;
      } else if (same.some((r) => r.state === 'incomplete')) {
        score.incomplete += 1;
        score.details.push(`${doc.name}: to complete «${e.text}» (art. ${article})`);
      } else if (over.some(([r]) => r.state !== 'incomplete')) {
        score.wrong += 1;
        score.details.push(`${doc.name}: WRONG «${e.text}» (art. ${article}) → ${over.map(([r]) => `${r.act?.act_type} ${r.act?.act_number ?? ''} ${r.act?.date ?? ''} art. ${r.article}`).join('; ')}`);
      } else {
        score.missed += 1;
        score.details.push(`${doc.name}: MISSED «${e.text}» (art. ${article})`);
      }
    }
  }
  rows.forEach((r, i) => {
    if (used.has(i)) return;
    const passage = doc.text.slice(r.start, r.end + 30).replace(/\s+/g, ' ');
    if (r.state === 'incomplete') {
      score.toDismiss += 1;
      score.details.push(`${doc.name}: to dismiss «${passage}»`);
    } else {
      score.spurious += 1;
      score.details.push(`${doc.name}: SPURIOUS «${passage}» → ${r.act?.act_type} ${r.act?.act_number ?? ''} art. ${r.article}`);
    }
  });
  return score;
}
