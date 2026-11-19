import { useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { CONTROL_BORDER, CONTROL_RADIUS } from '../../ui/controlStyles';

export type AliasChoice = { action: 'replace' } | { action: 'rename'; newTrigger: string } | { action: 'skip' };

interface AliasConflictDialogProps {
  suggestedTrigger: string;
  /** While the server works: the choices wait. */
  busy?: boolean;
  onChoose: (choice: AliasChoice) => void;
  onClose: () => void;
}

// Same rule the BFF enforces (backend/src/controllers/sharedEnvironmentController.ts
// TRIGGER_RE) and customAliasController's createCustomAliasSchema: 2+ chars,
// alphanumeric plus dash/underscore/dot.
const TRIGGER_RE = /^[a-zA-Z0-9\-_.]+$/;

/**
 * An alias item whose trigger the user already has (a 409 on «Prendi»): replace, rename or skip. In the page under the
 * item, inside the review (LC140, L-73; it was a window with a veil); the space around it is the review's.
 */
export function AliasConflictDialog({ suggestedTrigger, busy = false, onChoose, onClose }: AliasConflictDialogProps) {
  const customAliases = useAppStore((s) => s.customAliases);
  // The server's suggestion is the trigger already taken: the first free numbered one is proposed instead.
  const [renameValue, setRenameValue] = useState(() => {
    const taken = new Set(customAliases.map((a) => a.trigger.toLowerCase()));
    let n = 2;
    while (taken.has(`${suggestedTrigger}-${n}`.toLowerCase())) n++;
    return `${suggestedTrigger}-${n}`;
  });
  const trimmed = renameValue.trim();
  const isValidTrigger = trimmed.length >= 2 && TRIGGER_RE.test(trimmed);
  const box = `${CONTROL_RADIUS} ${CONTROL_BORDER} px-3 py-2`;

  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Hai già un alias con trigger <code className="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded-[4px]">{suggestedTrigger}</code>. Come vuoi procedere?
      </p>

      <div className={`${box} flex flex-wrap items-center justify-between gap-2`}>
        <span className="text-xs text-slate-500 dark:text-slate-400">Il tuo alias esistente verrà eliminato.</span>
        <Button variant="secondary" onClick={() => onChoose({ action: 'replace' })} disabled={busy}>Sostituisci il mio alias</Button>
      </div>

      <div className={box}>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Input
              label="Rinomina prima di importare"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              error={trimmed && !isValidTrigger ? 'Il trigger deve avere almeno 2 caratteri (lettere, numeri, - _ .)' : undefined}
            />
          </div>
          <Button
            onClick={() => onChoose({ action: 'rename', newTrigger: trimmed })}
            disabled={busy || !isValidTrigger || trimmed === suggestedTrigger}
          >
            Usa
          </Button>
        </div>
      </div>

      <div className={`${box} flex flex-wrap items-center justify-between gap-2`}>
        <span className="text-xs text-slate-500 dark:text-slate-400">L'item resta in attesa, puoi decidere più tardi.</span>
        <Button variant="secondary" onClick={() => onChoose({ action: 'skip' })} disabled={busy}>Salta questo elemento</Button>
      </div>

      <div className="flex justify-end">
        <Button variant="quiet" onClick={onClose} disabled={busy}>Annulla</Button>
      </div>
    </div>
  );
}
