import { Fragment, type ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import type { DossierItem } from '../../../types';
import { parseLesson, type Inline } from '../studia/corsi/lessonFormat';

type NoteItem = Extract<DossierItem, { type: 'note' }>;

/** `#`, `##` and `###` are one small title in a note: the lessons' parser reads `###` only. */
const HEADINGS = /^#{1,3}[ \t]+/gm;

function inline(nodes: Inline[]): ReactNode {
  return nodes.map((node, i) => {
    if (node.kind === 'text') return <Fragment key={i}>{node.text}</Fragment>;
    if (node.kind === 'strong') return <strong key={i} className="font-semibold text-slate-900 dark:text-slate-50">{inline(node.children)}</strong>;
    if (node.kind === 'em') return <em key={i}>{inline(node.children)}</em>;
    // A lesson's citation `[testo](#c1)` means nothing in a note: its words alone. No link is ever drawn from a note.
    return <Fragment key={i}>{inline(node.children)}</Fragment>;
  });
}

/**
 * A note's words (D4). An application's (`createdBy`) is read as the lessons' closed Markdown subset (`lessonFormat`):
 * titles, bold, italic, lists, quotes, its lines kept; everything else, HTML and links included, stays text, which React
 * escapes — the text comes from outside, nothing of it is ever HTML. The user's own note is drawn as written.
 * Folded, an application's note shows its first lines fading out (a `<p>`'s `line-clamp` does not cut blocks).
 */
export function NoteText({ note, className, folded = false }: { note: NoteItem; className?: string; folded?: boolean }) {
  if (!note.createdBy) {
    return <p className={cn('whitespace-pre-wrap [overflow-wrap:anywhere]', folded && 'line-clamp-3', className)}>{note.data}</p>;
  }
  const nodes = parseLesson(note.data.replace(HEADINGS, '### '), '\n');
  return (
    <div
      className={cn(
        className,
        'max-w-measure space-y-2 leading-relaxed [overflow-wrap:anywhere]',
        folded && 'max-h-[7.5em] overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent)]',
      )}
    >
      {nodes.map((node, i) => {
        switch (node.kind) {
          case 'h3':
            // A title of the note, not of the page: bold words, so the page's headings keep their order.
            return <p key={i} className="font-semibold text-slate-900 dark:text-slate-50">{inline(node.inline)}</p>;
          case 'p':
            return <p key={i} className="whitespace-pre-line">{inline(node.inline)}</p>;
          case 'ul':
            return <ul key={i} className="list-disc space-y-1 pl-5">{node.items.map((item, k) => <li key={k}>{inline(item)}</li>)}</ul>;
          case 'ol':
            return <ol key={i} start={node.start} className="list-decimal space-y-1 pl-5">{node.items.map((item, k) => <li key={k}>{inline(item)}</li>)}</ol>;
          case 'quote':
            return (
              <blockquote key={i} className="space-y-1 border-l-2 border-slate-300 pl-3 text-slate-700 dark:border-slate-600 dark:text-slate-300">
                {node.paragraphs.map((p, k) => <p key={k}>{inline(p)}</p>)}
              </blockquote>
            );
        }
      })}
    </div>
  );
}
