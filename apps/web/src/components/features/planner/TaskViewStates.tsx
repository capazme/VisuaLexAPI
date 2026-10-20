import { cn } from '../../../lib/utils';
import { SECONDARY_BUTTON } from '../studia/progress/tokens';

const MUTED_TEXT = 'text-slate-600 dark:text-slate-400';

/** Rows held at their size while the first read travels. */
export function TaskListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden className="grid gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-start gap-3 rounded-xl px-2 py-3">
          <span className="mt-0.5 h-5 w-5 shrink-0 rounded-md bg-slate-200 motion-safe:animate-pulse dark:bg-slate-800" />
          <span className="grid flex-1 gap-2">
            <span className="h-4 w-2/3 rounded bg-slate-200 motion-safe:animate-pulse dark:bg-slate-800" />
            <span className="h-3 w-1/3 rounded bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800/60" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** A read that failed, with «Riprova»: what was on screen stays above it. */
export function TaskViewError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-800">
      <p className="text-sm text-slate-700 dark:text-slate-300">Non riesco a leggere i compiti.</p>
      <button type="button" onClick={onRetry} className={SECONDARY_BUTTON}>Riprova</button>
    </div>
  );
}

/** Nothing to show: the sentence and, when it helps, what to do. */
export function TaskViewEmpty({ title, line }: { title: string; line?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center dark:border-slate-700">
      <p className="font-serif text-lg text-slate-900 dark:text-slate-50">{title}</p>
      {line && <p className={cn('mt-1 text-sm', MUTED_TEXT)}>{line}</p>}
    </div>
  );
}

/** More than the server lists in one view. */
export function TruncatedNote() {
  return <p className={cn('text-xs', MUTED_TEXT)}>Sono mostrati i primi 1000 compiti.</p>;
}
