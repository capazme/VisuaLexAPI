import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';

/**
 * A section folded under its heading, closed until the reader opens it, mounting its content only
 * then: «Brocardi» in a light window (spec §4.1), drawn like the «Giurisprudenza» line beside it.
 */
export function ClosedSection({ title, children }: { title: string; children: ReactNode }) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
      <h3 className="text-xs font-bold uppercase text-slate-600 dark:text-slate-300">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'flex w-full items-center justify-between gap-3 text-left uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
            TOUCH_TARGET_RESPONSIVE,
          )}
        >
          <span>{title}</span>
          <ChevronDown size={16} className={cn('transition-transform duration-200', open && 'rotate-180')} />
        </button>
      </h3>
      <div id={panelId} hidden={!open} className="mt-3">
        {open && children}
      </div>
    </div>
  );
}
