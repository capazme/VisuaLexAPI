import type { ArticleData } from '../../../types';
import type { ArticleComparison, CompareLabel, CompareRow, CompareSide, CompareUnit } from '../../../utils/articleCompare';
import { parseArticleStructure, type ArticleStructure, type TextRange } from '../../../utils/articleStructure';
import { formatDateForDisplay } from '../../../utils/dateUtils';
import { requestedVersion } from '../../../utils/versionDisplay';

/** One article's text, parsed once for the whole comparison. */
export interface SideText {
  raw: string;
  structure: ArticleStructure;
}

export function readSide(article: ArticleData): SideText {
  const raw = article.article_text ?? '';
  return { raw, structure: parseArticleStructure(raw) };
}

/** A range of a side's text to draw, with the words of it a comparison marks. */
export interface Cell {
  range: TextRange;
  changes: ReadonlyArray<TextRange & { kind: 'del' | 'ins' }>;
}

export type RowPart = 'head' | 'rubric' | 'comma';

export type ViewItem =
  | {
      type: 'row';
      key: string;
      part: RowPart;
      /** The printed number(s) of the comma, for the label column. */
      number: string | null;
      label?: CompareLabel;
      tooLong?: boolean;
      cells: Partial<Record<CompareSide, Cell>>;
    }
  | { type: 'fold'; key: string; count: number };

const other = (side: CompareSide): CompareSide => (side === 'left' ? 'right' : 'left');

/**
 * The heading (and anything else before the rubric or the first comma): the part of a column
 * that is in no unit. Drawn on its own so the column still spells its whole text (rule 23).
 */
function headRange(text: SideText, comparison: ArticleComparison, side: CompareSide): TextRange | null {
  const starts = [
    comparison.rubric?.[side]?.start,
    ...comparison.rows.map((r) => r[side]?.start),
    text.structure.updates?.start,
    text.raw.length,
  ].filter((n): n is number => n !== undefined);
  const end = Math.min(...starts);
  return end > 0 ? { start: 0, end } : null;
}

/** The AGGIORNAMENTO tail of a side, folded under its column; not a unit, not compared. */
export function tailRange(text: SideText): TextRange | null {
  const updates = text.structure.updates;
  return updates ? { start: updates.start, end: text.raw.length } : null;
}

function numberOf(left: CompareUnit | undefined, right: CompareUnit | undefined): string | null {
  const a = left?.number ?? null;
  const b = right?.number ?? null;
  if (a && b && a !== b) return `${a} · ${b}`;
  return a ?? b;
}

function cellsOf(comparison: ArticleComparison, row: CompareRow): Partial<Record<CompareSide, Cell>> {
  const cells: Partial<Record<CompareSide, Cell>> = {};
  const newer = other(comparison.older);
  for (const side of ['left', 'right'] as const) {
    const unit = row[side];
    if (!unit) continue;
    const marks = row.diff?.[side] ?? [];
    const kind = side === newer ? 'ins' : 'del';
    cells[side] = { range: { start: unit.start, end: unit.end }, changes: marks.map((m) => ({ ...m, kind })) };
  }
  return cells;
}

export interface LayoutOptions {
  /** D7: fold the «invariato» commi (versions only). */
  onlyChanges: boolean;
  /** Fold groups the reader has opened. */
  expanded: ReadonlySet<string>;
}

/**
 * The comparison as the view draws it: the head, the rubric, the commi — consecutive «invariato»
 * ones folded into one item while «Solo le modifiche» is on — in the order of the text.
 */
export function layoutComparison(
  comparison: ArticleComparison,
  texts: Record<CompareSide, SideText>,
  { onlyChanges, expanded }: LayoutOptions,
): ViewItem[] {
  const items: ViewItem[] = [];

  const headCells: Partial<Record<CompareSide, Cell>> = {};
  for (const side of ['left', 'right'] as const) {
    const range = headRange(texts[side], comparison, side);
    if (range) headCells[side] = { range, changes: [] };
  }
  if (headCells.left || headCells.right) items.push({ type: 'row', key: 'head', part: 'head', number: null, cells: headCells });

  if (comparison.rubric) {
    const row = comparison.rubric;
    items.push({
      type: 'row',
      key: 'rubric',
      part: 'rubric',
      number: null,
      ...(row.label ? { label: row.label } : {}),
      ...(row.tooLong ? { tooLong: true } : {}),
      cells: cellsOf(comparison, row),
    });
  }

  const fold = comparison.kind === 'versions' && onlyChanges;
  let index = 0;
  while (index < comparison.rows.length) {
    const row = comparison.rows[index];
    if (fold && row.label === 'invariato') {
      let end = index;
      while (end < comparison.rows.length && comparison.rows[end].label === 'invariato') end++;
      const key = `fold-${index}`;
      if (expanded.has(key)) {
        for (let k = index; k < end; k++) items.push(commaItem(comparison, comparison.rows[k], k));
      } else {
        items.push({ type: 'fold', key, count: end - index });
      }
      index = end;
      continue;
    }
    items.push(commaItem(comparison, row, index));
    index++;
  }
  return items;
}

function commaItem(comparison: ArticleComparison, row: CompareRow, index: number): ViewItem {
  return {
    type: 'row',
    key: `row-${index}`,
    part: 'comma',
    number: numberOf(row.left, row.right),
    ...(row.label ? { label: row.label } : {}),
    ...(row.tooLong ? { tooLong: true } : {}),
    cells: cellsOf(comparison, row),
  };
}

/**
 * Each side's name on a phone's switch: a version by its day («31/12/2015»), «Originale» or
 * «In vigore»; an article by the label the summary gives it («art. 2043 c.c.», with «— testo al …»
 * when it is a past text). Two articles that come out with the same name get « · 1» and « · 2».
 */
export function sideNames(comparison: ArticleComparison, articles: Record<CompareSide, ArticleData>): Record<CompareSide, string> {
  if (comparison.kind === 'articles') {
    const { left, right } = comparison.summary.labels;
    return left === right ? { left: `${left} · 1`, right: `${right} · 2` } : { left, right };
  }
  const name = (side: CompareSide): string => {
    const asked = requestedVersion(articles[side].norma_data);
    if (asked.kind === 'original') return 'Originale';
    if (asked.kind === 'date') return formatDateForDisplay(asked.date);
    return 'In vigore';
  };
  return { left: name('left'), right: name('right') };
}

export const LABEL_TEXT: Record<CompareLabel, string> = {
  invariato: 'invariato',
  modificato: 'modificato',
  riscritto: 'riscritto',
  aggiunto: 'aggiunto',
  abrogato: 'abrogato',
};

export const TOO_LONG_TEXT = 'troppo lungo per il confronto parola per parola';

/** The tint of a side's cell for the row's label: what was lost reads red on the older side, what was gained green. */
export const CELL_TINT: Partial<Record<CompareLabel, string>> = {
  aggiunto: 'bg-emerald-50/60 dark:bg-emerald-950/20',
  abrogato: 'bg-red-50/60 dark:bg-red-950/20',
};

