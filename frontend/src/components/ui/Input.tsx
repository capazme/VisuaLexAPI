import { InputHTMLAttributes, ReactNode, forwardRef, useState } from 'react';
import { cn } from '../../lib/utils';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  icon?: ReactNode;
  error?: string;
  helperText?: string;
  onFocusChange?: (focused: boolean) => void;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, icon, error, helperText, onFocusChange, className, ...props }, ref) => {
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

    return (
      <div className="space-y-1.5">
        {label && (
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 ml-1">
            {label}
          </label>
        )}

        <div
          className={cn(
            'relative group transition-all duration-300',
            isFocused && 'transform scale-[1.02]'
          )}
        >
          {icon && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <div
                className={cn(
                  'transition-colors',
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
              'w-full py-3 bg-gray-50 dark:bg-gray-800/50 border rounded-xl',
              'focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500',
              'transition-all outline-none',
              'text-gray-900 dark:text-gray-100',
              'placeholder:text-gray-400/70',
              error
                ? 'border-red-300 dark:border-red-700'
                : 'border-gray-200 dark:border-gray-700',
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
