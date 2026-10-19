import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'glass' | 'elevated' | 'glass-elevated' | 'outline';
  hover?: boolean;
  children: ReactNode;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ variant = 'default', hover = false, children, className, ...props }, ref) => {
    const baseStyles = 'rounded-xl transition-all duration-200 ease-smooth-out';

    const variantStyles = {
      default: cn(
        'bg-white dark:bg-slate-900',
        'border border-slate-200 dark:border-slate-800',
        'shadow-sm'
      ),
      outline: cn(
        'bg-transparent',
        'border border-slate-200 dark:border-slate-800'
      ),
      glass: cn(
        'bg-white/70 dark:bg-slate-900/70',
        'backdrop-blur-xl',
        'border border-white/20 dark:border-white/10',
        'shadow-sm'
      ),
      elevated: cn(
        'bg-white dark:bg-slate-800',
        'shadow-lg border border-transparent dark:border-slate-700'
      ),
      'glass-elevated': cn(
        'bg-white/80 dark:bg-slate-900/80',
        'backdrop-blur-2xl',
        'border border-white/20 dark:border-white/10',
        'shadow-md'
      ),
    };

    const hoverStyles = hover
      ? 'hover:shadow-md hover:border-slate-300 dark:hover:border-slate-600 hover:-translate-y-0.5 cursor-pointer'
      : '';

    return (
      <div
        ref={ref}
        className={cn(baseStyles, variantStyles[variant], hoverStyles, className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';
