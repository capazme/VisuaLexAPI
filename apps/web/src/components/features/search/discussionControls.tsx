import { useState } from 'react';
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
export function ReportButton({ onReport, label }: { onReport: () => void; label?: string }) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAsking(true)} aria-label={label} className={cn('inline-flex items-center gap-1 px-2 text-xs text-slate-500 hover:text-red-600 dark:text-slate-400 md:px-0', TOUCH)}>
        <AlertTriangle size={12} aria-hidden /> Segnala
      </button>
      <ConfirmDialog
        open={asking}
        variant="danger"
        title="Segnalare ai moderatori?"
        message="La segnalazione arriva ai moderatori, che decidono se nascondere il contenuto."
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
