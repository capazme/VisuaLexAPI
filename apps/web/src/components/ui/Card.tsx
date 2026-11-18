import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { HOVER_LIFT, TRANSITION } from '../../constants/interactions';
import { CONTROL_BORDER, CONTROL_RADIUS } from './controlStyles';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
  children: ReactNode;
}

/** One box (LC104, Pietra): the paper of a card, the fields' radius and outline, no shadow at rest. */
export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ hover = false, children, className, ...props }, ref) => {
    // A card that lifts stands alone: a row or a list item takes the colour change only (HOVER_LIFT).
    const hoverStyles = hover
      ? cn('hover:border-ink-300 dark:hover:border-ink-700 cursor-pointer', TRANSITION, HOVER_LIFT)
      : '';

    return (
      <div ref={ref} className={cn('bg-card', CONTROL_RADIUS, CONTROL_BORDER, hoverStyles, className)} {...props}>
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';
