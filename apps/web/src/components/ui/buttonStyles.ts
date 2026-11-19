import { cn } from '../../lib/utils';
import { ACTIVE, DISABLED, FOCUS_RING } from '../../constants/interactions';
import { CONTROL_BORDER, CONTROL_HEIGHT, CONTROL_RADIUS, type ControlSize } from './controlStyles';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'link';
/** The earlier names of `quiet` and `secondary`. */
type ButtonAlias = 'ghost' | 'outline';
export type ButtonSize = ControlSize;

const VARIANT_ALIASES: Record<ButtonVariant | ButtonAlias, ButtonVariant> = {
  primary: 'primary',
  secondary: 'secondary',
  quiet: 'quiet',
  danger: 'danger',
  link: 'link',
  ghost: 'quiet',
  outline: 'secondary',
};

// Spec 2026-10-18-redesign-inchiostro §5.1: one accent, no gradient, no glow.
const variantStyles: Record<ButtonVariant, string> = {
  primary: cn(
    'border border-transparent bg-toga-600 text-white',
    'hover:bg-toga-700 active:bg-toga-800',
    'dark:bg-toga-400 dark:text-ink-950 dark:disabled:bg-slate-700 dark:disabled:text-slate-400 dark:disabled:opacity-100 dark:hover:bg-toga-300 dark:active:bg-toga-200'
  ),
  secondary: cn(
    CONTROL_BORDER,
    'bg-card text-ink-800',
    'hover:border-ink-300 hover:bg-ink-50 hover:text-ink-900 active:bg-ink-100',
    'dark:text-ink-100 dark:hover:border-ink-700 dark:hover:bg-ink-800 dark:hover:text-ink-50'
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
  // Words in ink, underlined: the quiet action set in a sentence or under a block («Vedi tutte», «Annulla»). The height
  // stays, so the touch target does too; the side padding goes, so the words sit where the text starts.
  link: cn(
    'border border-transparent bg-transparent px-0 text-ink-800',
    'underline decoration-ink-300 decoration-1 underline-offset-4',
    'hover:text-ink-950 hover:decoration-ink-600',
    'dark:text-ink-100 dark:decoration-ink-600 dark:hover:text-ink-50 dark:hover:decoration-ink-300'
  ),
};

// 36 px on a desktop, 44 px on a phone (the touch target); `min-h` so a long label wraps instead of clipping.
// The line height rides on the size (`text-sm/5`): tailwind-merge drops a separate `leading-*` written
// before a font size.
// The small one pads 4 px, not 6: its 20 px line, the padding and the 1 px border come to 30, inside its 32 px; with 6 px
// they came to 34 and pushed past it (LC117, Papiniano on #670; seen on #660).
const sizeStyles: Record<ButtonSize, string> = {
  sm: cn(CONTROL_HEIGHT.sm, 'px-3 py-1 text-xs/5'),
  md: cn(CONTROL_HEIGHT.md, 'px-4 text-sm/5'),
  lg: cn(CONTROL_HEIGHT.lg, 'px-5 text-base/5'),
};

/**
 * `Button`'s look, for an element that must look like one without being a `<button>`: a link whose one job is a
 * page's action («Torna alla ricerca» on «Pagina non trovata», Q1).
 */
export function buttonClassName(variant: ButtonVariant | ButtonAlias = 'primary', size: ButtonSize = 'md'): string {
  return cn(
    'inline-flex items-center justify-center gap-2 py-1.5 text-center font-medium',
    CONTROL_RADIUS,
    // The press answers in 120 ms (Y1, `--dur-press`) on `--ease-out`, and with it the button's colours (`TRANSITION`'s
    // 150 elsewhere): one duration for every property it lists. Not the opacity (LC132): busy or disabled, and back, the
    // button changes at once, with no fade; entering it, its colours do not move either (`disabled:transition-none`).
    'transition-[color,background-color,border-color,transform,translate,scale] duration-(--dur-press) ease-out disabled:transition-none',
    FOCUS_RING,
    DISABLED,
    ACTIVE,
    sizeStyles[size],
    // After the size: `link` takes back the side padding.
    variantStyles[VARIANT_ALIASES[variant]],
  );
}
