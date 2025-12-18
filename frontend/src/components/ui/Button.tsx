import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'glass' | 'outline';
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
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary/50',
      'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
      'active:scale-[0.98]'
    );

    const variantStyles = {
      primary: cn(
        'bg-primary-600 hover:bg-primary-700 active:bg-primary-800',
        'text-white',
        'shadow-md hover:shadow-lg hover:shadow-primary/20',
        'border border-transparent',
        'hover:-translate-y-0.5'
      ),
      secondary: cn(
        'bg-white dark:bg-slate-800',
        'text-slate-700 dark:text-slate-200',
        'border border-slate-200 dark:border-slate-700',
        'hover:bg-slate-50 dark:hover:bg-slate-700',
        'hover:text-slate-900 dark:hover:text-white',
        'shadow-sm hover:shadow-md hover:border-slate-300 dark:hover:border-slate-600'
      ),
      outline: cn(
        'bg-transparent',
        'text-slate-600 dark:text-slate-300',
        'border border-slate-200 dark:border-slate-700',
        'hover:bg-slate-50 dark:hover:bg-slate-800',
        'hover:text-slate-900 dark:hover:text-white',
        'hover:border-slate-300 dark:hover:border-slate-600'
      ),
      ghost: cn(
        'bg-transparent',
        'text-slate-600 dark:text-slate-400',
        'hover:bg-slate-100 dark:hover:bg-slate-800',
        'hover:text-slate-900 dark:hover:text-slate-100'
      ),
      danger: cn(
        'bg-red-600 hover:bg-red-700',
        'text-white',
        'shadow-sm hover:shadow-md hover:shadow-red-500/20',
        'hover:-translate-y-0.5'
      ),
      glass: cn(
        'bg-white/60 dark:bg-slate-800/60',
        'backdrop-blur-md',
        'border border-white/20 dark:border-white/5',
        'text-slate-700 dark:text-slate-200',
        'hover:bg-white/80 dark:hover:bg-slate-700/80',
        'shadow-sm hover:shadow-md',
        'hover:-translate-y-0.5'
      ),
    };

    const sizeStyles = {
      sm: 'px-3 py-1.5 text-xs rounded-lg',
      md: 'px-4 py-2 text-sm rounded-lg',
      lg: 'px-6 py-3 text-base rounded-lg',
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
