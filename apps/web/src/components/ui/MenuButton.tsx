import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Check, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Z_INDEX } from '../../constants/zIndex';

export interface MenuItem {
  label: string;
  /** The click that chose it (a keyboard's has `detail` 0 and no pointer position). */
  onSelect: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  icon?: LucideIcon;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  /** A line under the label (the section switcher's). */
  description?: string;
  /** Set on a choice among items (the active section): the item becomes a `menuitemradio`. */
  checked?: boolean;
  /** A count drawn beside the label and read with it. */
  badge?: number;
}

export interface MenuButtonProps {
  /** The trigger's accessible name. */
  label: string;
  items: MenuItem[];
  /** The trigger's content: an icon, or an icon and a word. */
  children: ReactNode;
  triggerClassName?: string;
  align?: 'left' | 'right';
  /** Where the list opens: under the trigger (default), or over it for a trigger at the bottom of
   *  the screen (the bar of practices). */
  placement?: 'below' | 'above';
  /** A line of explanation over the items, read with the menu but never focused. */
  heading?: string;
  /** Classes for the list (a wider one, a capped height that scrolls), merged over the default `w-56`. */
  menuClassName?: string;
  /** Classes for the wrapper around the trigger and the list (a trigger as wide as its column). */
  className?: string;
}

/**
 * A button that opens a list of actions (WAI-ARIA menu button): arrows, Home
 * and End move, Escape and Tab close, focus returns to the trigger, a click
 * outside closes. Clicks never reach the card it sits in. The dossier's menus.
 */
export function MenuButton({ label, items, children, triggerClassName, align = 'right', placement = 'below', heading, menuClassName, className }: MenuButtonProps) {
  // null = closed; otherwise which item takes the focus once the menu is drawn.
  const [openAt, setOpenAt] = useState<'first' | 'last' | null>(null);
  const open = openAt !== null;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const enabled = items.map((item, index) => (item.disabled ? -1 : index)).filter((index) => index >= 0);
  const focusItem = (index: number | undefined) => {
    if (index !== undefined) itemRefs.current[index]?.focus();
  };

  const close = (returnFocus: boolean) => {
    setOpenAt(null);
    if (returnFocus) triggerRef.current?.focus();
  };

  // The menu is in the DOM only after the render that opens it.
  useEffect(() => {
    if (openAt === 'first') focusItem(enabled[0]);
    else if (openAt === 'last') focusItem(enabled[enabled.length - 1]);
    // Focus once per opening; `enabled` is derived from `items` on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAt]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpenAt(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onTriggerKey = (event: KeyboardEvent) => {
    // Enter and Space are the button's own click, which opens it.
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpenAt('first');
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpenAt('last');
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      close(true);
    }
  };

  const onMenuKey = (event: KeyboardEvent) => {
    const at = enabled.indexOf(itemRefs.current.findIndex((el) => el === document.activeElement));
    const move = (to: number) => {
      event.preventDefault();
      focusItem(enabled[(to + enabled.length) % enabled.length]);
    };
    if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at < 0 ? -1 : at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(enabled.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') close(false);
  };

  return (
    <div ref={wrapperRef} className={cn('relative', className)} onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : setOpenAt('first'))}
        onKeyDown={onTriggerKey}
        className={cn(
          'inline-flex items-center gap-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
          triggerClassName,
        )}
      >
        {children}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          aria-describedby={heading ? `${menuId}-heading` : undefined}
          onKeyDown={onMenuKey}
          className={cn(
            Z_INDEX.dropdown,
            'absolute w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-800',
            placement === 'above' ? 'bottom-full mb-1' : 'mt-1',
            align === 'right' ? 'right-0' : 'left-0',
            menuClassName,
          )}
        >
          {heading && (
            <p id={`${menuId}-heading`} role="presentation" className="px-3 pb-1.5 pt-1 text-xs leading-snug text-slate-500 dark:text-slate-400">
              {heading}
            </p>
          )}
          {items.map((item, index) => (
            <div key={item.label}>
              {item.separatorBefore && <div className="my-1 border-t border-slate-200 dark:border-slate-700" aria-hidden />}
              <button
                ref={(el) => { itemRefs.current[index] = el; }}
                type="button"
                role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={item.checked}
                disabled={item.disabled}
                tabIndex={-1}
                onClick={(event) => { close(true); item.onSelect(event); }}
                className={cn(
                  'flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-sm md:min-h-0',
                  'focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40',
                  item.danger
                    ? 'text-red-600 hover:bg-red-50 focus-visible:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 dark:focus-visible:bg-red-900/20'
                    : 'text-slate-700 hover:bg-slate-100 focus-visible:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700 dark:focus-visible:bg-slate-700',
                )}
              >
                {item.icon && <item.icon size={16} aria-hidden className={cn('shrink-0', item.description && 'self-start mt-0.5')} />}
                {item.description ? (
                  <span className="flex min-w-0 flex-col">
                    <span className={cn(item.checked && 'font-semibold')}>{item.label}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{item.description}</span>
                  </span>
                ) : (
                  item.label
                )}
                {((item.badge ?? 0) > 0 || item.checked) && (
                  <span className="ml-auto flex shrink-0 items-center gap-2 self-start">
                    {(item.badge ?? 0) > 0 && (
                      <>
                        <span aria-hidden className="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none">
                          {(item.badge ?? 0) > 99 ? '99+' : item.badge}
                        </span>
                        <span className="sr-only">, {item.badge} notifiche</span>
                      </>
                    )}
                    {/* The checked item says so in more than its weight; `aria-checked` says it to a screen reader. */}
                    {item.checked && <Check size={16} aria-hidden className="text-primary-600 dark:text-primary-400" />}
                  </span>
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
