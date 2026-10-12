import type { CSSProperties, ReactNode } from 'react';
import { ChevronDown, PanelRightOpen, X } from 'lucide-react';
import { cn } from '../../../lib/utils';

const ICON_BUTTON =
  'flex min-h-[44px] min-w-[44px] flex-shrink-0 items-center justify-center rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 md:min-h-0 md:min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-900/20';

/** A row that can be read beside the table: in a window on the desktop (spec §4.2, T5), in the
 *  full-screen reader on a phone (§8), where no row ever folds. */
export interface RowBeside {
  /** A window shows this subject: the row folds and says so. Always false on a phone. */
  shown: boolean;
  /** «Apri accanto»; asked of a window already open, it takes focus instead. */
  onOpen: () => void;
  /** «Chiudi la finestra»: the subject stays in the table. */
  onClose: () => void;
}

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
  /** «Apri accanto», and on the desktop the fold of a row whose subject a window shows. */
  beside?: RowBeside;
  /** Mounted only while the row is open (and not shown beside). */
  children: ReactNode;
}

/**
 * The shell shared by the practice's rows (articles and decisions): a header that toggles the row
 * (accordion pattern), a hover-revealed «Togli dal tavolo», and the open region. The hover tint is
 * the header's: hovering the open text does not wash it. A closed row renders no children.
 */
export function PracticeRowShell({
  rowKey, isOpen: open, onToggle, name, removeName, onRemove, header, regionStyle, beside, children,
}: PracticeRowShellProps) {
  const regionId = `practice-row-${rowKey}`;
  // One subject, one mounted reading surface (T5): a row shown in a window folds, whatever its stored
  // state, and comes back as it was when the window closes. Its header then points at the window.
  const folded = beside?.shown === true;
  const isOpen = open && !folded;
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
          // Folded because a window shows the subject, the header does not expand: it goes to the window.
          aria-label={folded ? `Vai alla finestra su ${name}` : `${isOpen ? 'Comprimi' : 'Espandi'} ${name}`}
          aria-expanded={folded ? undefined : isOpen}
          aria-controls={isOpen ? regionId : undefined}
          onClick={folded ? beside.onOpen : onToggle}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              (folded ? beside.onOpen : onToggle)();
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
        {beside && (folded ? (
          <span className="flex flex-shrink-0 items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            Aperto accanto ·
            <button
              type="button"
              onClick={beside.onClose}
              aria-label={`Chiudi la finestra su ${removeName}`}
              className="rounded px-1 font-medium text-primary-600 underline hover:text-primary-700 dark:text-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              Chiudi la finestra
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={beside.onOpen}
            aria-label={`Apri accanto ${removeName}`}
            title="Apri accanto"
            className="flex min-h-[44px] min-w-[44px] flex-shrink-0 items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 md:min-h-0 md:min-w-0 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <PanelRightOpen size={14} aria-hidden />
            {/* Icon-only on a phone, where the row's name needs the width. */}
            <span className="hidden md:inline">Apri accanto</span>
          </button>
        ))}
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
