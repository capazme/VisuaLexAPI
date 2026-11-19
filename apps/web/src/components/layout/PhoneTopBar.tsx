import type { ReactNode, Ref } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { FOCUS_RING } from '../../constants/interactions';
import { Z_INDEX } from '../../constants/zIndex';
import { cn } from '../../lib/utils';
import { ServiceHealthDot } from '../ui/ServiceHealthMenuEntry';
import { SEARCH_ISLAND_ID, ISLAND_FOCUS, ISLAND_HINT, ISLAND_LENS, ISLAND_SHAPE, ISLAND_SURFACE, ISLAND_TARGET, ISLAND_TEXT } from '../../utils/searchFieldControl';

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
  /** The section's name beside the menu, always (LC34, Luca: not over the page's title). */
  section: string;
  /** The name in the middle: none while the page's title is in sight (empty), else the page's (`phoneBarTitle`). */
  title: string;
  /** Out of the way while the reader scrolls down (`useHideOnScroll`); only on a phone, below `md`. */
  hidden: boolean;
  /** Focus landing in the hidden bar brings it back. */
  onReveal: () => void;
  /** The magnifier: the search menu (the palette), on any page. */
  onSearch: () => void;
  /** The bar's element, for `useHideOnScroll`: it never hides while the focus is inside it. */
  barRef?: Ref<HTMLElement>;
  /** «Dicci cosa ti serve» (LC141), after the search. */
  action?: ReactNode;
}

/**
 * The bar at the top of every page below `lg` but the search page, whose bar is the search field (M1): the menu at
 * the left, in the middle nothing while the page's title is in sight under it and the page's name once it has
 * scrolled out (G8, as iOS's large titles), the search on the right. It lies over
 * the content area, which starts under it, on the page's paper with a hairline under it. On a phone it slides up out
 * of the way scrolling down and comes back scrolling up — at once under reduced motion; from `md` it stays, and its
 * right side leaves room for `Layout`'s «Commenti» and Focus button.
 */
export function PhoneTopBar({ menu, section, title, hidden, onReveal, onSearch, barRef, action }: PhoneTopBarProps) {
  return (
    <header
      ref={barRef}
      data-testid="phone-top-bar"
      // It lies over the content: the search's band starts under it (`CommandPalette`).
      data-palette-bar="over"
      onFocus={onReveal}
      className={cn(
        // `vlx-phone-bar`: named during a section change (index.css, T1), so the page's picture passes under it.
        'vlx-phone-bar absolute inset-x-0 top-0 border-b border-slate-200 bg-slate-50 pt-[env(safe-area-inset-top)] lg:hidden dark:border-slate-800 dark:bg-slate-950',
        Z_INDEX.floating,
        'transition-[translate] duration-200 ease-out motion-reduce:transition-none',
        hidden && 'max-md:-translate-y-full',
      )}
    >
      {/* `px-1`: the menu's icon lines up with the page's 16 px margin. From md the room of «Commenti» and «Tutto
          schermo», as the search field's bar: 10.5 rem, 8 px of air at 768 (LC4). */}
      <div className="relative flex h-14 items-center gap-1 px-1 md:pr-[10.5rem] [&:has([data-palette-slot]:not(:empty))>[data-bar-title]]:invisible [&:has([data-palette-slot]:not(:empty))>[data-bar-action]]:invisible">
        <MenuToggle {...menu} />
        {/* Keyed by the name: the page's, once the title has scrolled out, fades in, 150 ms; at once under reduced motion
            (G8; inspired by iOS's large titles, written from scratch). Empty, it keeps its place between the buttons. */}
        {/* The section beside the menu, always, crisp (LC34, Luca: «non ha senso che Work sia scritto lì e non accanto alle
            tre lineette»); the page's name after it once the title has scrolled out, as the desk's path («Learn › Oggi»). */}
        <p data-bar-title="" className="flex min-w-0 flex-1 items-center gap-1.5 truncate pl-1 text-[15px] font-semibold text-slate-900 dark:text-slate-50">
          <span data-bar-section className="shrink-0">{section}</span>
          {title && (
            <span key={title} data-bar-name className="flex min-w-0 items-center gap-1.5 font-normal text-slate-600 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150 dark:text-slate-400">
              <ChevronRight aria-hidden size={14} className="shrink-0" />
              <span className="truncate">{title}</span>
            </span>
          )}
        </p>
        <button
          type="button"
          // Safari does not focus a button it clicks: focused here, so the search menu gives the focus back to it.
          onClick={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            onSearch();
          }}
          aria-label="Apri il menu di ricerca"
          // LC40 (Luca: the island on the phone too): a pill, «Cerca», the menu grows out of it (`CommandPalette`).
          id={SEARCH_ISLAND_ID}
          data-compact=""
          className={cn(
            // LC81: the panel's field's shape, type and lens (40 px and 16 px, as the search page's pill).
            'mr-3 w-40 shrink-0 transition-colors', ISLAND_SHAPE, ISLAND_TEXT, ISLAND_HINT, ISLAND_SURFACE, ISLAND_TARGET,
            'active:bg-slate-100 dark:active:bg-slate-800',
            ISLAND_FOCUS,
          )}
        >
          <Search aria-hidden className={ISLAND_LENS} />
          <span aria-hidden>Cerca</span>
        </button>
        {action}
        {/* L-75: the search's field grows out of «Cerca» leftwards, over the bar's title, up to the menu button. */}
        <div data-palette-slot="" className="absolute inset-y-0 left-12 right-4 flex items-center empty:hidden md:right-[calc(10.5rem+0.75rem)]" />
      </div>
    </header>
  );
}
