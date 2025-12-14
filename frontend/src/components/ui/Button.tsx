import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'glass';
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  loading?: boolean;
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', icon, loading, children, className, disabled, ...props }, ref) => {
    const baseStyles = cn(
      'inline-flex items-center justify-center gap-2 font-medium',
      'transition-all duration-200 ease-smooth-out',
      'focus:outline-none focus:ring-2 focus:ring-offset-2',
      'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
      'active:scale-[0.98]'
    );

    const variantStyles = {
      primary: cn(
        'bg-gradient-to-b from-blue-500 to-blue-600',
        'hover:from-blue-400 hover:to-blue-500',
        'text-white',
        'shadow-[0_4px_14px_rgba(37,99,235,0.4),inset_0_1px_0_rgba(255,255,255,0.2)]',
        'hover:shadow-[0_6px_20px_rgba(37,99,235,0.5),inset_0_1px_0_rgba(255,255,255,0.25)]',
        'hover:-translate-y-0.5',
        'focus:ring-blue-500'
      ),
      secondary: cn(
        'bg-white/80 dark:bg-gray-800/80',
        'hover:bg-white dark:hover:bg-gray-700',
        'text-gray-900 dark:text-gray-100',
        'border border-gray-200/80 dark:border-gray-600/80',
        'shadow-sm hover:shadow-md',
        'focus:ring-gray-500'
      ),
      ghost: cn(
        'hover:bg-gray-100/80 dark:hover:bg-gray-800/80',
        'text-gray-700 dark:text-gray-300',
        'focus:ring-gray-500'
      ),
      danger: cn(
        'bg-gradient-to-b from-red-500 to-red-600',
        'hover:from-red-400 hover:to-red-500',
        'text-white',
        'shadow-[0_4px_14px_rgba(239,68,68,0.4),inset_0_1px_0_rgba(255,255,255,0.2)]',
        'hover:shadow-[0_6px_20px_rgba(239,68,68,0.5)]',
        'hover:-translate-y-0.5',
        'focus:ring-red-500'
      ),
      glass: cn(
        'bg-white/60 dark:bg-gray-800/60',
        'backdrop-blur-xl',
        'hover:bg-white/80 dark:hover:bg-gray-700/80',
        'text-gray-700 dark:text-gray-200',
        'border border-white/30 dark:border-white/10',
        'shadow-[0_2px_8px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.25)]',
        'hover:shadow-[0_4px_12px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.3)]',
        'hover:-translate-y-0.5',
        'focus:ring-blue-500/50'
      ),
    };

    const sizeStyles = {
      sm: 'px-3 py-1.5 text-sm rounded-lg',
      md: 'px-4 py-2.5 text-sm rounded-xl',
      lg: 'px-6 py-3.5 text-base rounded-xl',
    };

    return (
      <button
        ref={ref}
        className={cn(
          baseStyles,
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <>
            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            <span>Loading...</span>
          </>
        ) : (
          <>
            {icon && <span className="shrink-0">{icon}</span>}
            {children}
          </>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';
