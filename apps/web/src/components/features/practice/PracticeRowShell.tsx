import type { CSSProperties, ReactNode } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '../../../lib/utils';

const ICON_BUTTON =
  'flex min-h-[44px] min-w-[44px] flex-shrink-0 items-center justify-center rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 md:min-h-0 md:min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-900/20';

export interface PracticeRowShellProps {
  rowKey: string;
  isOpen: boolean;
  onToggle: () => void;
  /** The toggle's accessible name without the verb; it must contain the visible text. */
  name: string;
  /** The remove button's accessible name, after «Togli dal tavolo». */
  removeName: string;
  onRemove: () => void;
  /** The visible header content (label, rubrica, deposit, version chip). */
  header: ReactNode;
  /** Set on the open region (e.g. the reading toolbar's pin). */
  regionStyle?: CSSProperties;
  /** Mounted only while the row is open. */
  children: ReactNode;
}

/**
 * The shell shared by the practice's rows (articles and decisions): a header that toggles the row
 * (accordion pattern), a hover-revealed «Togli dal tavolo», and the open region. The hover tint is
 * the header's: hovering the open text does not wash it. A closed row renders no children.
 */
export function PracticeRowShell({
  rowKey, isOpen, onToggle, name, removeName, onRemove, header, regionStyle, children,
}: PracticeRowShellProps) {
  const regionId = `practice-row-${rowKey}`;
  return (
    <div
      data-practice-row={rowKey}
      // Clear of the act's sticky heading (`--practice-head`, set by the act block) when scrolled into view.
      className="group scroll-mt-[calc(var(--practice-head,5rem)+0.5rem)] rounded-lg py-1 pl-2 pr-1"
    >
      <div className="flex items-center gap-1 rounded-lg transition-colors hover:bg-slate-50 md:gap-2 dark:hover:bg-slate-800/60">
        {/* The toggle wraps only text: the remove button stays outside it (gotcha 22). */}
        <div
          role="button"
          tabIndex={0}
          aria-label={`${isOpen ? 'Comprimi' : 'Espandi'} ${name}`}
          aria-expanded={isOpen}
          aria-controls={isOpen ? regionId : undefined}
          onClick={onToggle}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggle();
            }
          }}
          className="flex min-h-[44px] min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md py-1 md:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <ChevronDown
            size={16}
            aria-hidden
            className={cn('flex-shrink-0 text-slate-400 transition-transform', !isOpen && '-rotate-90')}
          />
          {header}
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Togli dal tavolo ${removeName}`}
          title="Togli dal tavolo"
          className={cn(ICON_BUTTON, 'md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100')}
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      {isOpen && (
        <div id={regionId} className="pb-3 pl-2 pr-1 pt-1 md:pl-6 md:pr-2" style={regionStyle}>
          {children}
        </div>
      )}
    </div>
  );
}
