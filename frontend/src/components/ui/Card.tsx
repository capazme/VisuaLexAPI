import { HTMLAttributes, ReactNode, forwardRef } from 'react';
import { cn } from '../../lib/utils';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'glass' | 'elevated';
  hover?: boolean;
  children: ReactNode;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ variant = 'default', hover = false, children, className, ...props }, ref) => {
    const baseStyles = 'rounded-xl transition-all duration-200';

    const variantStyles = {
      default: 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm',
      glass: 'bg-white/70 dark:bg-gray-900/60 backdrop-blur-xl ring-1 ring-gray-900/5 dark:ring-white/10 shadow-2xl',
      elevated: 'bg-white dark:bg-gray-800 shadow-elevated dark:shadow-elevated-lg border border-gray-100 dark:border-gray-800',
    };

    const hoverStyles = hover
      ? 'hover:shadow-md dark:hover:shadow-xl hover:-translate-y-0.5 cursor-pointer'
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
