import { useState, useRef, useEffect, useCallback, type FocusEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { MenuSurface } from '../ui/MenuSurface';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, LayoutGroup, useReducedMotion } from 'framer-motion';
import { Plug, Search, Folder, FolderOpen, CalendarCheck, MessagesSquare, Clock, Moon, Sun, Settings, LogOut, Shield, Keyboard, FileSearch, Library, Scale, Network, ScrollText, Bug, Repeat, ChartColumn, Layers, ClipboardCheck, PanelLeftClose, PanelLeftOpen, Route, EyeOff, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { isMerltEnabled } from '../../features/merlt/featureFlag';
import { isMerltGraphEnabled } from '../../features/merlt/graph/featureFlag';
import { SectionSwitcher } from '../../features/sections/SectionSwitcher';
import { SectionTabs } from '../../features/sections/SectionTabs';
import { useSection } from '../../features/sections/useSection';
import { useEntriesEntrance } from '../../features/sections/useEntriesEntrance';
import { PALETTE_SHORTCUT, focusSearchField } from '../../utils/searchFieldControl';
import { useAuth } from '../../hooks/useAuth';
import { useForumNotifications } from '../../hooks/useForumNotifications';
import type { ServiceHealthReading } from '../../hooks/useServiceHealth';
import { ServiceHealthDot, ServiceHealthMenuEntry } from '../ui/ServiceHealthMenuEntry';
import { serviceHealthLabel, serviceHealthNeedsNotice } from '../../utils/serviceHealth';
import { Z_INDEX } from '../../constants/zIndex';
import { preparePage } from '../../pageCode';
import { focusLanding } from '../../utils/focusPage';
import { dur, ease, spring } from '../../lib/motion';
import { BookMark } from '../ui/BookMark';
import { LexCraftLogo } from '../ui/LexCraftLogo';
import type { SidebarLayout } from './sidebarWidth';
import { plannerStore } from '../features/planner/plannerStore';
import { todayCountLabel } from '../features/planner/taskDates';
import { useCoursesSwitch } from '../features/studia/corsi/coursesSwitch';

interface SidebarProps {
  theme: string;
  toggleTheme: () => void;
  isOpen: boolean;
  closeMobile: () => void;
  openSettings: () => void;
  openKeyboardShortcuts: () => void;
  /** Opens «Segnala un problema» (LC92, `/impostazioni#segnala`): the bug beside «Impostazioni» and an entry of the
   *  user menu, at every width (the rail has no «Impostazioni» at its foot). Not given, neither. */
  openFeedback?: () => void;
  /** Icons only (the desktop between `lg` and `xl`, or narrowed), icons and words (from `xl`), or the
   *  phone's drawer (icons and words, rows of 44 px). */
  layout?: SidebarLayout;
  /** Narrows or widens the desktop bar; given only where the words fit (`xl`). */
  onToggleWide?: () => void;
  /** `Layout`'s one probe of the services: the user menu's «Stato dei servizi» and the dot on the user button. */
  serviceHealth: ServiceHealthReading;
  /** The logo's sweep is due (once a browser session, `Layout`): it plays as the bar appears. Never in the rail. */
  logoSweep?: boolean;
}

interface NavItemProps {
  to: string;
  icon: React.ElementType;
  label: string;
  /** The word shown in the bar where `label` would be cut (Luca 16-11: «Analizza docum…»); the name stays `label`. */
  shortLabel?: string;
  onClick?: () => void;
  id?: string;
  badgeCount?: number;
  /** What the count counts, for the name: «Scadenziario, 3 compiti per oggi o scaduti». Without it, «N notifiche». */
  badgeLabel?: string;
  /** Active on its own address only, not under it: «Dossier pubblici» (`/forum`) beside «Community» (`/forum/community`). */
  end?: boolean;
  /** The keyboard shortcut that does the same, shown in the hover label (not part of the name). */
  hint?: string;
  /** A feature on its way (D-315): «in arrivo» under the word, in the hover label and in the name. `'dev'` (LC47): it
   *  works but is still being built, «in sviluppo» in the same three places; the entry still leads to its page. */
  soon?: boolean | 'dev';
  /** Other addresses (and those under them) where the entry is lit, so the bar says where one is: «Scadenziario» on the
   *  planner's other views, «Ricerca» on the Corpus tools, «Assistente» on the hub's pages (#448). */
  activeOn?: string[];
  layout: SidebarLayout;
}

/**
 * The colour of the bar's 11 px texts (the groups' headings, the shortcut): AA for small text, 4.5:1, on
 * the bar's glass over the page and over the phone's backdrop, light and dark (`theme.test.ts`). Slate 500
 * and 400 fell short (3.8 and 2.6 on the light drawer, 3.8 for the dark shortcut).
 */
export const SIDEBAR_SMALL_TEXT = 'text-slate-600 dark:text-slate-400';

/**
 * The narrow/widen control's colour: the entries' words', slate 700 / dark slate 300 (10:1 and 12:1 on the
 * bar, `theme.test.ts`). It was slate 500 / dark slate 400 — AA on paper (4.7:1, 6.9:1) but fainter than every
 * word beside it, and read as faint in dark mode on the owner's pass.
 */
export const SIDEBAR_TOGGLE_TEXT = 'text-slate-700 dark:text-slate-300';

const menuItemClass = "w-full flex items-center gap-3 px-4 py-2.5 min-h-[44px] md:min-h-0 text-sm focus-visible:outline-none focus-visible:bg-slate-100 dark:focus-visible:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer";

/** The unread "a saved norm changed" notifications, as words: the avatar's name and the menu's entry carry them. */
function normaChangesLabel(count: number): string {
  return count === 1 ? '1 norma salvata cambiata' : `${count} norme salvate cambiate`;
}

/** A count drawn on a control; the control's name says what it counts. 11 px in ink, not red: a count of tasks is not a danger (LC32). */
function CountBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-[11px] font-semibold leading-none',
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
      transition={{ duration: dur.pop, ease: ease.out }}
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

function NavItem({ to, icon: Icon, label, shortLabel, onClick, id, badgeCount, badgeLabel, hint, soon, activeOn, layout, end }: NavItemProps) {
  const { shown: showTooltip, hide, handlers } = useSidebarLabel();
  // State, not a ref object: the tooltip reads the element while rendering (gotcha 13).
  const [linkEl, setLinkEl] = useState<HTMLAnchorElement | null>(null);
  const showBadge = (badgeCount ?? 0) > 0;
  const words = layout !== 'rail';
  // NavLink's rule (its address, or under it unless `end`; «/» on itself only), plus `activeOn`. A `Link`, since NavLink
  // gives `aria-current` only on its own address.
  const { pathname } = useLocation();
  const under = (path: string, exact?: boolean) => pathname === path || (!exact && path !== '/' && pathname.startsWith(`${path}/`));
  const isActive = under(to, end) || (activeOn ?? []).some((path) => under(path));

  // In the rail the whole control is an icon, and `label` only ever reached the eye — the
  // tooltip is `hidden md:block` and shows on hover, so a screen reader and a
  // keyboard user got an unnamed link. The count rides the name because a badge
  // announced on its own arrives without saying what it counts.
  const status = soon === 'dev' ? 'in sviluppo' : soon ? 'in arrivo' : undefined;
  const accessibleName = showBadge ? `${label}, ${badgeLabel ?? `${badgeCount} notifiche`}` : status ? `${label}, ${status}` : label;

  return (
    <Link
      ref={setLinkEl}
      to={to}
      id={id}
      aria-label={accessibleName}
      // «page» on its own address only; lit for a page under it or of its own, «true», so a screen reader does not
      // hear «current page» twice (on `/work/prossimi`, here and on the planner's tab, #448).
      aria-current={pathname === to ? 'page' : isActive ? 'true' : undefined}
      className={cn(
        "relative flex shrink-0 items-center rounded-xl transition-colors duration-(--dur-pop)",
        "hover:bg-slate-100 dark:hover:bg-slate-800",
        // The icon keeps the same 44 px box in every layout, so widening the bar moves no icon. No `overflow-hidden`:
        // it clipped the active column, which sits left of the row; the words truncate on their own.
        // LC21: with words the row is the prototype's, 36 px (the drawer's 44, a touch target), the icon 12 px in and 12 from the
        // words; the rail keeps its 44 px square.
        words ? cn("w-full gap-3 pl-3 pr-2", layout === 'drawer' ? "h-11" : "h-9") : "w-11 h-11",
        isActive && "bg-primary-50 dark:bg-primary-900/25"
      )}
      onClick={() => {
        hide();
        onClick?.();
        // From the phone's drawer (LC98): the focus goes to the title of the page reached, as on a computer, not to the
        // menu button the closing drawer parks it on.
        if (layout === 'drawer') focusLanding(to !== pathname);
      }}
      // With its words written, the row needs no label of its own.
      {...(words ? {} : handlers)}
      // A page loaded with its route (`pageCode.ts`) is fetched as its entry is pointed at, focused or touched.
      onPointerEnter={(e: PointerEvent<HTMLAnchorElement>) => { preparePage(to); if (!words) handlers.onPointerEnter(e); }}
      onPointerDown={() => preparePage(to)}
      onFocus={(e: FocusEvent<HTMLAnchorElement>) => { preparePage(to); if (!words) handlers.onFocus(e); }}
    >
      <>
          {/* A navigation entry is seen tens of times a day: its hover is the colour alone. The press is CSS: framer-motion's
              `whileTap` gave this box `tabindex="0"`, a second Tab stop in every entry (#448). */}
          <div className={cn("grid shrink-0 place-items-center transition-transform duration-(--dur-press) motion-safe:active:scale-95", words ? "h-5 w-5" : "h-11 w-11")}>
            <Icon
              size={words ? 18 : 22}
              aria-hidden
              className={cn(
                "transition-colors duration-(--dur-pop)",
                words
                  ? cn("stroke-[1.5px]", isActive ? "text-slate-900 dark:text-slate-50" : "text-slate-600 dark:text-slate-400")
                  : isActive
                    ? "text-primary-600 dark:text-primary-400 stroke-[2.5px]"
                    : "text-slate-500 dark:text-slate-400 stroke-[2px]"
              )}
            />
          </div>

          {words && (
            <span
              aria-hidden
              className={cn(
                "min-w-0 flex-1 truncate whitespace-nowrap text-sm",
                isActive ? "font-semibold text-slate-900 dark:text-slate-50" : "font-medium text-slate-800 dark:text-slate-300"
              )}
            >
              {shortLabel ?? label}
              {/* Under the name, not beside it: beside, it cut «Anonimizzatore» in the 224 px bar (#448). */}
              {status && <span className={cn("block text-[11px] font-medium leading-none", SIDEBAR_SMALL_TEXT)}>{status}</span>}
            </span>
          )}
          {/* The shortcut, for a keyboard: not in the phone's drawer. */}
          {layout === 'wide' && hint && !showBadge && (
            <kbd aria-hidden className={cn("ml-2 shrink-0 font-sans text-[11px]", SIDEBAR_SMALL_TEXT)}>{hint}</kbd>
          )}

          {/* LC27 (Luca, 15 Nov: «la mini colonnina … va tolta»): the active entry is its tile alone, in the rail too. */}

          {/* Notification badge: on the icon in the rail, at the end of the row with words, 4 px after the word: with the
              largest text the bold «Scadenze» of the lit entry needed the other 4 (#524). */}
          {showBadge && (
            <CountBadge
              count={badgeCount ?? 0}
              className={words ? "ml-1 shrink-0" : "absolute top-1 right-1 ring-2 ring-white dark:ring-slate-900"}
            />
          )}

          {/* Tooltip - the rail's only, hidden on mobile */}
          <AnimatePresence>
            {!words && showTooltip && <SidebarTooltip anchor={linkEl} label={label} hint={status ?? hint} onDismiss={hide} />}
          </AnimatePresence>
      </>
    </Link>
  );
}

/**
 * A group of entries, named for a screen reader; with words, its name is also written over it. In the
 * rail a thin line stands for the heading. `unnamed`: a group that bears its section's name is not a group again
 * inside the section's (a screen reader said «Learn» twice, LC4); only the heading is drawn.
 */
function NavGroup({ name, heading, unnamed, layout, children }: { name: string; heading?: boolean; unnamed?: boolean; layout: SidebarLayout; children: React.ReactNode }) {
  return (
    <div role={unnamed ? undefined : 'group'} aria-label={unnamed ? undefined : name} className={cn("flex w-full flex-col items-start", layout === 'rail' ? "gap-3 md:gap-2" : "gap-0.5")}>
      {/* LC21: the section's own name is not written again over its entries (it is on the tab above); a group's heading is the
          prototype's small capitals. */}
      {heading && !unnamed && layout !== 'rail' && (
        <p aria-hidden className={cn("w-full truncate whitespace-nowrap px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-[0.06em]", SIDEBAR_SMALL_TEXT)}>
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
        "flex shrink-0 items-center rounded-xl transition-colors duration-(--dur-pop)",
        wide ? "h-9 rounded-lg pl-3 gap-3" : "h-11",
        SIDEBAR_TOGGLE_TEXT,
        "hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
        wide ? "w-full overflow-hidden" : "w-11",
      )}
    >
      <span className={cn("grid shrink-0 place-items-center", wide ? "h-5 w-5" : "h-11 w-11")}><Icon size={wide ? 18 : 20} strokeWidth={wide ? 1.5 : 2} aria-hidden /></span>
      {wide && <span aria-hidden className="min-w-0 truncate whitespace-nowrap text-sm font-medium">Riduci</span>}
      <AnimatePresence>
        {!wide && shown && <SidebarTooltip anchor={el} label={label} onDismiss={hide} />}
      </AnimatePresence>
    </button>
  );
}

export function Sidebar({ theme, toggleTheme, isOpen, closeMobile, openSettings, openKeyboardShortcuts, openFeedback, layout = 'rail', onToggleWide, serviceHealth, logoSweep = false }: SidebarProps) {
  const navigate = useNavigate();
  const { user, isAdmin, isValidator, logout } = useAuth();
  const coursesOn = useCoursesSwitch() === 'on';
  const { section, active } = useSection();
  const sectionEntries = useEntriesEntrance(section);
  const { count: forumNotifications } = useForumNotifications(!!user);
  // Overdue plus today's tasks (`PlannerHost` reads them): beside «Scadenziario» in Opus.
  const todayCount = plannerStore((s) => s.todayCount) ?? 0;
  // Cronologia lives in the user menu (the owner, 13 Oct 2026); the saved norms that changed are
  // counted on the avatar and beside the entry («ok come raccomandi»).
  const normaChanges = forumNotifications.normaChanges ?? 0;
  // The services pill is gone (S1): a fault shows as a dot on the user button, and its name says it.
  const servicesNotice = serviceHealthNeedsNotice(serviceHealth.snapshot.overall);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ bottom: 0, left: 0, maxHeight: 0 });

  const logoReduce = useReducedMotion();
  const words = layout !== 'rail';

  // Placed when it opens, in the same update, so its first paint has its height bounded before an entry takes
  // focus (opened on «Esci» in a low window, the focused entry would otherwise end up out of view).
  const placeMenu = () => {
    if (!userButtonRef.current) return;
    const rect = userButtonRef.current.getBoundingClientRect();
    // Beside the rail's avatar, aligned to its bottom; over the wider button of the bar with words
    // (on a phone a menu beside it would leave the screen). It grows upwards, «Stato dei servizi» open
    // included, and scrolls rather than leave the top of a low window.
    setMenuPosition(words
      ? { bottom: window.innerHeight - rect.top + 8, left: rect.left, maxHeight: rect.top - 16 }
      : { bottom: window.innerHeight - rect.bottom, left: rect.right + 8, maxHeight: rect.bottom - 8 });
  };

  // «Ricerca» is the search page with the cursor in its field, no window over it (the owner, 13 Oct
  // 2026: «ok come raccomandi»); the first key typed opens the search menu (R2), as ⌘K does. The link itself
  // navigates.
  const handleSearchClick = () => {
    focusSearchField({ focus: true }, { wait: true });
    closeMobile();
  };
  // The search: «Ricerca» over every section but Work, and among Work's entries (D-315, LC48).
  const searchEntry = (label: string, activeOn?: string[]) => (
    <NavItem to="/" activeOn={activeOn} icon={Search} label={label} hint={PALETTE_SHORTCUT} id="tour-nav-search" onClick={handleSearchClick} layout={layout} />
  );

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
    placeMenu();
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
  // dialog it opens returns it; in the drawer, closing, `Layout` moves it on to the bar's menu button) and then acts.
  const fromMenu = (action: () => void) => () => {
    closeMenu(true);
    closeMobile();
    action();
  };

  return (
    <aside
      // The closed drawer is only slid off the screen: out of reach of Tab and of a screen reader too (M1).
      inert={layout === 'drawer' && !isOpen ? true : undefined}
      className={cn(
        // Base layout
        "fixed inset-y-0 left-0 z-50 flex flex-col",
        // On the desktop it fills the row it sits in, never taller: a low window scrolls the
        // navigation, not the document.
        "lg:h-full",
        // The desktop copy is as wide as its column, which `Layout` sizes (64 px, or 224 with words);
        // the phone's drawer has room for its words.
        layout === 'drawer' ? "w-[17rem] max-w-[85vw]" : "w-full",
        // Solid: nothing scrolls under the rail on a computer, and on a phone the drawer has its own scrim.
        // LC21: the prototype's bar, a step darker than the page in the light, the page's own ground in the dark.
        "bg-slate-100 dark:bg-slate-950",
        "border-r border-slate-200 dark:border-slate-800",
        // Mobile slide
        "transform transition-transform duration-(--dur-scene) ease-drawer",
        // `relative`, not `static`: the transform makes this aside a stacking
        // context, so anything inside it (hover tooltips) is trapped at the
        // aside's own level. Static would leave z-50 inert and page content
        // would paint over the tooltips.
        "lg:translate-x-0 lg:relative",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}
    >
      {/* LexCraft's logo (LC16), a link home and the bar's first Tab stop, in a row of its own over the switcher: the
          wordmark 120 px wide, its «L» flush with the switcher's mark (the box starts 11 of its 716 units, 1.8 px,
          before it); in the rail the column alone, centred over the icons (32 px from the edge), never in line with the
          entries' column-cursor, and still. In the drawer it is the head, clear of the iPhone's top edge. */}
      {/* Luca, 15 November: the wordmark centred over the section tabs and a step larger (150 px), not flush left. */}
      <div className={cn("flex shrink-0 items-center justify-center px-2.5", layout === 'rail' ? "h-12" : "h-16", layout === 'drawer' && "box-content pt-[env(safe-area-inset-top)]")}>
        <Link
          to="/"
          aria-label="LexCraft"
          onClick={closeMobile}
          className={cn(
            "rounded-lg text-primary-600 dark:text-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
            layout === 'rail' ? "grid h-11 w-11 place-items-center" : "flex h-11 items-center px-2",
          )}
        >
          {/* LC27 (Luca, 15 Nov): narrowing the bar, LEX and CRAFT close in on the column between them and fade, and the
              column stays, the rail's mark; widening, they open out of it again. The wordmark's column sits at 37.8 % of
              its width (x 260 of the 716-unit box): the halves scale from there. Under reduced motion it simply changes. */}
          <AnimatePresence initial={false} mode="popLayout">
            {layout === 'rail' ? (
              <motion.span
                key="column"
                className="grid place-items-center"
                initial={logoReduce ? false : { opacity: 0, scaleY: 0.7 }}
                animate={{ opacity: 1, scaleY: 1 }}
                exit={logoReduce ? undefined : { opacity: 0, transition: { duration: dur.press } }}
                transition={{ duration: dur.panel, ease: ease.out }}
              >
                <BookMark size={32} />
              </motion.span>
            ) : (
              <motion.span
                key="wordmark"
                className="block"
                style={{ transformOrigin: '37.8% 50%' }}
                initial={logoReduce ? false : { opacity: 0, scaleX: 0.08 }}
                animate={{ opacity: 1, scaleX: 1 }}
                exit={logoReduce ? undefined : { opacity: 0, scaleX: 0.08 }}
                transition={{ duration: dur.panel, ease: ease.out }}
              >
                <LexCraftLogo motion={logoSweep ? 'sweep' : 'still'} className="h-auto w-[150px]" />
              </motion.span>
            )}
          </AnimatePresence>
        </Link>
      </div>

      {/* The section switcher, where the open book was (sections spec S3), under the logo. Every column keeps 10 px of
          side padding, so a 44 px control in the 64 px rail sits where it sits in the wide bar. */}
      {/* LC21: with words the sections are a row of tabs under the logo (the prototype of 12 November); the rail, which four
          words would not fit, keeps the one button and its menu. */}
      <div id="tour-section-switcher" className={cn("flex items-center", words ? "px-3 pb-3 pt-1" : "px-2.5 pt-1.5 pb-2 lg:p-0 lg:px-2.5 lg:h-16 border-b border-slate-100 dark:border-slate-800/50")}>
        {words
          ? <SectionTabs forumCount={forumNotifications.total} onChoose={closeMobile} inDrawer={layout === 'drawer'} />
          : <SectionSwitcher forumCount={forumNotifications.total} onChoose={closeMobile} withName={false} inDrawer={false} />}
      </div>

      {/* Navigation */}
      {/* The one part that scrolls when the window is low (sixteen icons were 935 px tall): its labels are
          portalled (`SidebarTooltip`), so the overflow clips nothing. The scrollbar is thin, so a
          very low window shows there is more. It clips the words while the bar narrows or widens. */}
      {/* `layoutScroll`: the active indicator's shared-layout animation measures against the nav's scroll. */}
      <motion.nav
        layoutScroll
        id="tour-sidebar"
        className={cn("min-h-0 flex-1 flex flex-col items-start overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1", words ? "px-3 py-2 gap-0.5" : "px-2.5 py-4 gap-3 md:gap-2")}
      >
        {/* Corpus's entries over the other sections' (sections spec S6). In Work the search is Work's own «Ricerca» (D-315, LC48), and
            the two tools are links of the search page (`Scrivania`, LC8). */}
        {section !== 'opus' && (
          <>
            {searchEntry('Ricerca')}
            <NavItem to="/documents" icon={FileSearch} label="Analizza documento" shortLabel="Analizza" onClick={closeMobile} layout={layout} />
            <NavItem to="/rassegne" icon={Library} label="Rassegne" onClick={closeMobile} layout={layout} />
          </>
        )}
        {/* The active section's entries, after the Corpus ones above (sections spec S6); a new section's fade in (T1).
            Each section names its own active column (`layoutId` within the section's group), and the phone's drawer apart:
            `Layout` keeps both copies mounted, and with one name the desktop's column took its start from the hidden
            drawer's (a box of nothing), so it jumped instead of sliding (#448). Keyed by its id: `LayoutGroup` reads `id`
            once, so without a new group every section kept the first one's name and the column glided in from the old
            section's entry (#457); a new section's column appears in place. */}
        <LayoutGroup key={layout === 'drawer' ? `drawer-${section}` : section} id={layout === 'drawer' ? `drawer-${section}` : section}>
          <div ref={sectionEntries} role="group" aria-label={active.name} className={cn("flex w-full flex-col items-start", words ? "gap-0.5" : "gap-3 md:gap-2", section !== 'opus' && "mt-1 border-t border-slate-100 dark:border-slate-800/50 pt-3 md:pt-2")}>
            {section === 'gymnasium' && (
              <>
                {/* Studying, then writing and validating (Gymnasium spec §4). */}
                <NavGroup name="Learn" heading unnamed layout={layout}>
                  <NavItem to="/learn/ripasso" icon={Repeat} label="Oggi" onClick={closeMobile} layout={layout} />
                  {/* Second, behind the switch `lingo_courses` (courses spec §6.1). */}
                  {coursesOn && <NavItem to="/learn/percorsi" icon={Route} label="Percorsi" onClick={closeMobile} layout={layout} />}
                  <NavItem to="/learn/progressi" icon={ChartColumn} label="Progressi" onClick={closeMobile} layout={layout} />
                  <NavItem to="/pratiche" icon={Folder} label="Pratiche" onClick={closeMobile} id="tour-nav-dossier" layout={layout} />
                </NavGroup>
                {layout === 'rail' && <div aria-hidden className="mx-auto h-px w-6 bg-slate-200 dark:bg-slate-700" />}
                <NavGroup name="Contribuisci" heading layout={layout}>
                  <NavItem to="/learn/schede" icon={Layers} label="Le mie schede" onClick={closeMobile} layout={layout} />
                  {isValidator && <NavItem to="/learn/valida" icon={ClipboardCheck} label="Da validare" onClick={closeMobile} layout={layout} />}
                </NavGroup>
              </>
            )}
            {section === 'opus' && (
              <>
                {/* Scadenziario, Ricerca, Dossier, then the tools that are coming (D-315, LC47, LC48). «Prossimi
                    giorni» and «Lista d'ingresso» are tabs of Work's page (`OpusPage`), «Rassegne» a link of the search page (LC8). */}
                <NavItem to="/work/scadenziario" activeOn={['/work/prossimi', '/work/ingresso', '/work/cestino']} icon={CalendarCheck} label="Scadenziario" shortLabel="Scadenze" onClick={closeMobile} badgeCount={todayCount} badgeLabel={todayCountLabel(todayCount)} layout={layout} />
                {searchEntry('Ricerca', ['/rassegne'])}
                <NavItem to="/pratiche" icon={Folder} label="Pratiche" onClick={closeMobile} id="tour-nav-dossier" layout={layout} />
                <div aria-hidden className={cn("h-px bg-slate-200 dark:bg-slate-700", layout === 'rail' ? "mx-auto w-6" : "my-1.5 w-full")} />
                <NavGroup name="Strumenti sul documento" layout={layout}>
                  <NavItem to="/documents" icon={FileSearch} label="Analizza documento" shortLabel="Analizza" soon="dev" onClick={closeMobile} layout={layout} />
                  {/* The desktop app's (D-324): announced on the web, its page says what it will do. */}
                  {/* «Pseudonimizza» in the bar: the whole word is cut at the larger text sizes (LC48). */}
                  <NavItem to="/work/pseudonimizzatore" icon={EyeOff} label="Pseudonimizzatore" shortLabel="Pseudonimizza" soon onClick={closeMobile} layout={layout} />
                  {/* The knowledge graph of the user's practices, the desktop app's too (LC48). */}
                  <NavItem to="/work/grafo-pratiche" icon={Network} label="Grafo delle pratiche" shortLabel="Grafo pratiche" soon onClick={closeMobile} layout={layout} />
                </NavGroup>
              </>
            )}
            {section === 'academia' && showAssistant && (
              <>
                <NavItem to="/labs" end activeOn={['/labs/contribuisci', '/labs/valida']} icon={Scale} label="Assistente" onClick={closeMobile} layout={layout} />
                {/* Slice 4 Decision A: /labs/grafo is the Q&A surface; the hub stays at /labs. */}
                {showGraph && <NavItem to="/labs/grafo" icon={Network} label="Grafo" onClick={closeMobile} layout={layout} />}
              </>
            )}
            {/* The section keeps its name; its areas are named apart, so «Forum» is not written twice. */}
            {section === 'forum' && (
              <>
                <NavItem to="/forum" end icon={FolderOpen} label="Dossier pubblici" onClick={closeMobile} badgeCount={forumNotifications.total} layout={layout} />
                <NavItem to="/forum/community" icon={MessagesSquare} label="Community" onClick={closeMobile} layout={layout} />
              </>
            )}
          </div>
        </LayoutGroup>
      </motion.nav>

      {/* User Menu, and on the desktop from `xl` the control that narrows or widens the bar. On a phone the
          drawer's foot clears the home indicator. */}
      <div className={cn(
        "flex flex-col items-start gap-0.5 border-t border-slate-200 dark:border-slate-800", words ? "px-3 py-3" : "px-2.5 py-4",
        layout === 'drawer' && "pb-[max(1rem,env(safe-area-inset-bottom))]",
      )}>
        <button
          ref={userButtonRef}
          // With words the button shows the username, so its name says it too (label in name, WCAG 2.5.3).
          aria-label={`Menu utente${words && user?.username ? ` di ${user.username}` : ''}${normaChanges > 0 ? `, ${normaChangesLabel(normaChanges)}` : ''}${servicesNotice ? `, ${serviceHealthLabel(serviceHealth.snapshot.overall).toLowerCase()}` : ''}`}
          aria-haspopup="menu"
          aria-expanded={showUserMenu}
          onClick={() => (showUserMenu ? closeMenu(false) : openMenu('first'))}
          onKeyDown={onTriggerKeyDown}
          className={cn(
            "relative flex shrink-0 items-center rounded-xl transition-colors duration-(--dur-pop)",
            "hover:bg-slate-100 dark:hover:bg-slate-800",
            // The avatar is 36 px below `md` and 32 px from it: inset as in the rail, so widening moves it not.
            words ? cn("w-full gap-2.5 overflow-hidden px-2 text-left", layout === 'drawer' ? "h-11" : "h-10") : "justify-center w-11 h-11",
            showUserMenu && "bg-primary-50 dark:bg-primary-900/25"
          )}
        >
          {/* No `whileTap`: it made this box a second Tab stop inside the button (`tabindex="0"`). */}
          <motion.div
            whileHover={{ scale: 1.1 }}
            transition={spring.snappy}
            className={cn(
              "relative shrink-0 rounded-lg flex items-center justify-center text-sm font-semibold",
              "w-9 h-9 md:w-8 md:h-8",
              isAdmin
                ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                : "bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400"
            )}
          >
            {user?.username?.charAt(0).toUpperCase() || 'U'}
            {/* At the avatar's foot, clear of the count of changed norms (its top corner in the rail). */}
            {servicesNotice && <ServiceHealthDot className="absolute -bottom-0.5 -right-0.5" />}
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
        {/* LC21: «Impostazioni» in sight at the bar's foot, as the prototype has it (it stays in the user menu too). With words
            only: the rail keeps its two controls. */}
        {words && (
          <div className="flex w-full shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => {
              closeMobile();
              openSettings();
            }}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-3 rounded-lg pl-3 text-left transition-colors duration-(--dur-pop)",
              layout === 'drawer' ? "h-11" : "h-9",
              SIDEBAR_TOGGLE_TEXT,
              "hover:bg-slate-200/70 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
            )}
          >
            <span className="grid h-5 w-5 shrink-0 place-items-center"><Settings size={18} strokeWidth={1.5} aria-hidden /></span>
            <span className="min-w-0 truncate whitespace-nowrap text-sm font-medium">Impostazioni</span>
          </button>
          {/* LC92: «Segnala un problema», the bug beside «Impostazioni»; it was «Commenti» at the top right. */}
          {openFeedback && (
            <button
              type="button"
              onClick={() => {
                closeMobile();
                openFeedback();
              }}
              aria-label="Segnala un problema"
              title="Segnala un problema"
              className={cn(
                "grid shrink-0 place-items-center rounded-lg transition-colors duration-(--dur-pop)",
                layout === 'drawer' ? "h-11 w-11" : "h-9 w-9",
                SIDEBAR_TOGGLE_TEXT,
                "hover:bg-slate-200/70 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
              )}
            >
              <Bug size={18} strokeWidth={1.5} aria-hidden />
            </button>
          )}
          </div>
        )}
        {onToggleWide && layout !== 'drawer' && <WidthToggle layout={layout} onToggle={onToggleWide} />}

        {/* User Dropdown Menu - rendered via Portal */}
        {createPortal(
          <>
            {/* Backdrop - cattura click esterni */}
            {showUserMenu && (
              <div
                className={cn("fixed inset-0", Z_INDEX.menuBackdrop)}
                onClick={() => closeMenu(false)}
              />
            )}
            {/* Menu popup: it appears over the user button by a fade and a 4 px shift (`MenuSurface`, LC102). */}
            <AnimatePresence>
            {showUserMenu && (
            <MenuSurface
              key="user-menu"
              ref={menuRef}
              above
              role="menu"
              aria-label="Menu utente"
              onKeyDown={onMenuKeyDown}
              style={{ bottom: menuPosition.bottom, left: menuPosition.left, maxHeight: menuPosition.maxHeight > 0 ? menuPosition.maxHeight : undefined }}
              className={cn("fixed w-56 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white py-2 shadow-md dark:border-slate-700 dark:bg-slate-800", Z_INDEX.menuPanel)}
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
                  <Plug size={16} />
                  Collega un'app AI
                </button>
                <button type="button" role="menuitem" tabIndex={-1} onClick={fromMenu(() => navigate('/crediti'))} className={menuItemClass}>
                  <ScrollText size={16} />
                  Crediti
                </button>
                {openFeedback && (
                  <button type="button" role="menuitem" tabIndex={-1} onClick={fromMenu(openFeedback)} className={menuItemClass}>
                    <Bug size={16} />
                    Segnala un problema
                  </button>
                )}
                <ServiceHealthMenuEntry health={serviceHealth} itemClassName={menuItemClass} />
                <button type="button" role="menuitem" tabIndex={-1} onClick={fromMenu(toggleTheme)} className={menuItemClass}>
                  {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                  {theme === 'dark' ? 'Tema chiaro' : 'Tema scuro'}
                </button>
                <button type="button" role="menuitem" tabIndex={-1} onClick={fromMenu(openKeyboardShortcuts)} className={menuItemClass}>
                  <Keyboard size={16} />
                  Scorciatoie
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
            </MenuSurface>
            )}
            </AnimatePresence>
          </>,
          document.body
        )}
      </div>
    </aside>
  );
}
