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
        'bg-slate-50 dark:bg-slate-900/50',
        'border-slate-200 dark:border-slate-700',
        error && 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/10'
      ),
      glass: cn(
        'bg-white/50 dark:bg-slate-900/20',
        'backdrop-blur-sm',
        'border-white/20 dark:border-white/10',
        'hover:bg-white/60 dark:hover:bg-slate-900/30',
        error && 'border-red-300/70 dark:border-red-500/50'
      ),
    };

    return (
      <div className="space-y-1.5 w-full">
        {label && (
          <label className="block text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 ml-1 mb-1">
            {label}
          </label>
        )}

        <div
          className={cn(
            'relative group transition-all duration-200 ease-smooth-out',
            isFocused && 'transform scale-[1.005]'
          )}
        >
          {icon && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <div
                className={cn(
                  'transition-colors duration-200',
                  isFocused ? 'text-primary-500' : 'text-slate-400 dark:text-slate-500'
                )}
              >
                {icon}
              </div>
            </div>
          )}

          <input
            ref={ref}
            className={cn(
              'w-full py-2.5 border rounded-lg',
              'transition-all duration-200 ease-smooth-out outline-none',
              'text-slate-900 dark:text-slate-100',
              'placeholder:text-slate-400 dark:placeholder:text-slate-500',
              'text-sm font-medium',
              // Disabled state
              'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800',
              // Focus states - using focus-visible for better keyboard accessibility
              'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary/50 focus:border-primary-500 focus:outline-none',
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

Input.displayName = 'Input';
