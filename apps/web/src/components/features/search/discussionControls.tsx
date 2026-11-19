import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Send, ThumbsUp } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';

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
    <Button
      type="button"
      variant="quiet"
      onClick={onVote}
      aria-label={`${label}, ${count} ${count === 1 ? 'voto' : 'voti'}`}
      aria-pressed={voted}
      icon={<ThumbsUp size={13} aria-hidden />}
      className={cn('shrink-0 gap-1 px-3 md:px-2', voted && 'bg-primary-100 text-primary-700 hover:bg-primary-100 dark:bg-primary-900/40 dark:text-primary-300')}
    >
      {count}
    </Button>
  );
}

/**
 * A reply's text and its send button; `onSend` resolves true once it is published, and the box empties. `focusOnOpen`:
 * the box takes the focus as it appears, for a box the user opened to write in («Commenta», LC114) — on a phone the
 * keyboard rises, which is what was asked for. Never for the box always there at a discussion's foot.
 */
export function ReplyForm({ onSend, placeholder = 'Scrivi una risposta…', sendLabel = 'Invia risposta', focusOnOpen = false }: {
  onSend: (body: string) => Promise<boolean>;
  placeholder?: string;
  sendLabel?: string;
  focusOnOpen?: boolean;
}) {
  const [body, setBody] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  // Once, as it appears: `focusOnOpen` is read at the opening.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (focusOnOpen) field.current?.focus(); }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!body.trim()) return;
    if (await onSend(body.trim())) setBody('');
  };
  return (
    <form onSubmit={event => void submit(event)} className="mt-3 flex gap-2">
      <textarea ref={field} value={body} onChange={event => setBody(event.target.value)} required rows={2} placeholder={placeholder} aria-label={placeholder} className="min-w-0 flex-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
      {/* LC114: 36 px from md (44 on a phone), the common control's height, as the commands beside it; it was 32. */}
      <IconButton type="submit" variant="primary" aria-label={sendLabel} icon={<Send aria-hidden />} className="self-end" />
    </form>
  );
}

/** «Segnala», which asks first: one touch meant for the control beside it must not reach the moderators. */
export function ReportButton({ onReport, label, inline = false }: { onReport: () => void; label?: string; inline?: boolean }) {
  const [asking, setAsking] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // «Segnala»: the question grows from it (LC85).
  const [askFrom, setAskFrom] = useState<HTMLElement | null>(null);
  // Answered in the margin, the focus goes back to «Segnala», not to the page.
  const answer = (report: boolean) => {
    setAsking(false);
    if (report) onReport();
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };
  const question = 'La segnalazione arriva ai moderatori, che decidono se nascondere il contenuto.';
  return (
    <>
      <Button ref={trigger} type="button" variant="quiet" onClick={(event) => { setAskFrom(event.currentTarget); setAsking(true); }} aria-label={label} aria-expanded={inline ? asking : undefined} icon={<AlertTriangle size={12} aria-hidden />} className="gap-1 px-2 text-slate-500 hover:bg-transparent hover:text-red-600 dark:text-slate-400 dark:hover:bg-transparent dark:hover:text-red-400">
        Segnala
      </Button>
      {/* `inline` (the article's margin, L-73): the question under the row, in the page, not a dialog over it. The
          parent row wraps, so it takes a line of its own. */}
      {inline && asking && (
        <div role="group" aria-label="Segnalare ai moderatori?" className="basis-full rounded-[8px] border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
          <p>{question}</p>
          <div className="mt-2 flex justify-end gap-2">
            {/* 44 px to touch at every width: the question is in the margin, on a phone too. */}
            <Button type="button" variant="quiet" size="lg" onClick={() => answer(false)} className="min-w-11 px-2 text-xs">Annulla</Button>
            <Button type="button" variant="danger" size="lg" onClick={() => answer(true)} className="min-w-11 px-2.5 text-xs font-semibold">Segnala</Button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={asking && !inline}
        origin={askFrom}
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
