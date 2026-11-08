import { memo, useMemo, type MouseEvent } from 'react';
import { cn } from '../../../lib/utils';

/** A citation drawn in the text: where it stands, its row on the page, and how it came by its act (#376 §5.6). */
export interface TextMark {
  start: number;
  end: number;
  /** The row's index on the page: the list's selection. */
  index: number;
  /** `own`: read from its words or chosen by the user (a solid line); `context`: inherited (dashed); `incomplete`: to
   *  complete (dotted, in ink). */
  kind: 'own' | 'context' | 'incomplete';
}

interface DocumentTextProps {
  text: string;
  /** In the order of the text, none overlapping. */
  marks: readonly TextMark[];
  selected: number | null;
  onSelect: (index: number) => void;
}

const LINE: Record<TextMark['kind'], string> = {
  own: 'decoration-solid decoration-primary-500 dark:decoration-primary-400',
  context: 'decoration-dashed decoration-primary-500 dark:decoration-primary-400',
  incomplete: 'decoration-dotted decoration-slate-400 dark:decoration-slate-500',
};

/**
 * The document as it is, in the reading face, its citations marked where they stand. Every character of
 * `text` is drawn once and in order: the marks only wrap slices of it (`DocumentReviewPage.test.tsx`
 * checks the drawn text against the file's). A mark is reached by the pointer; the keyboard and a
 * screen reader select the same citation from the list, which is the page's one way to every citation.
 */
export const DocumentText = memo(function DocumentText({ text, marks, selected, onSelect }: DocumentTextProps) {
  const pieces = useMemo(() => {
    const out: Array<{ from: number; to: number; mark: TextMark | null }> = [];
    let at = 0;
    for (const mark of marks) {
      if (mark.start < at) continue;
      if (mark.start > at) out.push({ from: at, to: mark.start, mark: null });
      out.push({ from: mark.start, to: mark.end, mark });
      at = mark.end;
    }
    if (at < text.length) out.push({ from: at, to: text.length, mark: null });
    return out;
  }, [text, marks]);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    // A drag that selects words is reading, not a choice.
    if (window.getSelection?.()?.isCollapsed === false) return;
    const mark = (event.target as Element).closest<HTMLElement>('[data-cite]');
    if (mark) onSelect(Number(mark.dataset.cite));
  };

  return (
    <div
      data-testid="document-text"
      onClick={handleClick}
      // `--doc-pulse`: the colour of the ring that marks a citation chosen in the list, per theme.
      className="mx-auto max-w-measure [--doc-pulse:var(--color-toga-500)] dark:[--doc-pulse:var(--color-toga-400)] whitespace-pre-wrap font-serif text-[1.0625rem] leading-[1.7] text-slate-800 [overflow-wrap:anywhere] dark:text-slate-200"
    >
      {pieces.map(piece => piece.mark === null
        ? text.slice(piece.from, piece.to)
        : (
          <mark
            key={piece.from}
            data-cite={piece.mark.index}
            data-kind={piece.mark.kind}
            data-selected={piece.mark.index === selected || undefined}
            className={cn(
              'cursor-pointer rounded-[3px] text-inherit underline decoration-2 underline-offset-[3px] box-decoration-clone transition-colors',
              LINE[piece.mark.kind],
              piece.mark.index === selected
                ? 'bg-primary-100 dark:bg-primary-900/60'
                : 'bg-transparent hover:bg-primary-50 dark:hover:bg-primary-950/50'
            )}
          >
            {text.slice(piece.from, piece.to)}
          </mark>
        ))}
    </div>
  );
});
