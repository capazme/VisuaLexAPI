import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Z_INDEX } from '../../constants/zIndex';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: LucideIcon;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export interface MenuButtonProps {
  /** The trigger's accessible name. */
  label: string;
  items: MenuItem[];
  /** The trigger's content: an icon, or an icon and a word. */
  children: ReactNode;
  triggerClassName?: string;
  align?: 'left' | 'right';
}

/**
 * A button that opens a list of actions (WAI-ARIA menu button): arrows, Home
 * and End move, Escape and Tab close, focus returns to the trigger, a click
 * outside closes. Clicks never reach the card it sits in. The dossier's menus.
 */
export function MenuButton({ label, items, children, triggerClassName, align = 'right' }: MenuButtonProps) {
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
    <div ref={wrapperRef} className="relative" onClick={(e) => e.stopPropagation()}>
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
          onKeyDown={onMenuKey}
          className={cn(
            Z_INDEX.dropdown,
            'absolute mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-800',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, index) => (
            <div key={item.label}>
              {item.separatorBefore && <div className="my-1 border-t border-slate-200 dark:border-slate-700" aria-hidden />}
              <button
                ref={(el) => { itemRefs.current[index] = el; }}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                tabIndex={-1}
                onClick={() => { close(true); item.onSelect(); }}
                className={cn(
                  'flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-sm md:min-h-0',
                  'focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40',
                  item.danger
                    ? 'text-red-600 hover:bg-red-50 focus-visible:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 dark:focus-visible:bg-red-900/20'
                    : 'text-slate-700 hover:bg-slate-100 focus-visible:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700 dark:focus-visible:bg-slate-700',
                )}
              >
                {item.icon && <item.icon size={16} aria-hidden />}
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
