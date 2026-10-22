import { cn } from '../../../lib/utils';

/**
 * The empty Community's drawing (S7a): line art in the manner of the section switcher's mark — a rounded tile, round
 * strokes of one weight — in the Forum's hue (`--vlx-section-forum`, light and dark): two speech bubbles apart, a
 * question in grey and its answer in the hue, each with its words; no fill, on any paper. Decorative: the words beside
 * it say what is coming.
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
      {/* The question, up on the left, in the ink's grey, with its words. */}
      <path
        d="M20 22h20a6 6 0 0 1 6 6v12a6 6 0 0 1-6 6H31l-7 6v-6h-4a6 6 0 0 1-6-6V28a6 6 0 0 1 6-6Z"
        className="stroke-slate-400 dark:stroke-slate-500"
      />
      <path d="M21 31h18M21 37h10" className="stroke-slate-400 dark:stroke-slate-500" />
      {/* The answer, down on the right, in the Forum's hue: apart from the question, so neither covers the other. */}
      <path
        d="M56 42h20a6 6 0 0 1 6 6v12a6 6 0 0 1-6 6h-4v6l-7-6H56a6 6 0 0 1-6-6V48a6 6 0 0 1 6-6Z"
        style={{ stroke: 'var(--vlx-section-forum)' }}
      />
      <path d="M57 51h18M57 57h11" style={{ stroke: 'var(--vlx-section-forum)' }} />
    </svg>
  );
}
