import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { buttonClassName, type ButtonSize, type ButtonVariant } from './buttonStyles';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The icon element to render */
  icon: ReactNode;
  size?: ButtonSize;
  /** `Button`'s variants, but for `link`: an icon has no words to underline. */
  variant?: Exclude<ButtonVariant, 'link'>;
  /** Whether the button is in a pressed/active state */
  isActive?: boolean;
  /** Show loading spinner */
  loading?: boolean;
  /** Accessible label (required for icon-only buttons) */
  'aria-label': string;
}

// Square: as wide as `Button` is tall at each size.
const squareStyles: Record<ButtonSize, string> = {
  sm: 'px-0 min-w-11 md:min-w-8',
  md: 'px-0 min-w-11 md:min-w-9',
  lg: 'px-0 min-w-11',
};

const iconSizes: Record<ButtonSize, string> = {
  sm: '[&>svg]:w-4 [&>svg]:h-4',
  md: '[&>svg]:w-4 [&>svg]:h-4',
  lg: '[&>svg]:w-5 [&>svg]:h-5',
};

/**
 * An icon-only button with `Button`'s look (LC97): the same radius, height, border and variants, square. For close,
 * menu and tool buttons; it needs an `aria-label`.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, size = 'md', variant = 'quiet', isActive = false, loading = false, className, disabled, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(
        buttonClassName(variant, size),
        squareStyles[size],
        iconSizes[size],
        isActive && 'bg-ink-100 text-ink-900 dark:bg-ink-800 dark:text-ink-50',
        className
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <span className="size-4 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden="true" />
      ) : (
        icon
      )}
    </button>
  )
);

IconButton.displayName = 'IconButton';
