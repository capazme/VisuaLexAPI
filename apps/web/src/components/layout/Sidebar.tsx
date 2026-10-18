import { useState, useRef, useEffect, useCallback, type FocusEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Folder, Clock, Moon, Sun, Settings, LogOut, Shield, Users, Keyboard, FileSearch, Scale, Network, Bot, Repeat, Layers, ClipboardCheck } from 'lucide-react';
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

interface SidebarProps {
  theme: string;
  toggleTheme: () => void;
  isOpen: boolean;
  closeMobile: () => void;
  openSettings: () => void;
  openKeyboardShortcuts: () => void;
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
}

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
const SPRING_CONFIG = { type: 'spring' as const, stiffness: 400, damping: 30 };

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

function NavItem({ to, icon: Icon, label, onClick, id, badgeCount, hint }: NavItemProps) {
  const { shown: showTooltip, hide, handlers } = useSidebarLabel();
  // State, not a ref object: the tooltip reads the element while rendering (gotcha 13).
  const [linkEl, setLinkEl] = useState<HTMLAnchorElement | null>(null);
  const showBadge = (badgeCount ?? 0) > 0;

  // The whole control is an icon, and `label` only ever reached the eye — the
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
        "relative flex items-center justify-center rounded-xl transition-all duration-200",
        "hover:bg-slate-100 dark:hover:bg-slate-800",
        // Mobile: larger touch target (min 44px)
        "w-12 h-12 md:w-11 md:h-11",
        isActive && "bg-primary-50 dark:bg-primary-900/10"
      )}
      onClick={() => {
        hide();
        onClick?.();
      }}
      {...handlers}
    >
      {({ isActive }) => (
        <>
          <motion.div
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            transition={SPRING_CONFIG}
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

          {/* Active indicator dot */}
          {isActive && (
            <motion.span
              layoutId="activeIndicator"
              className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-primary-600 rounded-r-full"
              transition={SPRING_CONFIG}
            />
          )}

          {/* Notification badge */}
          {showBadge && <CountBadge count={badgeCount ?? 0} className="absolute top-1 right-1 ring-2 ring-white dark:ring-slate-900" />}

          {/* Tooltip - hidden on mobile */}
          <AnimatePresence>
            {showTooltip && <SidebarTooltip anchor={linkEl} label={label} hint={hint} onDismiss={hide} />}
          </AnimatePresence>
        </>
      )}
    </NavLink>
  );
}

export function Sidebar({ theme, toggleTheme, isOpen, closeMobile, openSettings, openKeyboardShortcuts }: SidebarProps) {
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

  // Calculate menu position when showing
  useEffect(() => {
    if (showUserMenu && userButtonRef.current) {
      const rect = userButtonRef.current.getBoundingClientRect();
      // Position the menu to the right of the button, aligned to bottom of button
      setMenuPosition({
        bottom: window.innerHeight - rect.bottom,
        left: rect.right + 8, // 8px gap from button
      });
    }
  }, [showUserMenu]);

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
        "w-20 md:w-16",
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
      {/* The section switcher, where the open book was (sections spec S3). */}
      <div id="tour-section-switcher" className="flex items-center justify-center h-16 border-b border-slate-100 dark:border-slate-800/50">
        <SectionSwitcher forumCount={forumNotifications.total} onChoose={closeMobile} />
      </div>

      {/* Navigation */}
      {/* The one part that scrolls when the window is low (sixteen icons were 935 px tall): its labels are
          portalled (`SidebarTooltip`), so the overflow clips nothing. The scrollbar is thin, so a
          very low window shows there is more; the column is 64 px wide. */}
      {/* `layoutScroll`: the active indicator's shared-layout animation measures against the nav's scroll. */}
      <motion.nav
        layoutScroll
        id="tour-sidebar"
        className="min-h-0 flex-1 flex flex-col items-center overflow-y-auto overflow-x-hidden py-4 gap-3 md:gap-2 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1"
      >
        <NavItem to="/" icon={Search} label="Ricerca" hint="⌘K" id="tour-nav-search" onClick={handleSearchClick} />
        {quickNorms.length > 0 && (
          <div className="-mt-1 w-5 h-1 rounded-full bg-amber-500/60" title={`${quickNorms.length} preferiti`} />
        )}
        <NavItem to="/documents" icon={FileSearch} label="Analizza documento" onClick={closeMobile} />
        {/* The active section's entries, after the Corpus ones above (sections spec S6). */}
        <div role="group" aria-label={active.name} className="mt-1 flex w-full flex-col items-center gap-3 md:gap-2 border-t border-slate-100 dark:border-slate-800/50 pt-3 md:pt-2">
          {section === 'gymnasium' && (
            <>
              <NavItem to="/studia/ripasso" icon={Repeat} label="Ripasso" onClick={closeMobile} />
              <NavItem to="/studia/schede" icon={Layers} label="Le mie schede" onClick={closeMobile} />
              {isValidator && <NavItem to="/studia/valida" icon={ClipboardCheck} label="Da validare" onClick={closeMobile} />}
            </>
          )}
          {(section === 'opus' || section === 'gymnasium') && (
            <NavItem to="/dossier" icon={Folder} label="Dossier" onClick={closeMobile} id="tour-nav-dossier" />
          )}
          {section === 'academia' && showAssistant && (
            <>
              <NavItem to="/merlt" icon={Scale} label="Assistente" onClick={closeMobile} />
              {/* Slice 4 Decision A: /grafo is the Q&A surface; the hub stays at /merlt. */}
              {showGraph && <NavItem to="/grafo" icon={Network} label="Grafo" onClick={closeMobile} />}
            </>
          )}
          {section === 'forum' && (
            <NavItem to="/forum" icon={Users} label="Forum" onClick={closeMobile} badgeCount={forumNotifications.total} />
          )}
        </div>
      </motion.nav>

      {/* User Menu */}
      <div className="flex flex-col items-center py-4 border-t border-slate-100 dark:border-slate-800/50">
        <button
          ref={userButtonRef}
          aria-label={normaChanges > 0 ? `Menu utente, ${normaChangesLabel(normaChanges)}` : 'Menu utente'}
          aria-haspopup="menu"
          aria-expanded={showUserMenu}
          onClick={() => (showUserMenu ? closeMenu(false) : openMenu('first'))}
          onKeyDown={onTriggerKeyDown}
          className={cn(
            "relative flex items-center justify-center rounded-xl transition-all duration-200",
            "hover:bg-slate-100 dark:hover:bg-slate-800",
            "w-12 h-12 md:w-11 md:h-11",
            showUserMenu && "bg-primary-50 dark:bg-primary-900/10"
          )}
        >
          <motion.div
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            transition={SPRING_CONFIG}
            className={cn(
              "rounded-lg flex items-center justify-center text-sm font-semibold",
              "w-9 h-9 md:w-8 md:h-8",
              isAdmin
                ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                : "bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400"
            )}
          >
            {user?.username?.charAt(0).toUpperCase() || 'U'}
          </motion.div>
          {normaChanges > 0 && <CountBadge count={normaChanges} className="absolute top-0 right-0 ring-2 ring-white dark:ring-slate-900" />}
        </button>

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
