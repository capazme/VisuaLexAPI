import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  icon?: ReactNode;
  error?: string;
  helperText?: string;
  variant?: 'default' | 'glass';
  onFocusChange?: (focused: boolean) => void;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, icon, error, helperText, variant = 'default', onFocusChange, className, ...props }, ref) => {
    const [isFocused, setIsFocused] = useState(false);

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(true);
      onFocusChange?.(true);
      props.onFocus?.(e);
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(false);
      onFocusChange?.(false);
      props.onBlur?.(e);
    };

    const inputVariants = {
      default: cn(
        'bg-gray-50 dark:bg-gray-800/50',
        'border-gray-200 dark:border-gray-700',
        error && 'border-red-300 dark:border-red-700'
      ),
      glass: cn(
        'bg-white/50 dark:bg-white/[0.08]',
        'backdrop-blur-sm',
        'border-gray-200/50 dark:border-white/10',
        error && 'border-red-300/70 dark:border-red-500/50'
      ),
    };

    return (
      <div className="space-y-1.5">
        {label && (
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 ml-1">
            {label}
          </label>
        )}

        <div
          className={cn(
            'relative group transition-all duration-300 ease-smooth-out',
            isFocused && 'transform scale-[1.01]'
          )}
        >
          {icon && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <div
                className={cn(
                  'transition-colors duration-200',
                  isFocused ? 'text-blue-500' : 'text-gray-400'
                )}
              >
                {icon}
              </div>
            </div>
          )}

          <input
            ref={ref}
            className={cn(
              'w-full py-3 border rounded-xl',
              'transition-all duration-200 ease-smooth-out outline-none',
              'text-gray-900 dark:text-gray-100',
              'placeholder:text-gray-400/70',
              // Focus states
              'focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500',
              'focus:shadow-[0_0_0_3px_rgba(59,130,246,0.1)]',
              inputVariants[variant],
              icon ? 'pl-10 pr-4' : 'px-4',
              className
            )}
            onFocus={handleFocus}
            onBlur={handleBlur}
            {...props}
          />
        </div>

        {(error || helperText) && (
          <p
            className={cn(
              'text-xs ml-1',
              error ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'
            )}
          >
            {error || helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
