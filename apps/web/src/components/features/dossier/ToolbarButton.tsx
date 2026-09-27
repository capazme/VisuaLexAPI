import type { LucideIcon } from 'lucide-react';
import { cn } from '../../../lib/utils';

export type ToolbarButtonColor =
  | 'slate'
  | 'slateMuted'
  | 'emerald'
  | 'blue'
  | 'indigo'
  | 'green'
  | 'red'
  | 'purple'
  | 'yellow';

const COLOR_CLASSES: Record<ToolbarButtonColor, string> = {
  slate: 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800',
  slateMuted: 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800',
  emerald: 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20',
  blue: 'text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20',
  indigo: 'text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20',
  green: 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20',
  red: 'text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20',
  purple: 'text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20',
  yellow: 'text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20',
};

const RING_CLASSES: Record<ToolbarButtonColor, string> = {
  slate: 'focus-visible:ring-blue-500',
  slateMuted: 'focus-visible:ring-blue-500',
  emerald: 'focus-visible:ring-emerald-500',
  blue: 'focus-visible:ring-blue-500',
  indigo: 'focus-visible:ring-indigo-500',
  green: 'focus-visible:ring-green-500',
  red: 'focus-visible:ring-red-500',
  purple: 'focus-visible:ring-purple-500',
  yellow: 'focus-visible:ring-yellow-500',
};

export interface ToolbarButtonProps {
  icon: LucideIcon;
  onClick: () => void;
  title: string;
  ariaLabel: string;
  color: ToolbarButtonColor;
  variant?: 'mobile' | 'desktop';
  // Toggle state. When defined, emits aria-pressed. When true, swaps the icon
  // to fill-current and (if `pressedColor` is set) switches the color token.
  pressed?: boolean;
  // Optional color used while `pressed === true`. Also pins the focus ring to
  // this color in both states so toggles have a stable accent.
  pressedColor?: ToolbarButtonColor;
  disabled?: boolean;
  // Optional DOM id (used for tour hooks like `tour-dossier-pin`).
  id?: string;
  className?: string;
}

export function ToolbarButton({
  icon: Icon,
  onClick,
  title,
  ariaLabel,
  color,
  variant = 'desktop',
  pressed,
  pressedColor,
  disabled,
  id,
  className,
}: ToolbarButtonProps) {
  const effectiveColor = pressed && pressedColor ? pressedColor : color;
  const ringColorKey = pressedColor ?? color;

  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={pressed}
      className={cn(
        'transition-colors focus-visible:outline-none focus-visible:ring-2',
        'disabled:opacity-50',
        variant === 'mobile'
          ? 'flex-shrink-0 p-3 rounded-lg'
          : 'p-2 rounded-md',
        COLOR_CLASSES[effectiveColor],
        RING_CLASSES[ringColorKey],
        className,
      )}
    >
      <Icon size={variant === 'mobile' ? 20 : 18} className={pressed ? 'fill-current' : undefined} />
    </button>
  );
}
