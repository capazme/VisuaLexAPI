/** The error box and the password's eye, shared by the sign-in and the sign-up forms (`authForm.ts`). */
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import { FOCUS_RING } from '../../constants/interactions';

export function FormError({ id, message }: { id: string; message: string }) {
  return (
    <div id={id} role="alert" className="mb-6 flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-3.5 animate-in fade-in slide-in-from-top-2 dark:border-red-900/50 dark:bg-red-950/40">
      <AlertCircle aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
      <p className="text-sm text-red-700 dark:text-red-300">{message}</p>
    </div>
  );
}

/** The eye inside a password field: a 44 px box over the field's right end. */
export function PasswordToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={shown ? 'Nascondi la password' : 'Mostra la password'}
      aria-pressed={shown}
      className={`absolute right-0 top-0 grid h-11 w-11 place-items-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 ${FOCUS_RING}`}
    >
      {shown ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}
    </button>
  );
}
