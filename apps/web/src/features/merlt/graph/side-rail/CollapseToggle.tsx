import { Network, X } from 'lucide-react';
import { cn } from '../../../../lib/utils';

export interface CollapseToggleProps {
  isOpen: boolean;
  onToggle: () => void;
}

/**
 * Side-rail open/close control. When closed it is a thin sticky tab with the
 * Network icon; when open it becomes a close (X) button in the panel header.
 */
export function CollapseToggle({ isOpen, onToggle }: CollapseToggleProps): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      aria-label={isOpen ? 'Comprimi grafo' : 'Espandi grafo'}
      className={cn(
        'flex items-center justify-center transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
        // 44 px wide on a phone, closed and open (M1).
        isOpen
          ? 'h-11 w-11 rounded text-slate-400 hover:text-slate-700 md:h-7 md:w-7 dark:hover:text-slate-200'
          : 'h-auto w-11 flex-col gap-1 rounded-l-lg bg-slate-800 px-2 py-3 text-slate-100 hover:bg-slate-700 md:w-10'
      )}
    >
      {isOpen ? (
        <X className="h-4 w-4" />
      ) : (
        <>
          <Network className="h-4 w-4" />
          <span className="text-xs [writing-mode:vertical-rl]">Grafo</span>
        </>
      )}
    </button>
  );
}
