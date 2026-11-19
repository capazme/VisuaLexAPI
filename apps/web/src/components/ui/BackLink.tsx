import type { ButtonHTMLAttributes } from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../../lib/utils';
import { FOCUS_RING } from '../../constants/interactions';
import { CONTROL_RADIUS } from './controlStyles';
import { focusLanding } from '../../utils/focusPage';

export interface BackLinkProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children'> {
  /** Goes back (`navigate(-1)`, or somewhere when there is nothing behind): the address changes. */
  onBack: () => void;
}

/**
 * «Indietro» above a page's frame (LC104), with Impostazioni's look: 44 px on a phone, a background on hover. The focus
 * lands on the title of what is reached, or on the heading of the part its anchor names (`focusLanding`), never on the
 * body.
 */
export function BackLink({ onBack, className, ...props }: BackLinkProps) {
  return (
    <button
      type="button"
      {...props}
      onClick={() => {
        focusLanding(true);
        onBack();
      }}
      className={cn(
        'inline-flex min-h-[44px] w-fit items-center gap-1.5 px-2 -ml-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 md:min-h-0 md:py-1.5 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
        CONTROL_RADIUS,
        FOCUS_RING,
        className,
      )}
    >
      <ArrowLeft size={16} aria-hidden /> Indietro
    </button>
  );
}
