import { useId, useState } from 'react';
import { CornerDownRight, Loader2, Send } from 'lucide-react';
import { Button } from '../../../../components/ui/Button';
import { TOUCH_TARGET_RESPONSIVE } from '../../../../constants/interactions';
import { cn } from '../../../../lib/utils';

/**
 * Follow-up composer under a settled deliberation ("Approfondisci questa
 * risposta"). Loop β refine: the follow-up is sent through
 * `useQaThread.refine(traceId, followUp)`, which links the new turn to the
 * original trace server-side (MERL-T `refine_from`), unlike the pinned
 * AskGraphField, which opens a new, unlinked deliberation.
 *
 * Refining is ASKING (BFF `consentGuard`, basic consent), so the caller mounts
 * this only when `qaAskable`. Collapsed to a single link by default so a long
 * thread does not grow one open textbox per turn. `busy` mirrors the composer's
 * one-collegial-run-at-a-time rule (P1.10): typing stays enabled, submitting
 * waits for the running deliberation to settle.
 */
export interface RefineFieldProps {
  /** A deliberation is in flight: submission is blocked until it settles. */
  busy?: boolean;
  onRefine: (followUp: string) => void;
}

export function RefineField({ busy = false, onRefine }: RefineFieldProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const inputId = useId();

  const submit = (): void => {
    const q = value.trim();
    if (!q || busy) return;
    onRefine(q);
    setValue('');
    setOpen(false);
  };

  return (
    <div className="mt-3 border-t border-slate-100 pt-2.5 dark:border-slate-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? inputId : undefined}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-1 text-xs font-medium text-primary-600 transition-colors hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-400 dark:hover:text-primary-300',
          TOUCH_TARGET_RESPONSIVE,
        )}
      >
        <CornerDownRight size={13} className="shrink-0" aria-hidden="true" />
        Approfondisci questa risposta
      </button>
      {open && (
        <div className="mt-2 flex items-center gap-2">
          <input
            id={inputId}
            type="text"
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setOpen(false);
              }
            }}
            placeholder="Domanda di approfondimento…"
            aria-label="Domanda di approfondimento"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
          <Button
            type="button"
            size="sm"
            onClick={submit}
            disabled={!value.trim() || busy}
            aria-label="Invia l’approfondimento"
            icon={busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Send size={13} aria-hidden="true" />}
          >
            Invia
          </Button>
        </div>
      )}
      {open && busy && (
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          Attendi la deliberazione in corso, poi invia l’approfondimento.
        </p>
      )}
    </div>
  );
}
