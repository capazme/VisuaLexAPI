import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertCircle, Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ACTIVE, DISABLED, FOCUS_RING, TRANSITION } from '../../constants/interactions';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `ghost` and `outline` are the earlier names of `quiet` and `secondary`. */
  variant?: ButtonVariant | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  /** Disables the button and puts a spinner in the icon's place; the label stays, so the width does not jump. */
  loading?: boolean;
  /** The outcome of the last press, shown until the caller clears it: a red ring and an alert sign, or a check. */
  status?: 'error' | 'success';
  children: ReactNode;
}

const VARIANT_ALIASES: Record<NonNullable<ButtonProps['variant']>, ButtonVariant> = {
  primary: 'primary',
  secondary: 'secondary',
  quiet: 'quiet',
  danger: 'danger',
  ghost: 'quiet',
  outline: 'secondary',
};

// Spec 2026-10-18-redesign-inchiostro §5.1: one accent, no gradient, no glow.
const variantStyles: Record<ButtonVariant, string> = {
  primary: cn(
    'border border-transparent bg-toga-600 text-white',
    'hover:bg-toga-700 active:bg-toga-800',
    'dark:bg-toga-400 dark:text-ink-950 dark:hover:bg-toga-300 dark:active:bg-toga-200'
  ),
  secondary: cn(
    'border border-ink-200 bg-card text-ink-800',
    'hover:border-ink-300 hover:bg-ink-50 hover:text-ink-900 active:bg-ink-100',
    'dark:border-ink-800 dark:text-ink-100 dark:hover:border-ink-700 dark:hover:bg-ink-800 dark:hover:text-ink-50'
  ),
  quiet: cn(
    'border border-transparent bg-transparent text-ink-600',
    'hover:bg-ink-100 hover:text-ink-900 active:bg-ink-200',
    'dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-ink-50 dark:active:bg-ink-700'
  ),
  danger: cn(
    'border border-transparent bg-red-600 text-white',
    'hover:bg-red-700 active:bg-red-800'
  ),
};

// 36 px on a desktop, 44 px on a phone (the touch target); `min-h` so a long label wraps instead of clipping.
// The line height rides on the size (`text-sm/5`): tailwind-merge drops a separate `leading-*` written
// before a font size.
const sizeStyles = {
  sm: 'min-h-11 md:min-h-8 px-3 text-xs/5',
  md: 'min-h-11 md:min-h-9 px-4 text-sm/5',
  lg: 'min-h-11 px-5 text-base/5',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', icon, loading, status, children, className, disabled, ...props }, ref) => {
    const look = VARIANT_ALIASES[variant];
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
          'inline-flex items-center justify-center gap-2 rounded-md py-1.5 text-center font-medium',
          TRANSITION,
          // The press answers in 120 ms (Y1): quicker than the colours' 150, on the same `--ease-out`.
          'duration-[120ms]',
          FOCUS_RING,
          DISABLED,
          ACTIVE,
          variantStyles[look],
          sizeStyles[size],
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
