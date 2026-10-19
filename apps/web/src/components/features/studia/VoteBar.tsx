import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '../../../lib/utils';
import type { Giudizio } from '../../../types/studia';
import { FOCUS_RING, INK_BUTTON, MUTED_TEXT, SECONDARY_BUTTON } from './progress/tokens';

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

/** Every verdict looks the same, an ink outline at 44 px: the choice is the validator's, the interface does not lean. */
const VERDICT = cn(SECONDARY_BUTTON, 'inline-flex items-center justify-center px-3 disabled:opacity-60');
const CANCEL = cn('inline-flex min-h-[44px] items-center rounded-xl px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60 dark:text-slate-200 dark:hover:bg-slate-800', FOCUS_RING);

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
  // «Annulla» destroys the field with the key under the keyboard: the verdict chosen takes the focus back.
  const buttons = useRef<Partial<Record<Giudizio, HTMLButtonElement | null>>>({});
  const backTo = useRef<Giudizio | null>(null);
  useEffect(() => {
    if (open || !backTo.current) return;
    buttons.current[backTo.current]?.focus();
    backTo.current = null;
  }, [open]);

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
          className={cn('w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 md:text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50', FOCUS_RING)}
        />
        <div className="flex items-center gap-2">
          <span className={cn('mr-auto text-xs tabular-nums', MUTED_TEXT)}>{open.text.length} / {REASON_MAX}</span>
          <button type="button" onClick={() => {
              backTo.current = open.giudizio;
              setWriting(null);
            }}
            disabled={busy} className={CANCEL}>
            Annulla
          </button>
          <button
            type="button"
            onClick={() => onVote(open.giudizio, reason)}
            disabled={busy || reason.length === 0}
            className={cn(INK_BUTTON, 'px-5')}
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
          ref={(node) => {
            buttons.current[giudizio] = node;
          }}
          type="button"
          disabled={busy}
          onClick={() => (giudizio === 'APPROVATA' ? onVote(giudizio) : setWriting({ cardId, giudizio, text: '' }))}
          className={VERDICT}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
