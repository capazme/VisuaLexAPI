import { useState, useRef, useEffect, useCallback, type FocusEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Folder, Clock, Moon, Sun, Settings, LogOut, Shield, Users, Keyboard, FileSearch, Scale, Network, Bot, Repeat, Layers, ClipboardCheck, PanelLeftClose, PanelLeftOpen, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { isMerltEnabled } from '../../features/merlt/featureFlag';
import { isMerltGraphEnabled } from '../../features/merlt/graph/featureFlag';
import { SectionSwitcher } from '../../features/sections/SectionSwitcher';
import { useSection } from '../../features/sections/useSection';
import { useAppStore } from '../../store/useAppStore';
import { focusSearchField } from '../../utils/searchFieldControl';
import { useAuth } from '../../hooks/useAuth';
import { useForumNotifications } from '../../hooks/useForumNotifications';
import { Z_INDEX } from '../../constants/zIndex';
import { spring } from '../../lib/motion';
import type { SidebarLayout } from './sidebarWidth';

interface SidebarProps {
  theme: string;
  toggleTheme: () => void;
  isOpen: boolean;
  closeMobile: () => void;
  openSettings: () => void;
  openKeyboardShortcuts: () => void;
  /** Icons only (the desktop between `lg` and `xl`, or narrowed), icons and words (from `xl`), or the
   *  phone's drawer (icons and words, rows of 44 px). */
  layout?: SidebarLayout;
  /** Narrows or widens the desktop bar; given only where the words fit (`xl`). */
  onToggleWide?: () => void;
}

interface NavItemProps {
  to: string;
  icon: React.ElementType;
  label: string;
  onClick?: () => void;
  id?: string;
  badgeCount?: number;
  /** The keyboard shortcut that does the same, shown in the hover label (not part of the name). */
  hint?: string;
  layout: SidebarLayout;
}

/**
 * The colour of the bar's 11 px texts (the groups' headings, the shortcut): AA for small text, 4.5:1, on
 * the bar's glass over the page and over the phone's backdrop, light and dark (`theme.test.ts`). Slate 500
 * and 400 fell short (3.8 and 2.6 on the light drawer, 3.8 for the dark shortcut).
 */
export const SIDEBAR_SMALL_TEXT = 'text-slate-600 dark:text-slate-400';

/** The palette's shortcut as this keyboard writes it. */
const PALETTE_SHORTCUT = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘K' : 'Ctrl K';

const menuItemClass = "w-full flex items-center gap-3 px-4 py-2.5 min-h-[44px] md:min-h-0 text-sm focus-visible:outline-none focus-visible:bg-slate-100 dark:focus-visible:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer";

/** The unread "a saved norm changed" notifications, as words: the avatar's name and the menu's entry carry them. */
function normaChangesLabel(count: number): string {
  return count === 1 ? '1 norma salvata cambiata' : `${count} norme salvate cambiate`;
}

/** A count drawn on a control; the control's name says what it counts. */
function CountBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

// Spring config for smooth animations

/**
 * The hover label of a sidebar control. Portalled to `document.body` and placed from the control's
 * rectangle: the navigation scrolls on its own when the window is low (`overflow-y-auto`, which
 * clips whatever sticks out of it), and the aside is a stacking context (backdrop blur), so a label
 * drawn inside either would be cut or trapped (gotcha 22).
 */
function SidebarTooltip({ anchor, label, hint, onDismiss }: { anchor: HTMLElement | null; label: string; hint?: string; onDismiss: () => void }) {
  // Placed from the rectangle it had when it appeared: the navigation scrolling under it, or the
  // window being resized, takes it away rather than leaving it where the control no longer is.
  useEffect(() => {
    window.addEventListener('scroll', onDismiss, true);
    window.addEventListener('resize', onDismiss);
    return () => {
      window.removeEventListener('scroll', onDismiss, true);
      window.removeEventListener('resize', onDismiss);
    };
  }, [onDismiss]);
  if (!anchor) return null;
  const rect = anchor.getBoundingClientRect();
  return createPortal(
    <motion.div
      initial={{ opacity: 0, x: -8, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -8, scale: 0.95 }}
      transition={{ duration: 0.15 }}
      aria-hidden
      data-sidebar-tooltip
      style={{ left: rect.right + 12, top: rect.top + rect.height / 2, translateY: '-50%' }}
      className={cn(
        "hidden md:block fixed pointer-events-none px-3 py-1.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium rounded-lg shadow-lg whitespace-nowrap",
        Z_INDEX.tooltip,
      )}
    >
      {label}
      {hint && <span className="ml-2 opacity-60">{hint}</span>}
      {/* Arrow */}
      <span className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-2 h-2 bg-slate-900 dark:bg-slate-100 rotate-45" />
    </motion.div>,
    document.body,
  );
}

/**
 * When a control's label shows: for a mouse pointer over it (not a touch, which would leave it on
 * screen after a tap, nor a click, which has done its work), and on keyboard focus (`:focus-visible`
 * only: a click focuses too). Esc, a scroll of the navigation and a resize take it away.
 */
function useSidebarLabel() {
  const [shown, setShown] = useState(false);
  const hide = useCallback(() => setShown(false), []);
  const handlers = {
    onPointerEnter: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse') setShown(true);
    },
    onPointerLeave: hide,
    onFocus: (e: FocusEvent<HTMLElement>) => {
      try {
        if (e.currentTarget.matches(':focus-visible')) setShown(true);
      } catch {
        // A browser without `:focus-visible`: the label stays a pointer's.
      }
    },
    onBlur: hide,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Escape') hide();
    },
  };
  return { shown, hide, handlers };
}

function NavItem({ to, icon: Icon, label, onClick, id, badgeCount, hint, layout }: NavItemProps) {
  const { shown: showTooltip, hide, handlers } = useSidebarLabel();
  // State, not a ref object: the tooltip reads the element while rendering (gotcha 13).
  const [linkEl, setLinkEl] = useState<HTMLAnchorElement | null>(null);
  const showBadge = (badgeCount ?? 0) > 0;
  const words = layout !== 'rail';

  // In the rail the whole control is an icon, and `label` only ever reached the eye — the
  // tooltip is `hidden md:block` and shows on hover, so a screen reader and a
  // keyboard user got an unnamed link. The count rides the name because a badge
  // announced on its own arrives without saying what it counts.
  const accessibleName = showBadge ? `${label}, ${badgeCount} notifiche` : label;

  return (
    <NavLink
      ref={setLinkEl}
      to={to}
      id={id}
      aria-label={accessibleName}
      className={({ isActive }) => cn(
        "relative flex shrink-0 items-center rounded-xl transition-colors duration-200",
        "hover:bg-slate-100 dark:hover:bg-slate-800",
        // The icon keeps the same 44 px box in every layout, so widening the bar moves no icon.
        words ? "w-full h-11 overflow-hidden pr-2" : "w-11 h-11",
        isActive && "bg-primary-50 dark:bg-primary-900/10"
      )}
      onClick={() => {
        hide();
        onClick?.();
      }}
      // With its words written, the row needs no label of its own.
      {...(words ? {} : handlers)}
    >
      {({ isActive }) => (
        <>
          {/* A navigation entry is seen tens of times a day: its hover is the colour alone. */}
          <motion.div
            whileTap={{ scale: 0.95 }}
            transition={spring.snappy}
            className="grid h-11 w-11 shrink-0 place-items-center"
          >
            <Icon
              size={22}
              aria-hidden
              className={cn(
                "transition-colors duration-200",
                isActive
                  ? "text-primary-600 dark:text-primary-400 stroke-[2.5px]"
                  : "text-slate-500 dark:text-slate-400 stroke-[2px]"
              )}
            />
          </motion.div>

          {words && (
            <span
              aria-hidden
              className={cn(
                "min-w-0 flex-1 truncate whitespace-nowrap text-sm",
                isActive ? "font-semibold text-primary-700 dark:text-primary-300" : "font-medium text-slate-700 dark:text-slate-300"
              )}
            >
              {label}
            </span>
          )}
          {/* The shortcut, for a keyboard: not in the phone's drawer. */}
          {layout === 'wide' && hint && !showBadge && (
            <kbd aria-hidden className={cn("ml-2 shrink-0 font-sans text-[11px]", SIDEBAR_SMALL_TEXT)}>{hint}</kbd>
          )}

          {/* Active indicator dot */}
          {isActive && (
            <motion.span
              layoutId="activeIndicator"
              className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-primary-600 rounded-r-full"
              transition={spring.snappy}
            />
          )}

          {/* Notification badge: on the icon in the rail, at the end of the row with words. */}
          {showBadge && (
            <CountBadge
              count={badgeCount ?? 0}
              className={words ? "ml-2 shrink-0" : "absolute top-1 right-1 ring-2 ring-white dark:ring-slate-900"}
            />
          )}

          {/* Tooltip - the rail's only, hidden on mobile */}
          <AnimatePresence>
            {!words && showTooltip && <SidebarTooltip anchor={linkEl} label={label} hint={hint} onDismiss={hide} />}
          </AnimatePresence>
        </>
      )}
    </NavLink>
  );
}

/**
 * A group of entries, named for a screen reader; with words, its name is also written over it. In the
 * rail a thin line stands for the heading.
 */
function NavGroup({ name, heading, layout, children }: { name: string; heading?: boolean; layout: SidebarLayout; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={name} className="flex w-full flex-col items-start gap-3 md:gap-2">
      {heading && layout !== 'rail' && (
        <p aria-hidden className={cn("w-full truncate whitespace-nowrap px-3 pt-1 text-[11px] font-semibold uppercase tracking-[0.08em]", SIDEBAR_SMALL_TEXT)}>
          {name}
        </p>
      )}
      {children}
    </div>
  );
}

/** The desktop's control that narrows the bar to its icons or widens it to its words. */
function WidthToggle({ layout, onToggle }: { layout: SidebarLayout; onToggle: () => void }) {
  const { shown, hide, handlers } = useSidebarLabel();
  const [el, setEl] = useState<HTMLButtonElement | null>(null);
  const wide = layout === 'wide';
  const label = wide ? 'Riduci la barra laterale' : 'Allarga la barra laterale';
  const Icon: LucideIcon = wide ? PanelLeftClose : PanelLeftOpen;
  return (
    <button
      ref={setEl}
      type="button"
      aria-label={label}
      onClick={() => {
        hide();
        onToggle();
      }}
      {...(wide ? {} : handlers)}
      className={cn(
        "flex h-11 shrink-0 items-center rounded-xl text-slate-500 dark:text-slate-400 transition-colors duration-200",
        "hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
        wide ? "w-full overflow-hidden" : "w-11",
      )}
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center"><Icon size={20} aria-hidden /></span>
      {wide && <span aria-hidden className="min-w-0 truncate whitespace-nowrap text-sm">Riduci</span>}
      <AnimatePresence>
        {!wide && shown && <SidebarTooltip anchor={el} label={label} onDismiss={hide} />}
      </AnimatePresence>
    </button>
  );
}

export function Sidebar({ theme, toggleTheme, isOpen, closeMobile, openSettings, openKeyboardShortcuts, layout = 'rail', onToggleWide }: SidebarProps) {
  const navigate = useNavigate();
  const quickNorms = useAppStore((s) => s.quickNorms);
  const { user, isAdmin, isValidator, logout } = useAuth();
  const { section, active } = useSection();
  const { count: forumNotifications } = useForumNotifications(!!user);
  // Cronologia lives in the user menu (the owner, 13 Oct 2026); the saved norms that changed are
  // counted on the avatar and beside the entry («ok come raccomandi»).
  const normaChanges = forumNotifications.normaChanges ?? 0;
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ bottom: 0, left: 0 });

  const words = layout !== 'rail';

  // Calculate menu position when showing
  useEffect(() => {
    if (showUserMenu && userButtonRef.current) {
      const rect = userButtonRef.current.getBoundingClientRect();
      // Beside the rail's avatar, aligned to its bottom; over the wider button of the bar with words
      // (on a phone a menu beside it would leave the screen).
      setMenuPosition(words
        ? { bottom: window.innerHeight - rect.top + 8, left: rect.left }
        : { bottom: window.innerHeight - rect.bottom, left: rect.right + 8 });
    }
  }, [showUserMenu, words]);

  // «Ricerca» is the search page with the cursor in its field, no window over it (the owner, 13 Oct
  // 2026: «ok come raccomandi»); ⌘K is the palette. The link itself navigates.
  const handleSearchClick = () => {
    focusSearchField({}, { wait: true });
    closeMobile();
  };

  // Academia's entries: the section is offered only with the development mode (sections spec S12), and
  // the MERL-T flags still decide each entry. Plain flag functions (not useMerltFeatures) keep the
  // Sidebar free of the consent/auth providers.
  const showAssistant = isMerltEnabled();
  const showGraph = showAssistant && isMerltGraphEnabled();

  // The menu is drawn through a portal, so it is a menu button of its own (WAI-ARIA, as `ui/MenuButton`):
  // focus goes to the first entry when it opens (the last, from ArrowUp), the arrows, Home and End move,
  // Esc closes and gives focus back to the avatar, Tab closes and goes on from the avatar, a click
  // outside closes (the backdrop).
  const [openAt, setOpenAt] = useState<'first' | 'last'>('first');
  const menuItems = () => [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  const openMenu = (at: 'first' | 'last') => {
    setOpenAt(at);
    setShowUserMenu(true);
  };
  const closeMenu = (returnFocus: boolean) => {
    setShowUserMenu(false);
    if (returnFocus) userButtonRef.current?.focus();
  };
  useEffect(() => {
    if (!showUserMenu) return;
    const items = menuItems();
    (openAt === 'last' ? items[items.length - 1] : items[0])?.focus();
    // Once per opening; `openAt` is set in the same update that opens it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showUserMenu]);

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    // Enter and Space are the button's own click.
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu(event.key === 'ArrowDown' ? 'first' : 'last');
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = menuItems();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      event.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at < 0 ? -1 : at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(items.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === 'Tab') closeMenu(true);
  };

  // A menu entry closes the menu (and the phone's off-canvas copy), gives focus back to the avatar (where a
  // dialog it opens returns it) and then acts.
  const fromMenu = (action: () => void) => () => {
    closeMenu(true);
    closeMobile();
    action();
  };

  return (
    <aside
      className={cn(
        // Base layout
        "fixed inset-y-0 left-0 z-50 flex flex-col",
        // On the desktop it fills the row it sits in, never taller: a low window scrolls the
        // navigation, not the document.
        "lg:h-full",
        // The desktop copy is as wide as its column, which `Layout` sizes (64 px, or 224 with words);
        // the phone's drawer has room for its words.
        layout === 'drawer' ? "w-[17rem] max-w-[85vw]" : "w-full",
        // Clean Slate/Glass effect
        "bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl",
        "border-r border-slate-200 dark:border-slate-800",
        // Mobile slide
        "transform transition-transform duration-300 ease-smooth-out",
        // `relative`, not `static`: backdrop-blur makes this aside a stacking
        // context, so anything inside it (hover tooltips) is trapped at the
        // aside's own level. Static would leave z-50 inert and page content
        // would paint over the tooltips.
        "lg:translate-x-0 lg:relative",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}
    >
      {/* The section switcher, where the open book was (sections spec S3). Below `lg` the layout's floating
          menu button sits at the top left, over this place: the switcher goes under it. Every column keeps
          10 px of side padding, so a 44 px control in the 64 px rail sits where it sits in the wide bar. */}
      <div id="tour-section-switcher" className="flex items-center px-2.5 pt-[4.5rem] pb-2 lg:p-0 lg:px-2.5 lg:h-16 border-b border-slate-100 dark:border-slate-800/50">
        <SectionSwitcher forumCount={forumNotifications.total} onChoose={closeMobile} withName={words} />
      </div>

      {/* Navigation */}
      {/* The one part that scrolls when the window is low (sixteen icons were 935 px tall): its labels are
          portalled (`SidebarTooltip`), so the overflow clips nothing. The scrollbar is thin, so a
          very low window shows there is more. It clips the words while the bar narrows or widens. */}
      {/* `layoutScroll`: the active indicator's shared-layout animation measures against the nav's scroll. */}
      <motion.nav
        layoutScroll
        id="tour-sidebar"
        className="min-h-0 flex-1 flex flex-col items-start overflow-y-auto overflow-x-hidden overscroll-contain px-2.5 py-4 gap-3 md:gap-2 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1"
      >
        <NavItem to="/" icon={Search} label="Ricerca" hint={PALETTE_SHORTCUT} id="tour-nav-search" onClick={handleSearchClick} layout={layout} />
        {quickNorms.length > 0 && (
          <div className="-mt-1 ml-3 w-5 h-1 rounded-full bg-amber-500/60" title={`${quickNorms.length} preferiti`} />
        )}
        <NavItem to="/documents" icon={FileSearch} label="Analizza documento" onClick={closeMobile} layout={layout} />
        {/* The active section's entries, after the Corpus ones above (sections spec S6). */}
        <div role="group" aria-label={active.name} className="mt-1 flex w-full flex-col items-start gap-3 md:gap-2 border-t border-slate-100 dark:border-slate-800/50 pt-3 md:pt-2">
          {section === 'gymnasium' && (
            <>
              {/* Studying, then writing and validating (Gymnasium spec §4). */}
              <NavGroup name="Studia" heading layout={layout}>
                <NavItem to="/studia/ripasso" icon={Repeat} label="Oggi" onClick={closeMobile} layout={layout} />
                <NavItem to="/dossier" icon={Folder} label="Dossier" onClick={closeMobile} id="tour-nav-dossier" layout={layout} />
              </NavGroup>
              {layout === 'rail' && <div aria-hidden className="mx-auto h-px w-6 bg-slate-200 dark:bg-slate-700" />}
              <NavGroup name="Contribuisci" heading layout={layout}>
                <NavItem to="/studia/schede" icon={Layers} label="Le mie schede" onClick={closeMobile} layout={layout} />
                {isValidator && <NavItem to="/studia/valida" icon={ClipboardCheck} label="Da validare" onClick={closeMobile} layout={layout} />}
              </NavGroup>
            </>
          )}
          {(section === 'opus' || section === 'forum' || (section === 'academia' && showAssistant)) && words && (
            <p aria-hidden className={cn("w-full truncate whitespace-nowrap px-3 pt-1 text-[11px] font-semibold uppercase tracking-[0.08em]", SIDEBAR_SMALL_TEXT)}>
              {active.name}
            </p>
          )}
          {section === 'opus' && (
            <NavItem to="/dossier" icon={Folder} label="Dossier" onClick={closeMobile} id="tour-nav-dossier" layout={layout} />
          )}
          {section === 'academia' && showAssistant && (
            <>
              <NavItem to="/merlt" icon={Scale} label="Assistente" onClick={closeMobile} layout={layout} />
              {/* Slice 4 Decision A: /grafo is the Q&A surface; the hub stays at /merlt. */}
              {showGraph && <NavItem to="/grafo" icon={Network} label="Grafo" onClick={closeMobile} layout={layout} />}
            </>
          )}
          {section === 'forum' && (
            <NavItem to="/forum" icon={Users} label="Forum" onClick={closeMobile} badgeCount={forumNotifications.total} layout={layout} />
          )}
        </div>
      </motion.nav>

      {/* User Menu, and on the desktop from `xl` the control that narrows or widens the bar. On a phone the
          drawer's foot clears the home indicator. */}
      <div className={cn(
        "flex flex-col items-start gap-1 px-2.5 py-4 border-t border-slate-100 dark:border-slate-800/50",
        layout === 'drawer' && "pb-[max(1rem,env(safe-area-inset-bottom))]",
      )}>
        <button
          ref={userButtonRef}
          // With words the button shows the username, so its name says it too (label in name, WCAG 2.5.3).
          aria-label={`Menu utente${words && user?.username ? ` di ${user.username}` : ''}${normaChanges > 0 ? `, ${normaChangesLabel(normaChanges)}` : ''}`}
          aria-haspopup="menu"
          aria-expanded={showUserMenu}
          onClick={() => (showUserMenu ? closeMenu(false) : openMenu('first'))}
          onKeyDown={onTriggerKeyDown}
          className={cn(
            "relative flex shrink-0 items-center rounded-xl transition-colors duration-200",
            "hover:bg-slate-100 dark:hover:bg-slate-800",
            // The avatar is 36 px below `md` and 32 px from it: inset as in the rail, so widening moves it not.
            words ? "w-full h-11 gap-2.5 overflow-hidden px-1 md:px-1.5 text-left" : "justify-center w-11 h-11",
            showUserMenu && "bg-primary-50 dark:bg-primary-900/10"
          )}
        >
          <motion.div
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            transition={spring.snappy}
            className={cn(
              "shrink-0 rounded-lg flex items-center justify-center text-sm font-semibold",
              "w-9 h-9 md:w-8 md:h-8",
              isAdmin
                ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                : "bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400"
            )}
          >
            {user?.username?.charAt(0).toUpperCase() || 'U'}
          </motion.div>
          {words && (
            <span aria-hidden className="min-w-0 flex-1 truncate whitespace-nowrap text-sm font-medium text-slate-700 dark:text-slate-300">
              {user?.username}
            </span>
          )}
          {normaChanges > 0 && (
            <CountBadge count={normaChanges} className={words ? "shrink-0" : "absolute top-0 right-0 ring-2 ring-white dark:ring-slate-900"} />
          )}
        </button>
        {onToggleWide && layout !== 'drawer' && <WidthToggle layout={layout} onToggle={onToggleWide} />}

        {/* User Dropdown Menu - rendered via Portal */}
        {showUserMenu && createPortal(
          <>
            {/* Backdrop - cattura click esterni */}
            <div
              className={cn("fixed inset-0", Z_INDEX.menuBackdrop)}
              onClick={() => closeMenu(false)}
            />
            {/* Menu popup */}
            <div
              ref={menuRef}
              role="menu"
              aria-label="Menu utente"
              onKeyDown={onMenuKeyDown}
              style={{ bottom: menuPosition.bottom, left: menuPosition.left }}
              className={cn("fixed w-56 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 py-2 animate-in fade-in zoom-in-95 duration-150", Z_INDEX.menuPanel)}
            >
              {/* User Info */}
              <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
                <p className="font-medium text-slate-900 dark:text-white text-sm truncate">
                  {user?.username}
                </p>
                <p className="text-xs text-slate-500 truncate">{user?.email}</p>
                {isAdmin && (
                  <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs rounded-full">
                    <Shield size={10} />
                    Admin
                  </span>
                )}
              </div>

              {/* Menu Items */}
              <div className="py-1">
                <button type="button" role="menuitem" tabIndex={-1} onClick={fromMenu(openSettings)} className={menuItemClass}>
                  <Settings size={16} />
                  Impostazioni
                </button>
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={fromMenu(() => navigate('/history'))}
                  aria-label={normaChanges > 0 ? `Cronologia, ${normaChangesLabel(normaChanges)}` : undefined}
                  className={menuItemClass}
                >
                  <Clock size={16} />
                  <span className="flex-1 text-left">Cronologia</span>
                  {normaChanges > 0 && <CountBadge count={normaChanges} />}
                </button>
                <button type="button" role="menuitem" tabIndex={-1} onClick={fromMenu(() => navigate('/collega-app'))} className={menuItemClass}>
                  <Bot size={16} />
                  Collega un'app AI
                </button>
                <button type="button" role="menuitem" tabIndex={-1} onClick={fromMenu(toggleTheme)} className={menuItemClass}>
                  {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                  {theme === 'dark' ? 'Tema chiaro' : 'Tema scuro'}
                </button>
                <button type="button" role="menuitem" tabIndex={-1} onClick={fromMenu(openKeyboardShortcuts)} className={menuItemClass}>
                  <Keyboard size={16} />
                  Scorciatoie (?)
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    onClick={fromMenu(() => navigate('/admin'))}
                    className={menuItemClass}
                  >
                    <Shield size={16} />
                    Pannello Admin
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => {
                    setShowUserMenu(false);
                    logout();
                    navigate('/login');
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 min-h-[44px] md:min-h-0 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 focus-visible:outline-none focus-visible:bg-red-50 dark:focus-visible:bg-red-900/20 transition-colors cursor-pointer"
                >
                  <LogOut size={16} />
                  Esci
                </button>
              </div>
            </div>
          </>,
          document.body
        )}
      </div>
    </aside>
  );
}
