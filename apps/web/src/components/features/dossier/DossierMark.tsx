import { cn } from '../../../lib/utils';

/**
 * The empty dossier list's drawing (S7c), as the empty Community's (S7a): line art in the manner of the section
 * switcher's mark — a rounded tile, round strokes of one weight — in the section's hue, a folder with two lines of
 * entries. Decorative: the words beside it say what to do.
 */
export function DossierMark({ hue, className }: { hue: string; className?: string }) {
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
      <rect x="5" y="5" width="86" height="86" rx="24" style={{ stroke: hue }} opacity={0.35} />
      {/* The folder: its tab, its body. */}
      <path d="M22 34a5 5 0 0 1 5-5h12l6 6h24a5 5 0 0 1 5 5v24a5 5 0 0 1-5 5H27a5 5 0 0 1-5-5V34Z" style={{ stroke: hue }} />
      {/* Two entries, in the ink's grey. */}
      <path d="M32 48h32M32 56h20" className="stroke-slate-400 dark:stroke-slate-500" />
    </svg>
  );
}
