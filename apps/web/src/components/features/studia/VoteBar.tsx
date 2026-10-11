import { useId, useState } from 'react';
import { cn } from '../../../lib/utils';
import type { Giudizio } from '../../../types/studia';

/** The server's limit on a reason (`motivazione`). */
export const REASON_MAX = 2000;

export interface VoteBarProps {
  /** The card being judged: a reason being written belongs to it, and is gone when another card comes. */
  cardId: string;
  /** A vote is being sent: the buttons wait. */
  busy: boolean;
  /** `motivazione` is the written reason, always present for «Migliorabile» and «Errata», absent for «Approvata». */
  onVote: (giudizio: Giudizio, motivazione?: string) => void;
}

const VERDICTS: Array<{ giudizio: Giudizio; label: string }> = [
  { giudizio: 'APPROVATA', label: 'Approvata' },
  { giudizio: 'MIGLIORABILE', label: 'Migliorabile' },
  { giudizio: 'ERRATA', label: 'Errata' },
];

const BUTTON =
  'inline-flex min-h-[44px] items-center justify-center rounded-lg border px-3 text-sm font-medium transition-colors disabled:opacity-60 md:min-h-0 md:py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
const QUIET = 'border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800';

/**
 * The three verdicts. «Approvata» is sent at once; «Migliorabile» and «Errata» open a required
 * reason field first («Scrivi il motivo»), sent with the verdict. No verdict is coloured: the choice
 * is the validator's, the interface does not lean.
 */
export function VoteBar({ cardId, busy, onVote }: VoteBarProps) {
  // The reason belongs to a card: another card shows the bar closed, with no effect to reset it.
  const [writing, setWriting] = useState<{ cardId: string; giudizio: Exclude<Giudizio, 'APPROVATA'>; text: string } | null>(null);
  const open = writing && writing.cardId === cardId ? writing : null;
  const fieldId = useId();
  const reason = open?.text.trim() ?? '';

  if (open) {
    const label = VERDICTS.find((verdict) => verdict.giudizio === open.giudizio)?.label;
    return (
      <div role="group" aria-label={`Motivo del giudizio «${label}»`} className="space-y-2">
        <label htmlFor={fieldId} className="block text-sm font-medium text-slate-700 dark:text-slate-200">
          Scrivi il motivo
        </label>
        <textarea
          id={fieldId}
          value={open.text}
          onChange={(e) => setWriting({ ...open, text: e.target.value })}
          maxLength={REASON_MAX}
          rows={4}
          autoFocus
          className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 md:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        />
        <div className="flex items-center gap-2">
          <span className="mr-auto text-xs text-slate-500 dark:text-slate-400">{open.text.length} / {REASON_MAX}</span>
          <button type="button" onClick={() => setWriting(null)} disabled={busy} className={cn(BUTTON, QUIET)}>
            Annulla
          </button>
          <button
            type="button"
            onClick={() => onVote(open.giudizio, reason)}
            disabled={busy || reason.length === 0}
            className={cn(BUTTON, 'border-primary-600 bg-primary-600 text-white hover:bg-primary-700')}
          >
            Invia
          </button>
        </div>
      </div>
    );
  }

  return (
    <div role="group" aria-label="Il tuo giudizio" className="grid grid-cols-3 gap-2">
      {VERDICTS.map(({ giudizio, label }) => (
        <button
          key={giudizio}
          type="button"
          disabled={busy}
          onClick={() => (giudizio === 'APPROVATA' ? onVote(giudizio) : setWriting({ cardId, giudizio, text: '' }))}
          className={cn(BUTTON, QUIET)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
