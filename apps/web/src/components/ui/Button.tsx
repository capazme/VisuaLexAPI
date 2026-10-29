import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertCircle, Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { buttonClassName, type ButtonSize, type ButtonVariant } from './buttonStyles';

export type { ButtonVariant } from './buttonStyles';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `ghost` and `outline` are the earlier names of `quiet` and `secondary`. */
  variant?: ButtonVariant | 'ghost' | 'outline';
  size?: ButtonSize;
  icon?: ReactNode;
  /** Disables the button and puts a spinner in the icon's place; the label stays, so the width does not jump. */
  loading?: boolean;
  /** The outcome of the last press, shown until the caller clears it: a red ring and an alert sign, or a check. */
  status?: 'error' | 'success';
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', icon, loading, status, children, className, disabled, ...props }, ref) => {
    const sign = loading ? (
      <span className="size-4 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden="true" />
    ) : status === 'error' ? (
      <AlertCircle size={16} aria-hidden="true" />
    ) : status === 'success' ? (
      <Check size={16} aria-hidden="true" />
    ) : (
      icon
    );

    return (
      <button
        ref={ref}
        className={cn(
          buttonClassName(variant, size),
          status === 'error' && 'ring-2 ring-red-500 ring-offset-2 ring-offset-background',
          className
        )}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        data-status={status}
        {...props}
      >
        {sign && <span className="inline-flex shrink-0">{sign}</span>}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
