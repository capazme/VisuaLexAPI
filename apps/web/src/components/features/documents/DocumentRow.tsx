import { useLayoutEffect, useRef, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { animate } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { ease } from '../../../lib/motion';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { formatSize, type DocumentJob, type DocumentKind, type DocumentStage } from './documentJob';

/** DOCX in ink, HTML in amber, Markdown and TXT in slate. */
const KIND_INK: Record<DocumentKind, string> = {
  docx: 'bg-primary-600 dark:bg-primary-400',
  html: 'bg-amber-500 dark:bg-amber-400',
  md: 'bg-slate-500 dark:bg-slate-400',
  txt: 'bg-slate-500 dark:bg-slate-400',
  other: 'bg-slate-400 dark:bg-slate-500',
};

/** The same, as a colour the flying sheet can take on the way: read off the row's own mark. */
const kindColour = (mark: HTMLElement | null) => (mark ? getComputedStyle(mark).backgroundColor : '');

const STAGE_WORDS: Record<Exclude<DocumentStage, 'error'>, string> = {
  reading: 'Leggo il documento…',
  searching: 'Cerco le citazioni…',
  done: 'Pronto',
};

/**
 * The document's row under the box (D6): its kind's mark, its name (cut with an ellipsis, whole for the pointer), its
 * size and what is happening — «Leggo il documento…», then «Cerco le citazioni…» over a bar that slides, since there
 * is no share to tell (no invented percentage), then a check. A refusal turns the row red, shakes it once (300 ms) and
 * says why; ✕ takes it away. Drawn, not announced: the page's live region says the state.
 */
export function DocumentRow({ job, onDismiss, markRef, hidden = false }: { job: DocumentJob; onDismiss: () => void; markRef?: Ref<HTMLSpanElement>; hidden?: boolean }) {
  const failed = job.stage === 'error';
  return (
    <div
      data-stage={job.stage}
      className={cn(
        'flex min-h-14 items-center gap-3 rounded-[10px] border px-3 py-2',
        failed ? 'vlx-shake border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
      )}
    >
      <span
        ref={markRef}
        aria-hidden
        data-kind={job.kind}
        className={cn('h-8 w-6 shrink-0 rounded-[3px] [clip-path:polygon(0_0,70%_0,100%_25%,100%_100%,0_100%)]', failed ? 'bg-red-500 dark:bg-red-400' : KIND_INK[job.kind], hidden && 'opacity-0')}
      />
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span title={job.name} className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">
            {job.name}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">{formatSize(job.bytes)}</span>
        </span>
        {failed ? (
          <span className="text-sm text-red-800 dark:text-red-200">{job.error}</span>
        ) : (
          <span className="flex items-center gap-3">
            <span className={cn('text-xs', job.stage === 'done' ? 'font-medium text-emerald-800 dark:text-emerald-300' : 'text-slate-600 dark:text-slate-400')}>{STAGE_WORDS[job.stage as Exclude<DocumentStage, 'error'>]}</span>
            {job.stage !== 'done' && (
              <span aria-hidden className="relative h-1 min-w-12 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <span className="vlx-bar-slide absolute inset-y-0 left-0 w-1/4 rounded-full bg-primary-600 dark:bg-primary-400" />
              </span>
            )}
          </span>
        )}
      </span>
      {job.stage === 'done' && <Check aria-hidden size={20} className="shrink-0 text-emerald-700 dark:text-emerald-400" />}
      {failed && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Chiudi l’avviso"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-red-800 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-200 dark:hover:bg-red-900/40"
        >
          <X aria-hidden size={18} />
        </button>
      )}
    </div>
  );
}

/**
 * The ink sheet thrown from the box to the document's row as it is let go (D6): from where the sheet stood to the
 * row's mark, shrinking, taking the kind's colour on the way; then gone, and the mark shows. Over the page, in a
 * portal: the box's wrapper clips. Not drawn under reduced motion (the mark is simply there).
 */
export function SheetFlight({ from, target, onDone }: { from: DOMRect; target: { current: HTMLElement | null }; onDone: () => void }) {
  const sheet = useRef<HTMLDivElement>(null);
  const tint = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = sheet.current;
    const mark = target.current;
    if (!el || !tint.current || !mark) return onDone();
    const to = mark.getBoundingClientRect();
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    // The kind's colour comes as a veil over the ink, by its opacity: only transforms and opacity move.
    tint.current.style.backgroundColor = kindColour(mark);
    const timing = { duration: 0.5, ease: ease.inOut };
    const flight = animate(el, { x: [0, dx], y: [0, dy], scale: [1, to.height / from.height], rotate: [0, -8, 0] }, timing);
    const colour = animate(tint.current, { opacity: [0, 1] }, timing);
    flight.then(onDone, onDone);
    return () => {
      flight.stop();
      colour.stop();
    };
    // Once per throw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createPortal(
    <div
      ref={sheet}
      aria-hidden
      className={cn('pointer-events-none fixed overflow-hidden', Z_INDEX.floating, 'rounded-[5px] bg-primary-600 [clip-path:polygon(0_0,72%_0,100%_22%,100%_100%,0_100%)] dark:bg-primary-400')}
      style={{ left: from.left, top: from.top, width: from.width, height: from.height }}
    >
      <div ref={tint} className="absolute inset-0 opacity-0" />
    </div>,
    document.body,
  );
}
