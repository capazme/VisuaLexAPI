import { ChevronRight } from 'lucide-react';
import type { BreadcrumbEntry } from './useBreadcrumbHistory';

export interface BreadcrumbHistoryProps {
  entries: BreadcrumbEntry[];
  onNavigate: (urn: string) => void;
}

/**
 * Horizontal trail of the last visited graph centers. The final crumb is the
 * current center (rendered inert); earlier crumbs are clickable to jump back.
 */
export function BreadcrumbHistory({ entries, onNavigate }: BreadcrumbHistoryProps): React.ReactElement | null {
  if (entries.length === 0) return null;

  return (
    <nav aria-label="Cronologia grafo" className="flex flex-wrap items-center gap-1 px-4 py-2 text-xs">
      {entries.map((entry, i) => {
        const isCurrent = i === entries.length - 1;
        return (
          <span key={`${entry.urn}-${i}`} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3 text-slate-300" />}
            <button
              type="button"
              onClick={() => onNavigate(entry.urn)}
              aria-current={isCurrent ? 'page' : undefined}
              className={
                isCurrent
                  ? 'max-w-[160px] truncate font-medium text-slate-700 dark:text-slate-200'
                  : 'max-w-[140px] truncate text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500'
              }
            >
              {entry.label}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
