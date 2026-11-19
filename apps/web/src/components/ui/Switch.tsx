import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role' | 'children'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/**
 * An on/off switch (LC104), one size: a 44 × 24 track and a 20 px thumb, Impostazioni's. The button is the hit area,
 * 44 px on a phone; the track and the thumb are drawn inside it. Name it with `aria-label` or `aria-labelledby`.
 */
export function Switch({ checked, onCheckedChange, className, ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      {...props}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'group inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-50 md:min-h-0 focus-visible:outline-none',
        className,
      )}
    >
      <span
        aria-hidden
        data-switch-track=""
        className={cn(
          'relative block h-6 w-11 rounded-full transition-colors duration-(--dur-press) ease-out group-focus-visible:ring-2 group-focus-visible:ring-toga-500 group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background',
          checked ? 'bg-primary-600 dark:bg-toga-400' : 'bg-slate-300 dark:bg-slate-600',
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-(--dur-press) ease-out',
            checked && 'translate-x-5 dark:bg-ink-950',
          )}
        />
      </span>
    </button>
  );
}
