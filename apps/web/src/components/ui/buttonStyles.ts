import { cn } from '../../lib/utils';
import { ACTIVE, DISABLED, FOCUS_RING, TRANSITION } from '../../constants/interactions';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
/** The earlier names of `quiet` and `secondary`. */
type ButtonAlias = 'ghost' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_ALIASES: Record<ButtonVariant | ButtonAlias, ButtonVariant> = {
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

/**
 * `Button`'s look, for an element that must look like one without being a `<button>`: a link whose one job is a
 * page's action («Torna alla ricerca» on «Pagina non trovata», Q1).
 */
export function buttonClassName(variant: ButtonVariant | ButtonAlias = 'primary', size: ButtonSize = 'md'): string {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-md py-1.5 text-center font-medium',
    TRANSITION,
    // The press answers in 120 ms (Y1) on `--ease-out`, and with it the button's colours (`TRANSITION`'s 150
    // elsewhere): one duration for every property it lists.
    'duration-[120ms]',
    FOCUS_RING,
    DISABLED,
    ACTIVE,
    variantStyles[VARIANT_ALIASES[variant]],
    sizeStyles[size],
  );
}
