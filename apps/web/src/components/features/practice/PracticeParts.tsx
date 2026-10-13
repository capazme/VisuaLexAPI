import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { Toast } from '../../ui/Toast';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { practiceLabel } from '../../../utils/practice';
import { focusSearchField } from '../../../utils/searchFieldControl';

/** What a search streaming into a practice has brought so far (`SearchPanel`'s progress). */
export interface PracticeStreaming {
  /** The practice the search lands in; null until its first result has landed. */
  practiceId: string | null;
  loaded: number;
  total?: number;
}

/**
 * The migration's notice (spec §9): taken once from the store (`takePracticeNotice`, gotcha 14) and
 * shown as an info toast that stays until closed, in the toast band over the bar of practices.
 * `SearchPanel` mounts it once over both layouts, so a change of breakpoint does not lose it.
 */
export function PracticeNotice() {
  const takePracticeNotice = useAppStore((s) => s.takePracticeNotice);
  const waiting = useAppStore((s) => s.practiceNotice);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (waiting === null) return;
    // Taken in one step: a second invocation (StrictMode) finds nothing and keeps what the first showed.
    const taken = takePracticeNotice();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a one-shot signal of the store, taken and shown at once
    if (taken) setNotice(taken);
  }, [waiting, takePracticeNotice]);
  return (
    <Toast
      message={notice ?? ''}
      type="info"
      isVisible={notice !== null}
      onClose={() => setNotice(null)}
      duration={0}
      className={Z_INDEX.toast}
    />
  );
}

/** An empty practice (spec §3.1): it says so and offers the search page's field. */
export function PracticeEmpty() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 px-4 py-12 text-center dark:border-slate-700">
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Pratica vuota</p>
      <button
        type="button"
        onClick={() => focusSearchField()}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-700 md:min-h-0 md:py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
      >
        <Search size={16} aria-hidden />
        Cerca una norma o una sentenza
      </button>
    </div>
  );
}

/** The inline progress of a search streaming into this practice: a thin bar under its header. The
 *  floating status of the search panel announces it; this one is for the eye alone. */
export function PracticeStreamingBar({ streaming, practiceId }: { streaming: PracticeStreaming | null; practiceId: string }) {
  if (!streaming || streaming.practiceId !== practiceId) return null;
  const share = streaming.total ? Math.min(100, (streaming.loaded / streaming.total) * 100) : null;
  return (
    <div aria-hidden data-testid="practice-streaming" className="h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div
        className={cn('h-full bg-primary-500 transition-[width] duration-300', share === null && 'w-1/3 animate-pulse')}
        style={share === null ? undefined : { width: `${share}%` }}
      />
    </div>
  );
}

/**
 * A practice's name being edited in place: Enter or leaving the field keeps it, Esc gives up. A name
 * empty once trimmed is not kept (`renamePractice` ignores it). Focused and selected on mount.
 */
export function PracticeNameInput({ initial, onDone, className }: {
  initial: string;
  onDone: (name: string | null) => void;
  className?: string;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name !== null && practiceLabel(name) ? name : null);
  };
  return (
    <input
      ref={ref}
      type="text"
      value={value}
      aria-label="Nome della pratica"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(null);
        }
      }}
      onBlur={() => finish(value)}
      className={cn(
        'min-w-0 rounded-md border border-primary-300 bg-white px-2 py-1 text-slate-900 dark:border-primary-700 dark:bg-slate-900 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
        className,
      )}
    />
  );
}
