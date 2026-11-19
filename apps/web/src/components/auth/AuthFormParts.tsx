/** The error box and the password's eye, shared by the sign-in and the sign-up forms. */
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import { IconButton } from '../ui/IconButton';
import { CARD_RADIUS } from '../ui/controlStyles';
import { cn } from '../../lib/utils';

export function FormError({ id, message }: { id: string; message: string }) {
  return (
    <div id={id} role="alert" className={cn('mb-6 flex items-start gap-3 border border-red-200 bg-red-50 p-3.5 animate-in fade-in slide-in-from-top-2 dark:border-red-900/50 dark:bg-red-950/40', CARD_RADIUS)}>
      <AlertCircle aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
      <p className="text-sm text-red-700 dark:text-red-300">{message}</p>
    </div>
  );
}

/** The eye inside a password field: a square as tall as the field (44 px on a phone, 36 from md) over its right end. */
export function PasswordToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <IconButton
      onClick={onToggle}
      aria-label={shown ? 'Nascondi la password' : 'Mostra la password'}
      aria-pressed={shown}
      icon={shown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      className="absolute bottom-0 right-0 h-11 w-11 md:h-9 md:w-9"
    />
  );
}
