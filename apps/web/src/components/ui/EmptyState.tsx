import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Illustration, type IllustrationName } from './Illustration';

export interface EmptyStateProps {
  variant: 'dossier' | 'history' | 'environment' | 'search' | 'bookmarks' | 'threads' | 'notifications' | 'generic';
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  /** LC35: an engraving over the words, where the list has one of its own. */
  art?: IllustrationName;
}

/**
 * An empty list's words (LC21): what is missing, what it is for, and the one way to begin. The template's drawn
 * folders, clocks and globes went in LC21; since LC35 (Luca, 16 November) a list may show one of LexCraft's own
 * engravings (`art`, `ui/Illustration`). `variant` stays for the callers and a test that names the case.
 */
export function EmptyState({ variant, title, description, action, className, art }: EmptyStateProps) {
  return (
    <div data-variant={variant} className={cn('text-center py-12 md:py-16 px-4', className)}>
      {art && <Illustration name={art} className="mx-auto mb-5 h-28 w-28" />}
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
