import { useState } from 'react';
import { AlertTriangle, Send, ThumbsUp } from 'lucide-react';
import { cn } from '../../../lib/utils';

/**
 * The discussions' own controls, drawn by the panel under an article (`ArticleDiscussionPanel`) and by the Forum's
 * Community: the vote (a toggle, only positive), the reply box and «Segnala».
 */

export function VoteButton({ voted, count, label, onVote }: { voted: boolean; count: number; label: string; onVote: () => void }) {
  return (
    <button
      type="button"
      onClick={onVote}
      aria-label={label}
      aria-pressed={voted}
      className={cn('inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs', voted ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800')}
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
      <button type="submit" aria-label={sendLabel} className="self-end rounded-lg bg-primary-600 p-2 text-white"><Send size={14} aria-hidden /></button>
    </form>
  );
}

export function ReportButton({ onReport, label }: { onReport: () => void; label?: string }) {
  return (
    <button type="button" onClick={onReport} aria-label={label} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-red-600 dark:text-slate-400">
      <AlertTriangle size={12} aria-hidden /> Segnala
    </button>
  );
}
