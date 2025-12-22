import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { FOCUS_RING, DISABLED, ACTIVE, TRANSITION, TOUCH_TARGET_RESPONSIVE } from '../../constants/interactions';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The icon element to render */
  icon: ReactNode;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Visual variant */
  variant?: 'ghost' | 'outline' | 'solid' | 'danger';
  /** Whether the button is in a pressed/active state */
  isActive?: boolean;
  /** Show loading spinner */
  loading?: boolean;
  /** Accessible label (required for icon-only buttons) */
  'aria-label': string;
}

/**
 * IconButton - Standardized icon-only button component.
 * Use this for all icon-only interactive elements (close buttons, menu buttons, etc.)
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({
    icon,
    size = 'md',
    variant = 'ghost',
    isActive = false,
    loading = false,
    className,
    disabled,
    ...props
  }, ref) => {
    const sizeStyles = {
      sm: 'p-1.5',
      md: 'p-2',
      lg: 'p-2.5',
    };

    const iconSizes = {
      sm: '[&>svg]:w-4 [&>svg]:h-4',
      md: '[&>svg]:w-5 [&>svg]:h-5',
      lg: '[&>svg]:w-6 [&>svg]:h-6',
    };

    const variantStyles = {
      ghost: cn(
        'text-slate-500 dark:text-slate-400',
        'hover:bg-slate-100 dark:hover:bg-slate-800',
        'hover:text-slate-700 dark:hover:text-slate-200',
        isActive && 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
      ),
      outline: cn(
        'text-slate-600 dark:text-slate-300',
        'border border-slate-200 dark:border-slate-700',
        'hover:bg-slate-50 dark:hover:bg-slate-800',
        'hover:border-slate-300 dark:hover:border-slate-600',
        isActive && 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600'
      ),
      solid: cn(
        'text-white',
        'bg-primary-600 hover:bg-primary-700',
        'shadow-sm hover:shadow-md',
        isActive && 'bg-primary-700'
      ),
      danger: cn(
        'text-slate-500 dark:text-slate-400',
        'hover:bg-red-50 dark:hover:bg-red-900/20',
        'hover:text-red-600 dark:hover:text-red-400',
        isActive && 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
      ),
    };

    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          // Base styles
          'inline-flex items-center justify-center rounded-lg',
          TRANSITION,
          FOCUS_RING,
          DISABLED,
          ACTIVE,
          // Mobile touch target
          TOUCH_TARGET_RESPONSIVE,
          // Size
          sizeStyles[size],
          iconSizes[size],
          // Variant
          variantStyles[variant],
          className
        )}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : (
          icon
        )}
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';
