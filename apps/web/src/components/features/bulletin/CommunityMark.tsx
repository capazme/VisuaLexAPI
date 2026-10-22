import { cn } from '../../../lib/utils';

/**
 * The empty Community's drawing (S7a): line art in the manner of the section switcher's mark — a rounded tile, round
 * strokes of one weight — in the Forum's hue (`--vlx-section-forum`, light and dark): two speech bubbles, the one in
 * front with two lines of words, a question and its answer. Decorative: the words beside it say what is coming.
 */
export function CommunityMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 96 96"
      fill="none"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('h-24 w-24', className)}
    >
      {/* The tile of the section's mark, drawn and not filled. */}
      <rect x="5" y="5" width="86" height="86" rx="24" style={{ stroke: 'var(--vlx-section-forum)' }} opacity={0.35} />
      {/* The bubble behind: the question. */}
      <path
        d="M22 27h30a6 6 0 0 1 6 6v14a6 6 0 0 1-6 6H33l-8 7v-7h-3a6 6 0 0 1-6-6V33a6 6 0 0 1 6-6Z"
        className="stroke-slate-400 dark:stroke-slate-500"
      />
      {/* The bubble in front: the answer, with its words. */}
      <path
        d="M44 41h30a6 6 0 0 1 6 6v14a6 6 0 0 1-6 6h-3v7l-8-7H44a6 6 0 0 1-6-6V47a6 6 0 0 1 6-6Z"
        className="fill-white dark:fill-slate-950"
        style={{ stroke: 'var(--vlx-section-forum)' }}
      />
      <path d="M47 50h22M47 58h14" style={{ stroke: 'var(--vlx-section-forum)' }} />
    </svg>
  );
}
