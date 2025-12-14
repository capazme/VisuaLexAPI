import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'glass' | 'elevated' | 'glass-elevated';
  hover?: boolean;
  children: ReactNode;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ variant = 'default', hover = false, children, className, ...props }, ref) => {
    const baseStyles = 'rounded-2xl transition-all duration-300 ease-smooth-out';

    const variantStyles = {
      default: 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm',
      glass: cn(
        'bg-white/70 dark:bg-gray-900/70',
        'backdrop-blur-2xl',
        'border border-white/20 dark:border-white/10',
        'shadow-glass-card',
        '[box-shadow:var(--glass-shadow),var(--inner-highlight)]'
      ),
      elevated: cn(
        'bg-white/80 dark:bg-gray-800/80',
        'backdrop-blur-xl',
        'shadow-elevated border border-white/15 dark:border-white/10'
      ),
      'glass-elevated': cn(
        'bg-white/85 dark:bg-gray-900/85',
        'backdrop-blur-3xl',
        'border border-white/25 dark:border-white/15',
        'shadow-glass-elevated',
        '[box-shadow:0_8px_40px_rgba(0,0,0,0.12),0_1px_3px_rgba(0,0,0,0.08),var(--inner-highlight-strong)]'
      ),
    };

    const hoverStyles = hover
      ? 'hover:shadow-glass-lg dark:hover:shadow-xl hover:-translate-y-0.5 hover:scale-[1.01] cursor-pointer active:scale-[0.99] active:translate-y-0'
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
