import { useRef, useState } from 'react';
import { AlertTriangle, Send, ThumbsUp } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { ConfirmDialog } from '../../ui/ConfirmDialog';

/**
 * The discussions' own controls, drawn by the panel under an article (`ArticleDiscussionPanel`) and by the Forum's
 * Community: the vote (a toggle, only positive), the reply box and «Segnala». Each is 44 px tall on a phone and keeps
 * the panel's small size from `md` (`TOUCH`).
 */

/** At least 44 px to touch below `md`, the compact size from it. */
export const TOUCH = 'min-h-11 md:min-h-0';

/**
 * The vote, named by what is voted and its count: «Vota la risposta di luigi, 1 voto». On one's own contribution
 * (`own`) only the count: the server refuses that vote (G-476).
 */
export function VoteButton({ voted, count, label, onVote, own = false }: { voted: boolean; count: number; label: string; onVote: () => void; own?: boolean }) {
  if (own) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 px-3 py-1 text-xs text-slate-600 md:px-2 dark:text-slate-300">
        <ThumbsUp size={13} aria-hidden /> {count}<span className="sr-only"> {count === 1 ? 'voto' : 'voti'}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onVote}
      aria-label={`${label}, ${count} ${count === 1 ? 'voto' : 'voti'}`}
      aria-pressed={voted}
      className={cn('inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-1 text-xs md:px-2', TOUCH, voted ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800')}
    >
      <ThumbsUp size={13} aria-hidden /> {count}
    </button>
  );
}

/** A reply's text and its send button; `onSend` resolves true once it is published, and the box empties. */
export function ReplyForm({ onSend, placeholder = 'Scrivi una risposta…', sendLabel = 'Invia risposta' }: {
  onSend: (body: string) => Promise<boolean>;
  placeholder?: string;
  sendLabel?: string;
}) {
  const [body, setBody] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!body.trim()) return;
    if (await onSend(body.trim())) setBody('');
  };
  return (
    <form onSubmit={event => void submit(event)} className="mt-3 flex gap-2">
      <textarea value={body} onChange={event => setBody(event.target.value)} required rows={2} placeholder={placeholder} aria-label={placeholder} className="min-w-0 flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
      <button type="submit" aria-label={sendLabel} className="inline-flex min-h-11 min-w-11 items-center justify-center self-end rounded-lg bg-primary-600 dark:bg-toga-400 dark:hover:bg-toga-300 dark:text-ink-950 p-2 text-white md:min-h-0 md:min-w-0"><Send size={14} aria-hidden /></button>
    </form>
  );
}

/** «Segnala», which asks first: one touch meant for the control beside it must not reach the moderators. */
export function ReportButton({ onReport, label, inline = false }: { onReport: () => void; label?: string; inline?: boolean }) {
  const [asking, setAsking] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // Answered in the margin, the focus goes back to «Segnala», not to the page.
  const answer = (report: boolean) => {
    setAsking(false);
    if (report) onReport();
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };
  const question = 'La segnalazione arriva ai moderatori, che decidono se nascondere il contenuto.';
  return (
    <>
      <button ref={trigger} type="button" onClick={() => setAsking(true)} aria-label={label} aria-expanded={inline ? asking : undefined} className={cn('inline-flex items-center gap-1 px-2 text-xs text-slate-500 hover:text-red-600 dark:text-slate-400 md:px-0', TOUCH)}>
        <AlertTriangle size={12} aria-hidden /> Segnala
      </button>
      {/* `inline` (the article's margin, L-73): the question under the row, in the page, not a dialog over it. The
          parent row wraps, so it takes a line of its own. */}
      {inline && asking && (
        <div role="group" aria-label="Segnalare ai moderatori?" className="basis-full rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
          <p>{question}</p>
          <div className="mt-2 flex justify-end gap-2">
            {/* 44 px to touch at every width: the question is in the margin, on a phone too. */}
            <button type="button" onClick={() => answer(false)} className="min-h-11 min-w-11 px-2 text-slate-600 dark:text-slate-300">Annulla</button>
            <button type="button" onClick={() => answer(true)} className="min-h-11 min-w-11 rounded-md bg-red-600 px-2.5 font-semibold text-white hover:bg-red-700">Segnala</button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={asking && !inline}
        variant="danger"
        title="Segnalare ai moderatori?"
        message={question}
        confirmLabel="Segnala"
        focusCancel
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          onReport();
        }}
      />
    </>
  );
}
