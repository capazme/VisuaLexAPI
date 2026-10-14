import { useMemo } from 'react';
import { cn } from '../../../lib/utils';
import { renderArticleHtml } from '../../../utils/articleRender';
import type { CompareLabel, CompareSide } from '../../../utils/articleCompare';
import { SafeHTML } from '../../../utils/sanitize';
import { LABEL_TEXT, TOO_LONG_TEXT, type Cell, type RowPart, type SideText } from './compareLayout';

const PILL: Record<CompareLabel, string> = {
  invariato: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  modificato: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  riscritto: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
  aggiunto: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  abrogato: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
};

export function LabelPill({ label, tooLong }: { label: CompareLabel; tooLong?: boolean }) {
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span
        data-testid="compare-pill"
        data-label={label}
        className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide', PILL[label])}
      >
        {LABEL_TEXT[label]}
      </span>
      {tooLong && <span className="text-[11px] leading-tight text-slate-500 dark:text-slate-400">{TOO_LONG_TEXT}</span>}
    </span>
  );
}

const NOTHING: Record<RowPart, string> = {
  head: 'Nessuna intestazione',
  rubric: 'Nessuna rubrica',
  comma: 'Nessun comma',
};

/** A side that has nothing in this row (no comma, rubric or heading): hatched, and said so for a screen reader. */
export function GapCell({ side, part = 'comma', name }: { side: CompareSide; part?: RowPart; name?: string }) {
  const none = NOTHING[part];
  return (
    <div
      role="img"
      data-gap=""
      data-gap-side={side}
      aria-label={name ? `${none} in: ${name}` : none}
      className="min-h-[3rem] self-stretch bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,rgb(148_163_184/0.18)_6px,rgb(148_163_184/0.18)_7px)]"
    />
  );
}

/** A range of an article, drawn as the reader draws it (no marks of the user, no signs). */
export function TextCell({ side, text, cell, className }: { side: CompareSide; text: SideText; cell: Cell; className?: string }) {
  const html = useMemo(
    () =>
      renderArticleHtml({
        raw: text.raw,
        structure: text.structure,
        highlights: [],
        annotations: [],
        only: cell.range,
        changes: cell.changes,
      }),
    [text, cell],
  );
  return (
    <div role="cell" data-side={side} className={cn('min-w-0 px-4 py-2', className)}>
      <SafeHTML html={html} className="vlx-art vlx-art--compare" />
    </div>
  );
}
