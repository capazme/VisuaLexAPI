import { forwardRef, type SelectHTMLAttributes, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { FOCUS_RING, DISABLED, TRANSITION } from '../../constants/interactions';

export interface FormSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /** Label text */
  label?: string;
  /** Error message */
  error?: string;
  /** Helper text */
  helperText?: string;
  /** Visual variant */
  variant?: 'default' | 'glass';
  /** Icon to show on the left */
  icon?: ReactNode;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * FormSelect - Standardized select component matching Input styling.
 */
export const FormSelect = forwardRef<HTMLSelectElement, FormSelectProps>(
  ({
    label,
    error,
    helperText,
    variant = 'default',
    icon,
    size = 'md',
    className,
    children,
    ...props
  }, ref) => {
    const variantStyles = {
      default: cn(
        'bg-slate-50 dark:bg-slate-900/50',
        'border-slate-200 dark:border-slate-700',
        error && 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/10'
      ),
      glass: cn(
        'bg-white/50 dark:bg-slate-900/20',
        'backdrop-blur-sm',
        'border-white/20 dark:border-white/10',
        error && 'border-red-300/70 dark:border-red-500/50'
      ),
    };

    const sizeStyles = {
      sm: 'py-1.5 text-xs',
      md: 'py-2.5 text-sm',
      lg: 'py-3 text-base',
    };

    return (
      <div className="space-y-1.5 w-full">
        {label && (
          <label className="block text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase ml-1 mb-1">
            {label}
          </label>
        )}

        <div className="relative">
          {icon && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
              {icon}
            </div>
          )}

          <select
            ref={ref}
            className={cn(
              'w-full border rounded-xl appearance-none cursor-pointer',
              TRANSITION,
              FOCUS_RING.replace('focus-visible:', 'focus:'),
              'focus:border-primary-500',
              DISABLED,
              'text-slate-900 dark:text-slate-100',
              variantStyles[variant],
              sizeStyles[size],
              icon ? 'pl-10 pr-10' : 'pl-4 pr-10',
              className
            )}
            {...props}
          >
            {children}
          </select>

          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
            <ChevronDown size={16} />
          </div>
        </div>

        {(error || helperText) && (
          <p
            className={cn(
              'text-xs ml-1',
              error ? 'text-red-500 dark:text-red-400 font-medium' : 'text-slate-500 dark:text-slate-400'
            )}
          >
            {error || helperText}
          </p>
        )}
      </div>
    );
  }
);

FormSelect.displayName = 'FormSelect';
