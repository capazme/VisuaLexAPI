import { memo, useMemo, type MouseEvent } from 'react';
import type { CitationMatch } from '../../../utils/citationMatcher';
import { cn } from '../../../lib/utils';

interface DocumentTextProps {
  text: string;
  citations: readonly CitationMatch[];
  selected: number | null;
  onSelect: (index: number) => void;
}

/**
 * The document as it is, in the reading face, its citations marked where they stand. Every character of
 * `text` is drawn once and in order: the marks only wrap slices of it (`DocumentReviewPage.test.tsx`
 * checks the drawn text against the file's). A mark is reached by the pointer; the keyboard and a
 * screen reader select the same citation from the list, which is the page's one way to every citation.
 */
export const DocumentText = memo(function DocumentText({ text, citations, selected, onSelect }: DocumentTextProps) {
  const pieces = useMemo(() => {
    const out: Array<{ from: number; to: number; cite: number | null }> = [];
    let at = 0;
    citations.forEach((citation, index) => {
      if (citation.startIndex > at) out.push({ from: at, to: citation.startIndex, cite: null });
      out.push({ from: citation.startIndex, to: citation.endIndex, cite: index });
      at = citation.endIndex;
    });
    if (at < text.length) out.push({ from: at, to: text.length, cite: null });
    return out;
  }, [text, citations]);

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
      className="mx-auto max-w-[68ch] [--doc-pulse:var(--color-toga-500)] dark:[--doc-pulse:var(--color-toga-400)] whitespace-pre-wrap font-serif text-[1.0625rem] leading-[1.7] text-slate-800 [overflow-wrap:anywhere] dark:text-slate-200"
    >
      {pieces.map(piece => piece.cite === null
        ? text.slice(piece.from, piece.to)
        : (
          <mark
            key={piece.from}
            data-cite={piece.cite}
            data-selected={piece.cite === selected || undefined}
            className={cn(
              'cursor-pointer rounded-[3px] text-inherit underline decoration-2 underline-offset-[3px] box-decoration-clone transition-colors',
              piece.cite === selected
                ? 'bg-primary-100 decoration-primary-600 dark:bg-primary-900/60 dark:decoration-primary-300'
                : 'bg-transparent decoration-primary-500 hover:bg-primary-50 dark:decoration-primary-400 dark:hover:bg-primary-950/50'
            )}
          >
            {text.slice(piece.from, piece.to)}
          </mark>
        ))}
    </div>
  );
});
