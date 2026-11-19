import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '../../../lib/utils';
import type { Giudizio } from '../../../types/studia';
import { Button } from '../../ui/Button';
import { FOCUS_RING, MUTED_TEXT } from './progress/tokens';

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
          className={cn('w-full resize-y rounded-md border border-slate-300 bg-card px-3 py-2 text-base text-slate-900 md:text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50', FOCUS_RING)}
        />
        <div className="flex items-center gap-2">
          <span className={cn('mr-auto text-xs tabular-nums', MUTED_TEXT)}>{open.text.length} / {REASON_MAX}</span>
          <Button
            type="button"
            variant="quiet"
            onClick={() => {
              backTo.current = open.giudizio;
              setWriting(null);
            }}
            disabled={busy}
          >
            Annulla
          </Button>
          <Button type="button" onClick={() => onVote(open.giudizio, reason)} disabled={busy || reason.length === 0}>
            Invia
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div role="group" aria-label="Il tuo giudizio" className="grid grid-cols-3 gap-2">
      {VERDICTS.map(({ giudizio, label }) => (
        // Every verdict looks the same, an outline: the choice is the validator's, the interface does not lean.
        <Button
          key={giudizio}
          ref={(node) => {
            buttons.current[giudizio] = node;
          }}
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => (giudizio === 'APPROVATA' ? onVote(giudizio) : setWriting({ cardId, giudizio, text: '' }))}
          className="px-3"
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
