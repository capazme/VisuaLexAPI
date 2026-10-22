import type { Ref } from 'react';
import { Search } from 'lucide-react';
import { FOCUS_RING } from '../../constants/interactions';
import { Z_INDEX } from '../../constants/zIndex';
import { cn } from '../../lib/utils';
import { ServiceHealthDot } from '../ui/ServiceHealthMenuEntry';

/** A 44 px icon button of the bar: no frame of its own, the bar is the frame. */
const BAR_BUTTON = cn(
  'relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-700 transition-colors duration-150',
  'hover:bg-slate-200/60 active:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-800 dark:active:bg-slate-800',
  FOCUS_RING,
);

export interface MenuToggleProps {
  open: boolean;
  onToggle: () => void;
  /** The services' state in words when it needs a notice («alcune fonti non disponibili»): a dot, and the name says it. */
  notice?: string;
  /** The button, for `Layout` to give it the focus back when the drawer closes from its user menu. */
  buttonRef?: Ref<HTMLButtonElement>;
}

/** The button that opens the drawer below `lg`, at the left of the bar on every page (M1). */
export function MenuToggle({ open, onToggle, notice, buttonRef }: MenuToggleProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      // Where the shell parks the focus as the drawer closes; a section's new title may still take it.
      data-focus-parked=""
      onClick={onToggle}
      aria-label={`${open ? 'Chiudi il menu' : 'Apri il menu'}${notice ? `, ${notice}` : ''}`}
      aria-expanded={open}
      className={cn(BAR_BUTTON, 'lg:hidden')}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
      {notice && <ServiceHealthDot className="absolute right-1.5 top-1.5" />}
    </button>
  );
}

export interface PhoneTopBarProps {
  menu: MenuToggleProps;
  /** The name in the middle: the section's while the page's title is in sight, else the page's (`phoneBarTitle`). */
  title: string;
  /** Out of the way while the reader scrolls down (`useHideOnScroll`); only on a phone, below `md`. */
  hidden: boolean;
  /** Focus landing in the hidden bar brings it back. */
  onReveal: () => void;
  /** The magnifier: the search menu (the palette), on any page. */
  onSearch: () => void;
  /** The bar's element, for `useHideOnScroll`: it never hides while the focus is inside it. */
  barRef?: Ref<HTMLElement>;
}

/**
 * The bar at the top of every page below `lg` but the search page, whose bar is the search field (M1): the menu at
 * the left, in the middle the section's name while the page's title is in sight under it and the page's name once it
 * has scrolled out (G8), the search on the right. It lies over
 * the content area, which starts under it, on the page's paper with a hairline under it. On a phone it slides up out
 * of the way scrolling down and comes back scrolling up — at once under reduced motion; from `md` it stays, and its
 * right side leaves room for `Layout`'s Focus button.
 */
export function PhoneTopBar({ menu, title, hidden, onReveal, onSearch, barRef }: PhoneTopBarProps) {
  return (
    <header
      ref={barRef}
      data-testid="phone-top-bar"
      onFocus={onReveal}
      className={cn(
        // `vlx-phone-bar`: named during a section change (index.css, T1), so the page's picture passes under it.
        'vlx-phone-bar absolute inset-x-0 top-0 border-b border-slate-200 bg-slate-50 pt-[env(safe-area-inset-top)] lg:hidden dark:border-slate-800 dark:bg-slate-950',
        Z_INDEX.floating,
        'transition-[translate] duration-200 ease-out motion-reduce:transition-none',
        hidden && 'max-md:-translate-y-full',
      )}
    >
      {/* `px-1`: the menu's icon lines up with the page's 16 px margin. */}
      <div className="flex h-14 items-center gap-1 px-1 md:pr-[3.25rem]">
        <MenuToggle {...menu} />
        {/* Keyed by the name: a new one — the page's, once the title has scrolled out — fades in, 150 ms; at once under
            reduced motion (G8; inspired by iOS's large titles, written from scratch). */}
        <p key={title} className="min-w-0 flex-1 truncate text-center font-serif text-lg font-medium text-slate-900 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150 dark:text-slate-50">
          {title}
        </p>
        <button
          type="button"
          // Safari does not focus a button it clicks: focused here, so the search menu gives the focus back to it.
          onClick={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            onSearch();
          }}
          aria-label="Apri il menu di ricerca"
          className={BAR_BUTTON}
        >
          <Search size={20} aria-hidden />
        </button>
      </div>
    </header>
  );
}
