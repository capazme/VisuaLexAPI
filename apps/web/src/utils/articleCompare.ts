/**
 * Two articles compared comma by comma — a model, no markup.
 *
 * The reading surface draws `article_text` through ranges over the untouched
 * string (CLAUDE.md gotcha 23); this module speaks the same language. A unit is
 * a range of the text, a word-diff mark is a range of the text, and the view
 * wraps characters that are already there: nothing here builds a new string
 * that is shown as the article.
 *
 * Two kinds of comparison (spec D1): the same article in two versions, whose
 * commi are paired, labelled and word-diffed; and two different articles, whose
 * commi are only set side by side. See
 * docs/superpowers/specs/2026-10-13-compare-articles-design.md.
 */
import type { ArticleData } from '../types';
import { buildItemKey } from './normaKeys';
import { shortNorm } from './sources';
import { parseArticleStructure, type ArticleStructure, type InlineDecoration, type TextRange } from './articleStructure';
import { requestedVersion, versionKey, versionLabel, versionTabSuffix, type VersionRequest } from './versionDisplay';

export type CompareKind = 'versions' | 'articles';
export type CompareSide = 'left' | 'right';
export type CompareLabel = 'invariato' | 'modificato' | 'riscritto' | 'aggiunto' | 'abrogato';

/** A comma with its items, or the rubric: a range of the article's `article_text`. */
export interface CompareUnit extends TextRange {
  kind: 'comma' | 'rubric';
  /** The printed number, normalised ("1", "1-bis", "4.1"); null when the text prints none. */
  number: string | null;
  /** The item blocks inside the range. */
  items: TextRange[];
}

/**
 * The words that differ inside a «modificato» comma, as ranges of each side's
 * text. On the older side they are the deleted words, on the newer side the
 * inserted ones; a run of changed words is one range.
 */
export interface WordDiff {
  left: TextRange[];
  right: TextRange[];
}

export interface CompareRow {
  left?: CompareUnit;
  right?: CompareUnit;
  /** Versions only. */
  label?: CompareLabel;
  /** «modificato» only. */
  diff?: WordDiff;
  /**
   * The comma would have been «modificato» but a side is over `DIFF_WORD_CAP` words: it counts as
   * «riscritto» and the view says «troppo lungo per il confronto parola per parola».
   */
  tooLong?: true;
}

export interface ComparisonSummary {
  kind: CompareKind;
  older: CompareSide;
  /** Versions: how many commi carry each label (the rubric is apart). */
  counts: Record<CompareLabel, number>;
  /** Versions only: the rubric's label, when either side has one. */
  rubric?: CompareLabel;
  /** Commi on each side. */
  commi: Record<CompareSide, number>;
  /** Each side in words: «testo al 31 dicembre 2015» (versions), «art. 2043 c.c.» (two articles). */
  labels: Record<CompareSide, string>;
}

export interface ArticleComparison {
  kind: CompareKind;
  /** The side holding the older text; `left` for two articles. */
  older: CompareSide;
  rubric?: CompareRow;
  rows: CompareRow[];
  summary: ComparisonSummary;
}

/**
 * Words a «modificato» comma may have, either side, for its diff to be drawn.
 * The diff is a table of m x n cells (Uint32): at 600 words 361 000 cells, about
 * 1.4 MB and a few milliseconds, where a comma of 5 000 words would take 100 MB.
 * Real commi stay far below (the longest in the fixtures, d.lgs. 196/2003
 * art. 2-ter comma 1-bis, has about 160 words); a comma above the cap is
 * «troppo lungo per il confronto parola per parola»: it is shown as «riscritto»,
 * the two versions side by side without word marks.
 */
export const DIFF_WORD_CAP = 600;

/** Shared words over the longer comma's, at or above which two commi are «modificato» rather than «riscritto» (D3). */
const MODIFIED_RATIO: readonly [number, number] = [3, 5];
/** The same measure, at or above which two commi without a printed number may be paired (D2). */
const PAIRING_RATIO: readonly [number, number] = [1, 2];
const PAIRING_FLOOR = 0.5;

// ── the word LCS (moved here from ArticleDiff) ──────────────────

export interface DiffOp {
  type: 'equal' | 'insert' | 'delete';
  /** Index in the old sequence (equal, delete). */
  a?: number;
  /** Index in the new sequence (equal, insert). */
  b?: number;
}

/**
 * The longest common subsequence of two token lists, as the operations that turn
 * the old into the new. Where a change is both a removal and an addition, the
 * deletions come first. The common head and tail are matched without the table,
 * so two near-equal sequences cost little.
 */
export function diffSequences(oldTokens: readonly string[], newTokens: readonly string[]): DiffOp[] {
  let head = 0;
  const minLength = Math.min(oldTokens.length, newTokens.length);
  while (head < minLength && oldTokens[head] === newTokens[head]) head++;
  let tail = 0;
  while (
    tail < minLength - head &&
    oldTokens[oldTokens.length - 1 - tail] === newTokens[newTokens.length - 1 - tail]
  ) tail++;

  const m = oldTokens.length - head - tail;
  const n = newTokens.length - head - tail;
  const width = n + 1;
  const dp = new Uint32Array((m + 1) * width);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i * width + j] = oldTokens[head + i - 1] === newTokens[head + j - 1]
        ? dp[(i - 1) * width + j - 1] + 1
        : Math.max(dp[(i - 1) * width + j], dp[i * width + j - 1]);
    }
  }

  const middle: DiffOp[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldTokens[head + i - 1] === newTokens[head + j - 1]) {
      middle.push({ type: 'equal', a: head + i - 1, b: head + j - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i * width + j - 1] >= dp[(i - 1) * width + j])) {
      middle.push({ type: 'insert', b: head + j - 1 });
      j--;
    } else {
      middle.push({ type: 'delete', a: head + i - 1 });
      i--;
    }
  }
  middle.reverse();

  const ops: DiffOp[] = [];
  for (let k = 0; k < head; k++) ops.push({ type: 'equal', a: k, b: k });
  ops.push(...middle);
  for (let k = tail; k > 0; k--) {
    ops.push({ type: 'equal', a: oldTokens.length - k, b: newTokens.length - k });
  }
  return ops;
}

// ── units ───────────────────────────────────────────────────────

/** A printed comma number, reduced to what identifies it: "((1-bis. " → "1-bis", "01." → "1", "4.1." → "4.1". */
function normaliseNumber(printed: string): string | null {
  const m = /^[\s(]*(?:art(?:icolo)?\.?\s*)?0*(\d+)(?:\s*-?\s*([a-z]+))?(?:\.(\d+))?/i.exec(printed);
  if (!m) return null;
  return `${m[1]}${m[2] ? `-${m[2].toLowerCase()}` : ''}${m[3] ? `.${m[3]}` : ''}`;
}

function readUnits(raw: string, structure: ArticleStructure): { rubric: CompareUnit | null; units: CompareUnit[] } {
  const bodyEnd = structure.updates?.start ?? raw.length;
  const units: CompareUnit[] = [];
  let rubric: CompareUnit | null = null;
  let current: CompareUnit | null = null;
  let afterHeader = 0;

  for (const block of structure.blocks) {
    if (block.start >= bodyEnd) break;
    const end = Math.min(block.end, bodyEnd);
    if (block.kind === 'heading') {
      current = null;
      afterHeader = end;
    } else if (block.kind === 'rubrica') {
      current = null;
      afterHeader = end;
      rubric = { kind: 'rubric', start: block.start, end, number: null, items: [] };
    } else if (block.kind === 'comma') {
      current = {
        kind: 'comma',
        start: block.start,
        end,
        number: block.marker ? normaliseNumber(raw.slice(block.marker.start, block.marker.end)) : null,
        items: [],
      };
      units.push(current);
    } else if (block.kind === 'item') {
      // A list with no comma above it (right after the heading) is a unit of its own.
      if (!current) {
        current = { kind: 'comma', start: block.start, end, number: null, items: [] };
        units.push(current);
      }
      current.end = end;
      current.items.push({ start: block.start, end });
    }
  }

  // No comma at all: whatever stands after the heading is one unit.
  if (units.length === 0 && raw.slice(afterHeader, bodyEnd).trim() !== '') {
    units.push({ kind: 'comma', start: afterHeader, end: bodyEnd, number: null, items: [] });
  }
  return { rubric, units };
}

// ── what is compared of a unit ──────────────────────────────────

interface Token {
  start: number;
  end: number;
  /** What the diff compares: the word with Normattiva's «(( ))» marks taken off. Empty for a bare mark. */
  key: string;
}

interface UnitInfo {
  unit: CompareUnit;
  /** The unit's text with the «(( ))» marks and the note references off and the whitespace folded: «invariato» is equality of this. */
  folded: string;
  tokens: Token[];
  /** The words of D3's measure: case and punctuation folded. */
  counts: Map<string, number>;
  total: number;
  /** The whole unit is a repeal notice («((COMMA ABROGATO …))», «((...))»), not any other notice. */
  repeal: boolean;
}

const MARKS = /\(\(|\)\)/g;
const WORD = /\S+/g;
const FOLDED_OUT = /[^\p{L}\p{N}]+/gu;
const BARE_REFERENCE = /\(\d{1,4}[a-z]?\)/g;
/** What makes a notice a repeal: the parser's `notice` also covers OMISSIS, MODIFICAT and SOSTITUIT. */
const REPEAL_WORDS = /ABROGAT|SOPPRESS/;
const OMISSION = /^\(\(\s*(?:\.{3}|…)\s*\)\)$|^(?:\.{3}|…)$/;

function isRepealNotice(raw: string, unit: CompareUnit, decorations: readonly InlineDecoration[], markerEnd: number): boolean {
  if (unit.items.length > 0 || unit.kind !== 'comma') return false;
  const covering = decorations.filter(
    (d) => d.kind === 'notice' && d.start >= unit.start && d.end <= unit.end,
  );
  if (covering.length === 0) return false;
  const repeals = (d: InlineDecoration) => {
    const text = raw.slice(d.start, d.end).trim();
    return REPEAL_WORDS.test(text) || OMISSION.test(text);
  };
  if (!covering.every(repeals)) return false;
  const blanked = [
    ...covering,
    ...decorations.filter((d) => (d.kind === 'ref' || d.kind === 'ref-missing') && d.start >= unit.start && d.end <= unit.end),
    { start: unit.start, end: markerEnd },
  ];
  let rest = '';
  for (let i = unit.start; i < unit.end; i++) {
    if (!blanked.some((r) => i >= r.start && i < r.end)) rest += raw[i];
  }
  return !/[\p{L}\p{N}]/u.test(rest.replace(BARE_REFERENCE, ''));
}

function inspect(raw: string, unit: CompareUnit, structure: ArticleStructure): UnitInfo {
  // The «(119)» references to an update note are pointers, not words: blanked out
  // (same length, so every offset stays the text's own) before anything is compared.
  const chars = raw.slice(unit.start, unit.end).split('');
  for (const d of structure.decorations) {
    if (d.kind !== 'ref' && d.kind !== 'ref-missing') continue;
    for (let i = Math.max(d.start, unit.start); i < Math.min(d.end, unit.end); i++) chars[i - unit.start] = ' ';
  }
  const text = chars.join('');
  const tokens: Token[] = [];
  const counts = new Map<string, number>();
  let total = 0;
  WORD.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD.exec(text)) !== null) {
    const key = m[0].replace(MARKS, '');
    if (key === '') continue;
    tokens.push({ start: unit.start + m.index, end: unit.start + m.index + m[0].length, key });
    const word = key.toLowerCase().replace(FOLDED_OUT, '');
    if (word === '') continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
    total++;
  }
  const marker = structure.blocks.find((b) => b.start === unit.start && b.kind === 'comma')?.marker;
  return {
    unit,
    folded: text.replace(MARKS, '').replace(/\s+/g, ' ').trim(),
    tokens,
    counts,
    total,
    repeal: isRepealNotice(raw, unit, structure.decorations, marker?.end ?? unit.start),
  };
}

function sharedWords(a: UnitInfo, b: UnitInfo): number {
  const [small, large] = a.counts.size <= b.counts.size ? [a, b] : [b, a];
  let shared = 0;
  for (const [word, count] of small.counts) shared += Math.min(count, large.counts.get(word) ?? 0);
  return shared;
}

/** D3's measure as a fraction (1 for two empty commi), and whether it reaches `ratio`. */
function similarity(a: UnitInfo, b: UnitInfo): { value: number; reaches: (ratio: readonly [number, number]) => boolean } {
  const longer = Math.max(a.total, b.total);
  const shared = longer === 0 ? 0 : sharedWords(a, b);
  return {
    value: longer === 0 ? 1 : shared / longer,
    // Integer arithmetic: 60 words of 100 are exactly 3/5.
    reaches: ([num, den]) => longer === 0 || shared * den >= longer * num,
  };
}

// ── pairing ─────────────────────────────────────────────────────

type Pair = [number | null, number | null];

/**
 * Order-keeping alignment of two lists by the best total score (Needleman–Wunsch
 * with a free gap): `score` is null where two units may not be paired. Ties
 * prefer a pair, then a gap on the first list, so an older-only comma comes
 * before a newer-only one at the same place.
 */
function align(first: readonly UnitInfo[], second: readonly UnitInfo[], score: (a: UnitInfo, b: UnitInfo) => number | null): Pair[] {
  const m = first.length;
  const n = second.length;
  const width = n + 1;
  const best = new Float64Array((m + 1) * width);
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      let value = Math.max(best[(i + 1) * width + j], best[i * width + j + 1]);
      const s = score(first[i], second[j]);
      if (s !== null) value = Math.max(value, s + best[(i + 1) * width + j + 1]);
      best[i * width + j] = value;
    }
  }

  const pairs: Pair[] = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i === m) pairs.push([null, j++]);
    else if (j === n) pairs.push([i++, null]);
    else {
      const s = score(first[i], second[j]);
      if (s !== null && best[i * width + j] === s + best[(i + 1) * width + j + 1]) pairs.push([i++, j++]);
      else if (best[i * width + j] === best[(i + 1) * width + j]) pairs.push([i++, null]);
      else pairs.push([null, j++]);
    }
  }
  return pairs;
}

/** D2 for versions: the printed number when both commi print one, the words otherwise. */
function versionScore(a: UnitInfo, b: UnitInfo): number | null {
  const s = similarity(a, b);
  if (a.unit.number !== null && b.unit.number !== null) return a.unit.number === b.unit.number ? 1 + s.value : null;
  // A repeal notice shares no word with the comma it replaced: it takes that comma's place
  // at the floor of the pairing measure, so it is read as its repeal and not as an addition.
  if (b.repeal) return Math.max(s.value, PAIRING_FLOOR);
  return s.reaches(PAIRING_RATIO) ? s.value : null;
}

/** D2 for two articles: by number when both print one on every comma, else by position. */
function pairArticles(left: readonly UnitInfo[], right: readonly UnitInfo[]): Pair[] {
  const numbered = (units: readonly UnitInfo[]) => units.length > 0 && units.every((u) => u.unit.number !== null);
  if (numbered(left) && numbered(right)) {
    return align(left, right, (a, b) => (a.unit.number === b.unit.number ? 1 : null));
  }
  const pairs: Pair[] = [];
  for (let k = 0; k < Math.max(left.length, right.length); k++) {
    pairs.push([k < left.length ? k : null, k < right.length ? k : null]);
  }
  return pairs;
}

// ── labels and diff ─────────────────────────────────────────────

function wordDiff(older: UnitInfo, newer: UnitInfo, olderSide: CompareSide): WordDiff {
  const ops = diffSequences(older.tokens.map((t) => t.key), newer.tokens.map((t) => t.key));
  const deleted: TextRange[] = [];
  const inserted: TextRange[] = [];
  let openDeleted: TextRange | null = null;
  let openInserted: TextRange | null = null;
  const extend = (open: TextRange | null, into: TextRange[], token: Token): TextRange => {
    if (open) {
      open.end = token.end;
      return open;
    }
    const range = { start: token.start, end: token.end };
    into.push(range);
    return range;
  };
  for (const op of ops) {
    if (op.type === 'delete') openDeleted = extend(openDeleted, deleted, older.tokens[op.a!]);
    else if (op.type === 'insert') openInserted = extend(openInserted, inserted, newer.tokens[op.b!]);
    else {
      openDeleted = null;
      openInserted = null;
    }
  }
  return olderSide === 'left' ? { left: deleted, right: inserted } : { left: inserted, right: deleted };
}

function labelPair(older: UnitInfo, newer: UnitInfo, olderSide: CompareSide): Pick<CompareRow, 'label' | 'diff' | 'tooLong'> {
  if (older.folded === newer.folded) return { label: 'invariato' };
  // Repealed in both versions, only worded differently: nothing happened between them.
  if (older.repeal && newer.repeal) return { label: 'invariato' };
  if (newer.repeal) return { label: 'abrogato' };
  if (!similarity(older, newer).reaches(MODIFIED_RATIO)) return { label: 'riscritto' };
  if (older.tokens.length > DIFF_WORD_CAP || newer.tokens.length > DIFF_WORD_CAP) return { label: 'riscritto', tooLong: true };
  return { label: 'modificato', diff: wordDiff(older, newer, olderSide) };
}

function buildRow(
  pair: Pair,
  olderUnits: readonly UnitInfo[],
  newerUnits: readonly UnitInfo[],
  olderSide: CompareSide,
): CompareRow {
  const [o, n] = pair;
  const newerSide: CompareSide = olderSide === 'left' ? 'right' : 'left';
  const row: CompareRow = {};
  if (o !== null) row[olderSide] = olderUnits[o].unit;
  if (n !== null) row[newerSide] = newerUnits[n].unit;
  if (o !== null && n !== null) Object.assign(row, labelPair(olderUnits[o], newerUnits[n], olderSide));
  // A repeal notice standing alone is the repeal of what the older text had, never an addition.
  else row.label = o !== null || newerUnits[n!].repeal ? 'abrogato' : 'aggiunto';
  return row;
}

// ── which side is older ─────────────────────────────────────────

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A position on the time line: the original, then the days, then the text in force. */
function pointInTime(article: ArticleData): { rank: number; day: string } | null {
  const asked = requestedVersion(article.norma_data);
  if (asked.kind === 'original') return { rank: 0, day: '' };
  if (asked.kind === 'current') return { rank: 2, day: '' };
  if (ISO_DAY.test(asked.date)) return { rank: 1, day: asked.date };
  const from = article.validity?.valid_from;
  return from && ISO_DAY.test(from) ? { rank: 1, day: from } : null;
}

/**
 * Which side holds the older text. From what was asked for: the original is
 * older than any day, a day older than the text in force, two days in order. When
 * that does not decide (a day that is not an ISO date, the same day twice), the
 * start of each text's validity window; failing that, the left.
 */
function olderSideOf(left: ArticleData, right: ArticleData): CompareSide {
  const a = pointInTime(left);
  const b = pointInTime(right);
  if (a && b && (a.rank !== b.rank || a.day !== b.day)) {
    return a.rank !== b.rank ? (a.rank < b.rank ? 'left' : 'right') : (a.day < b.day ? 'left' : 'right');
  }
  const fromLeft = left.validity?.valid_from;
  const fromRight = right.validity?.valid_from;
  if (fromLeft && fromRight && ISO_DAY.test(fromLeft) && ISO_DAY.test(fromRight) && fromLeft !== fromRight) {
    return fromLeft < fromRight ? 'left' : 'right';
  }
  return 'left';
}

// ── the comparison ──────────────────────────────────────────────

/** D1: the same article in two versions, or anything else. */
export function compareKindOf(left: ArticleData, right: ArticleData): CompareKind {
  return buildItemKey(left.norma_data) === buildItemKey(right.norma_data)
    && versionKey(left.norma_data) !== versionKey(right.norma_data)
    && !askForTheSameText(left, right)
    ? 'versions'
    : 'articles';
}

/**
 * Two requests whose keys differ but that name one text (the same day written two ways): there is
 * no older side and no change to label, so they are compared as two articles, side by side.
 */
function askForTheSameText(left: ArticleData, right: ArticleData): boolean {
  return JSON.stringify(requestedVersion(left.norma_data)) === JSON.stringify(requestedVersion(right.norma_data));
}

const request = (article: ArticleData): VersionRequest => ({
  versione: article.norma_data.versione,
  data_versione: article.norma_data.data_versione,
});

const capitalised = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function compareArticles(left: ArticleData, right: ArticleData): ArticleComparison {
  const kind = compareKindOf(left, right);
  const older: CompareSide = kind === 'versions' ? olderSideOf(left, right) : 'left';
  const newer: CompareSide = older === 'left' ? 'right' : 'left';
  const articles = { left, right };

  const parsed = (side: CompareSide) => {
    const raw = articles[side].article_text ?? '';
    const structure = parseArticleStructure(raw);
    const { rubric, units } = readUnits(raw, structure);
    return {
      rubric: rubric ? inspect(raw, rubric, structure) : null,
      units: units.map((u) => inspect(raw, u, structure)),
    };
  };
  const sides = { left: parsed('left'), right: parsed('right') };

  const counts: Record<CompareLabel, number> = { invariato: 0, modificato: 0, riscritto: 0, aggiunto: 0, abrogato: 0 };
  let rows: CompareRow[];
  let rubricRow: CompareRow | undefined;
  let rubricLabel: CompareLabel | undefined;

  if (kind === 'versions') {
    const o = sides[older];
    const n = sides[newer];
    rows = align(o.units, n.units, versionScore).map((pair) => buildRow(pair, o.units, n.units, older));
    for (const row of rows) counts[row.label!]++;
    if (o.rubric || n.rubric) {
      rubricRow = buildRow([o.rubric ? 0 : null, n.rubric ? 0 : null], o.rubric ? [o.rubric] : [], n.rubric ? [n.rubric] : [], older);
      rubricLabel = rubricRow.label;
    }
  } else {
    rows = pairArticles(sides.left.units, sides.right.units).map(([l, r]) => ({
      ...(l !== null ? { left: sides.left.units[l].unit } : {}),
      ...(r !== null ? { right: sides.right.units[r].unit } : {}),
    }));
    if (sides.left.rubric || sides.right.rubric) {
      rubricRow = {
        ...(sides.left.rubric ? { left: sides.left.rubric.unit } : {}),
        ...(sides.right.rubric ? { right: sides.right.rubric.unit } : {}),
      };
    }
  }

  const label = (side: CompareSide): string => kind === 'versions'
    ? versionLabel(request(articles[side]))
    : `${shortNorm(articles[side].norma_data)}${versionTabSuffix({
      version: articles[side].norma_data.versione,
      versionDate: articles[side].norma_data.data_versione,
    })}`;

  return {
    kind,
    older,
    ...(rubricRow ? { rubric: rubricRow } : {}),
    rows,
    summary: {
      kind,
      older,
      counts,
      ...(rubricLabel ? { rubric: rubricLabel } : {}),
      commi: { left: sides.left.units.length, right: sides.right.units.length },
      labels: { left: label('left'), right: label('right') },
    },
  };
}

// ── the summary in words (D6) ───────────────────────────────────

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const commi = (n: number): string => plural(n, 'comma', 'commi');

/** [singular, plural] of the participle, masculine for the commi and feminine for the rubric. */
const PARTICIPLES: Record<Exclude<CompareLabel, 'invariato'>, [string, string, string]> = {
  modificato: ['modificato', 'modificati', 'modificata'],
  riscritto: ['riscritto', 'riscritti', 'riscritta'],
  aggiunto: ['aggiunto', 'aggiunti', 'aggiunta'],
  abrogato: ['abrogato', 'abrogati', 'abrogata'],
};

/**
 * The sentence above the comparison. Versions: «Dal testo al 31 dicembre 2015 al
 * testo in vigore: 2 commi modificati, 1 aggiunto, 1 abrogato · 1 invariato»;
 * two articles: «Art. 2043 c.c. (3 commi) e art. 2059 c.c. (2 commi)».
 */
export function summarySentence(summary: ComparisonSummary): string {
  if (summary.kind === 'articles') {
    const part = (side: CompareSide) => `${summary.labels[side]} (${commi(summary.commi[side])})`;
    return `${capitalised(part('left'))} e ${part('right')}`;
  }

  const newer: CompareSide = summary.older === 'left' ? 'right' : 'left';
  const head = `Dal ${summary.labels[summary.older]} al ${summary.labels[newer]}`;
  const changes: string[] = [];
  if (summary.rubric && summary.rubric !== 'invariato') changes.push(`rubrica ${PARTICIPLES[summary.rubric][2]}`);
  let nounSaid = false;
  for (const label of ['modificato', 'riscritto', 'aggiunto', 'abrogato'] as const) {
    const n = summary.counts[label];
    if (n === 0) continue;
    const [one, many] = PARTICIPLES[label];
    changes.push(nounSaid ? `${n} ${n === 1 ? one : many}` : `${commi(n)} ${n === 1 ? one : many}`);
    nounSaid = true;
  }
  if (changes.length === 0) return `${head}: nessuna modifica`;
  const unchanged = summary.counts.invariato;
  const unchangedPart = unchanged === 0 ? '' : ` · ${nounSaid ? unchanged : commi(unchanged)} ${unchanged === 1 ? 'invariato' : 'invariati'}`;
  return `${head}: ${changes.join(', ')}${unchangedPart}`;
}
