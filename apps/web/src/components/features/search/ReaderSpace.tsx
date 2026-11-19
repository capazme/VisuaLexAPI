import { useEffect, useId, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Expand } from '../../ui/Expand';
import { IconButton } from '../../ui/IconButton';
import { CARD_RADIUS, CONTROL_BORDER } from '../../ui/controlStyles';
import { cn } from '../../../lib/utils';

export interface ReaderSpaceProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** A line under the title (the article, the decision). */
  line?: ReactNode;
  icon?: ReactNode;
  /** For the command's `aria-controls`. */
  id?: string;
  /** While the work it started travels (a PDF being written): Esc and «Chiudi» wait. */
  busy?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * A reader's window brought into the page (LC139, L-73): a space that opens under the reading toolbar (`Expand`,
 * `role="region"`), with its title and «Chiudi». The focus lands on the space, never in a field; Esc and «Chiudi» close
 * it and the focus goes back to what opened it. The Forum's `ForumSpace` (#709) is the same shape: one day, one component.
 */
export function ReaderSpace({ open, onClose, title, line, icon, id, busy = false, className, children }: ReaderSpaceProps) {
  const headingId = useId();
  const ownId = useId();
  const spaceId = id ?? ownId;
  const close = () => { if (!busy) onClose(); };
  // Busy, the pressed button turns off and the browser drops the focus to the page: the space takes it, so the reader
  // stays there and Esc still reaches it once the work is done or has failed.
  useEffect(() => {
    const space = document.getElementById(spaceId);
    const active = document.activeElement;
    if (busy && space && (active === document.body || active === null || space.contains(active))) space.focus({ preventScroll: true });
  }, [busy, spaceId]);
  return (
    <Expand id={spaceId} open={open} onClose={close} role="region" aria-labelledby={headingId} className={cn('my-2 bg-card', CARD_RADIUS, CONTROL_BORDER, className)}>
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 py-2 pl-4 pr-2 dark:border-slate-700">
        <div className="flex min-w-0 items-center gap-2 pt-1.5">
          {icon}
          <div className="min-w-0">
            <h2 id={headingId} className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h2>
            {line && <p className="text-xs text-slate-600 dark:text-slate-400">{line}</p>}
          </div>
        </div>
        <IconButton onClick={close} disabled={busy} aria-label="Chiudi" icon={<X aria-hidden />} variant="quiet" className="shrink-0" />
      </div>
      <div className="px-4 py-3">{children}</div>
    </Expand>
  );
}
