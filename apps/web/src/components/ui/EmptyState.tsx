import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface EmptyStateProps {
  variant: 'dossier' | 'history' | 'environment' | 'search' | 'bookmarks' | 'threads' | 'notifications' | 'generic';
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * An empty list's words (LC21): what is missing, what it is for, and the one way to begin. No illustration: the drawn
 * folders, clocks and globes were the template's, not LexCraft's (anti-slop review, 15 November); `variant` stays for
 * the callers and a test that names the case.
 */
export function EmptyState({ variant, title, description, action, className }: EmptyStateProps) {
  return (
    <div data-variant={variant} className={cn('text-center py-12 md:py-16 px-4', className)}>
      <h3 className="mb-2 font-serif text-[22px] font-normal leading-tight text-slate-900 dark:text-slate-50">
        {title}
      </h3>

      {/* Description */}
      {description && (
        <p className="text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto mb-6">
          {description}
        </p>
      )}

      {/* Action */}
      {action && (
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          {action}
        </div>
      )}
    </div>
  );
}
