import { Fragment, useEffect, useId, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Expand } from '../../ui/Expand';
import { IconButton } from '../../ui/IconButton';
import { CARD_RADIUS, CONTROL_BORDER } from '../../ui/controlStyles';
import { cn } from '../../../lib/utils';

interface Props<T> {
  /** What the space is about; null, closed. Kept while the space closes, so the closing shows it, not an empty box. */
  value: T | null;
  onClose: () => void;
  icon?: ReactNode;
  title: string | ((value: T) => string);
  line?: (value: T) => ReactNode;
  /** For a confirmation's `focusBack` inside it: the space itself. */
  id?: string;
  className?: string;
  /** Esc closes it with the focus anywhere on the page, but inside another space, a dialog or a menu (a space that
   * opened with the page and took no focus: an old link's import). */
  closeOnPageEscape?: boolean;
  /** `setBusy(true)` while the server works: Esc and «Chiudi» wait, the answer has a place to land. */
  children: (value: T, setBusy: (busy: boolean) => void) => ReactNode;
}

/**
 * A Forum window brought into the page (LC138, L-73): a space that opens in the flow (`Expand`, `role="region"`), with
 * its title and «Chiudi». The focus lands on the space, never in a field; Esc and «Chiudi» close it and the focus goes
 * back to what opened it. Another value while open starts its content afresh.
 */
export function ForumSpace<T>({ value, onClose, icon, title, line, id, className, closeOnPageEscape = false, children }: Props<T>) {
  const [shown, setShown] = useState(value);
  if (value !== null && value !== shown) setShown(value);
  const [busy, setBusy] = useState(false);
  if (value === null && busy) setBusy(false);
  const headingId = useId();
  const close = () => { if (!busy) onClose(); };
  useEffect(() => {
    if (!closeOnPageEscape || value === null || busy) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const active = document.activeElement;
      if (active?.closest('[role="region"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeOnPageEscape, value, busy, onClose]);
  const key = typeof shown === 'string' ? shown : (shown as { id?: string } | null)?.id;
  return (
    <Expand id={id} open={value !== null} onClose={close} role="region" aria-labelledby={headingId} className={cn('bg-card', CARD_RADIUS, CONTROL_BORDER, className)}>
      {shown !== null && (
        <Fragment key={key}>
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 md:px-5 dark:border-slate-700">
            <div className="flex min-w-0 items-center gap-3">
              {icon}
              <div className="min-w-0">
                <h2 id={headingId} className="text-base font-semibold text-slate-900 dark:text-white">
                  {typeof title === 'string' ? title : title(shown)}
                </h2>
                {line && <p className="text-sm text-slate-600 dark:text-slate-400">{line(shown)}</p>}
              </div>
            </div>
            <IconButton onClick={close} disabled={busy} aria-label="Chiudi" icon={<X aria-hidden />} className="shrink-0" />
          </div>
          <div className="space-y-4 px-4 py-4 md:px-5">{children(shown, setBusy)}</div>
        </Fragment>
      )}
    </Expand>
  );
}
