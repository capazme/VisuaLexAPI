// VisuaLex's mark: the open book (Lucide's BookOpen, the app's earlier logo), drawn as two strokes so
// it can be traced. `index.html` repeats the same SVG for the splash shown before the app starts.
interface BookMarkProps {
  size?: number;
  /** Trace the strokes once (600 ms), then breathe while `breathe` is set. */
  draw?: boolean;
  breathe?: boolean;
  className?: string;
  label?: string;
}

export function BookMark({ size = 48, draw = false, breathe = false, className, label }: BookMarkProps) {
  const classes = ['vlx-book', draw && 'vlx-book-draw', breathe && 'vlx-book-breathe', className].filter(Boolean).join(' ');
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={classes}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path pathLength={100} d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
      <path pathLength={100} d="M12 7v14" />
    </svg>
  );
}
