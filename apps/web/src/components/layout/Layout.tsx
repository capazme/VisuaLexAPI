import { useState, useEffect, useRef, useContext, useMemo, lazy, Suspense, Component, type ReactNode } from 'react';
import { UNSAFE_LocationContext, useLocation, useNavigate, useOutlet, type Location } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { logoSweepDue, markLogoSweep } from '../ui/logoSweep';
import { RoutePage } from './RouteBoundary';
import { useDesktopSidebar } from './sidebarWidth';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { CorpusPracticesDialog } from '../features/practice/CorpusPracticesDialog';
import { ChangelogNotification } from '../ui/ChangelogNotification';
import { NotificationHost } from '../ui/Toast';
import { SyncErrorToast } from '../ui/SyncErrorToast';
import { PageSlide } from '../ui/PageSlide';
import { SETTINGS_PATH, useOpenSettings, useSettingsRequests } from '../features/settings/settingsRoute';
import { cn } from '../../lib/utils';
import { Z_INDEX } from '../../constants/zIndex';
import { FindWindow } from '../features/search/FindWindow';
import { GlobalSearch } from '../features/search/GlobalSearch';
import { SearchField } from '../features/search/SearchField';
import { closeFindWindow, isWorkspaceCovered, openFindWindow } from '../../utils/findWindowControl';
import { closeCompare, forgetCompareOpened, useCompare, useCompareOpened } from '../../hooks/useCompare';
import { useTour } from '../../hooks/useTour';
import { WelcomeGuide } from '../../features/welcome/WelcomeGuide';
import { useConsentIfProvided } from '../../features/merlt/consent/useConsent';
import { useAuth } from '../../hooks/useAuth';
import { useServiceHealth } from '../../hooks/useServiceHealth';
import { serviceHealthLabel, serviceHealthNeedsNotice } from '../../utils/serviceHealth';
import { PluginSlot } from '../../plugins/PluginSlot';
import { spring } from '../../lib/motion';
import { SECTIONS, sectionForPath } from '../../features/sections/sections';
import { sectionStore } from '../../features/sections/useSection';
import { MenuToggle, PhoneTopBar } from './PhoneTopBar';
import { TopBar } from './TopBar';
import { phoneBarTitle } from './phoneBarTitle';
import { useHideOnScroll } from './useHideOnScroll';
import { openSearchMenu } from '../../utils/searchFieldControl';
import { usePageTitleInView } from './usePageTitleInView';
import { PlannerHost } from '../features/planner/PlannerHost';
import { useMediaQuery } from '../../hooks/useIsDesktop';
import { isMacPlatform } from '../ui/notifications/undoShortcut';
import { stackRoomStore } from '../ui/notifications/stackRoom';
import { FULL_PAGE_FRAME, PAGE_FRAME } from './frame';

/**
 * The full screen's key, in the button's `title` and its `aria-keyshortcuts`: ⌘⇧F on a Mac, Ctrl+⇧F elsewhere (the
 * owner's choice: ⌘Space, the key until then, opens Spotlight on a Mac).
 */
const FULL_SCREEN_SHORTCUT = isMacPlatform() ? '⌘⇧F' : 'Ctrl+⇧F';
const FULL_SCREEN_KEYS = isMacPlatform() ? 'Meta+Shift+F' : 'Control+Shift+F';

const loadCompareView = () => import('../features/compare/CompareView').then(m => ({ default: m.CompareView }));
// A new one after a failed fetch: `lazy` keeps a failure for good.
let CompareView = lazy(loadCompareView);

/**
 * The comparison's code that cannot be fetched, or an error of the comparison while in use, closes it instead of taking
 * the page down (on `develop` the whole app went blank), the error in the console and no words on screen. The next
 * opening fetches it again: that mends a connection that dropped, not a file a deploy removed, which stays missing until
 * the page is reloaded (as for a lazy route).
 */
class CompareBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('the comparison could not be loaded', error);
    CompareView = lazy(loadCompareView);
    closeCompare();
    forgetCompareOpened();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Where the comparison will stand while its code travels: only while it is open (closed meanwhile, nothing). */
function CompareWaiting() {
  const { isOpen } = useCompare();
  if (!isOpen) return null;
  return (
    <div aria-hidden data-testid="compare-waiting" className={cn('pointer-events-none fixed inset-0 flex items-center justify-center', Z_INDEX.compare)}>
      <span className="size-6 rounded-full border-2 border-primary-600 border-t-transparent animate-spin dark:border-primary-400 dark:border-t-transparent" />
    </div>
  );
}

/**
 * The address a page was drawn at, kept for it (LC84): `PageSlide` keeps the leaving page's element, whose route is its
 * own (`useOutlet`), but whatever in it reads `useLocation` (a title from the address, Opus's) would read the new one
 * and draw the coming page twice. The router has no public way to give a subtree its own location (`<Routes location>`
 * starts a new tree of routes), hence its context.
 */
function AtLocation({ location, children }: { location: Location; children: ReactNode }) {
  const context = useContext(UNSAFE_LocationContext);
  const value = useMemo(() => ({ ...context, location }), [context, location]);
  return <UNSAFE_LocationContext.Provider value={value}>{children}</UNSAFE_LocationContext.Provider>;
}

export function Layout() {
  const { settings, updateSettings, sidebarVisible, toggleSidebar, toggleSearchPanel, openCommandPalette } = useAppStore(useShallow(s => ({
    settings: s.settings,
    updateSettings: s.updateSettings,
    sidebarVisible: s.sidebarVisible,
    toggleSidebar: s.toggleSidebar,
    toggleSearchPanel: s.toggleSearchPanel,
    openCommandPalette: s.openCommandPalette,
  })));
  // Impostazioni is a page (LC84): the sidebar's entries, «?» and every gear ask for it, and the layout goes there.
  const openSettings = useOpenSettings();
  useSettingsRequests();
  // The route's page as it is now: kept by `PageSlide` while it leaves, it goes on drawing the page it was.
  const outlet = useOutlet();
  const { isAuthenticated } = useAuth();
  const compareOpened = useCompareOpened();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // The logo's sweep (LC16): once a browser session, as the shell first draws — the splash and the session's check
  // are gone by then —, never again on a change of page. Read here once for both copies of the bar, recorded after.
  const [logoSweep] = useState(() => logoSweepDue());
  useEffect(() => {
    if (logoSweep) markLogoSweep();
  }, [logoSweep]);
  // The phone's drawer is closed as the shell draws: its sweep plays at its first opening in the session (LC18).
  const [drawerSweep, setDrawerSweep] = useState(false);
  // From `xl` the desktop column shows its words unless the user narrowed it (remembered in the browser).
  const desktopSidebar = useDesktopSidebar();
  const reduceMotion = useReducedMotion();
  // The desktop column's width as it is drawn (0 when hidden or in full screen), set as `--sidebar-width` for what is
  // placed against the window from `lg`: the room a top row keeps for the full-screen button (`FOCUS_BUTTON_CLEARANCE`)
  // and the practices' bar (`PracticeBar`).
  const desktopSidebarWidth = sidebarVisible && !settings.focusMode ? desktopSidebar.width : 0;
  const navigate = useNavigate();
  // The find window searches the workspace, which is drawn only on the search page (spec §13.1).
  const location = useLocation();
  const { pathname, search } = location;
  const onSearchPage = pathname === '/';
  const notificationRoom = stackRoomStore((s) => s.room);
  // The search page's field sits above its content, outside the scroller, so it is always on screen
  // (spec 2026-10-13-fixed-search-design.md); the full screen (`focusMode`) hides it, ⌘K still opens the palette.
  // Below lg (from lg the top bar holds the field, compact: LC21, the anti-slop review's FAIL of the 15th).
  const showSearchBarRaw = onSearchPage && !settings.focusMode;
  // Below lg a bar sits at the top of every page (M1): the search page's is its field, with the menu button beside it;
  // every other page has `PhoneTopBar` over its content area, and starts under it. Focus mode draws neither.
  // Gymnasium's lesson covers the shell (`LessonFrame`): no bar under it for Tab to reach.
  const inLesson = /^\/learn\/ripasso\/sessione(\/|$)/.test(pathname);
  const showPhoneBar = !onSearchPage && !settings.focusMode && !inLesson;
  const storedSection = sectionStore((s) => s.section);
  const activeSection = SECTIONS.find((s) => s.id === (sectionForPath(pathname) ?? storedSection)) ?? SECTIONS[0];
  const sectionName = activeSection.name;
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [phoneBarElement, setPhoneBarElement] = useState<HTMLElement | null>(null);
  const phoneBar = useHideOnScroll(scroller, { enabled: showPhoneBar && !sidebarOpen, resetKey: pathname, bar: phoneBarElement });
  // The bar's name (G8, as iOS's large titles): nothing in the middle while the page's own title is in sight under the
  // bar — it says the name already —, the page's name once the title has scrolled out (`PhoneTopBar` fades it in). A
  // page with no `h1` has its name at once.
  const titleInView = usePageTitleInView(scroller, { enabled: showPhoneBar, resetKey: pathname, bar: phoneBarElement });
  const barTitle = titleInView ? '' : phoneBarTitle(pathname, sectionName);
  // The services' probe, once for both copies of the sidebar and running with the menu closed (S1): its
  // status is the user menu's «Stato dei servizi», and a fault is a dot on the user button and, on a
  // phone, on the button that opens the drawer, whose names say it.
  const serviceHealth = useServiceHealth();
  const servicesNotice = serviceHealthNeedsNotice(serviceHealth.snapshot.overall);
  // Closing the drawer (an entry, a link, the backdrop) puts its controls out of reach (`inert`): the focus they held goes
  // to the menu button, where a dialog an entry opens gives it back and a section's new title may still take it.
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeDrawer = () => {
    setSidebarOpen(false);
    const active = document.activeElement;
    if (!active || active === document.body || drawerRef.current?.contains(active)) menuToggleRef.current?.focus({ preventScroll: true });
  };
  // Esc closes the drawer and gives the focus to the button that opened it, wherever the focus was (opening it from the
  // bar leaves the focus on that button). An Esc a control inside took (the user menu, the section switcher) or an
  // overlay over the drawer (a modal dialog, a sheet, the palette) is theirs. Only while the drawer is drawn: a window
  // widened past `lg` with it open hides it by CSS and keeps the state, and its Esc belongs to the page (gotcha 26).
  const lgUp = useMediaQuery('(min-width: 1024px)');
  const drawerDrawn = !lgUp;
  // LC21: from lg every page but the search page and the lesson has the top bar, which holds the controls that floated
  // («Tutto schermo») and the version's news; the search page's own bar holds them too. In full screen and
  // below lg they float as before.
  // LC27 (Luca, 15 Nov: «il passaggio a full screen è veramente brutto»): from lg the top bar stays in full screen too,
  // with its controls where they always are; full screen only hides the sidebar and widens the frame.
  const showTopBar = lgUp && !inLesson;
  const controlsInBar = lgUp && !inLesson;
  const showSearchBar = showSearchBarRaw && !lgUp;
  // The search page from lg: the top bar with the path and the field, in full screen as well.
  const searchInTopBar = onSearchPage && lgUp;
  useEffect(() => {
    if (!sidebarOpen || !drawerDrawn) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isWorkspaceCovered()) return;
      e.preventDefault();
      setSidebarOpen(false);
      menuToggleRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen, drawerDrawn]);
  const menuToggle = {
    buttonRef: menuToggleRef,
    open: sidebarOpen,
    onToggle: () => {
      if (!sidebarOpen && !drawerSweep && logoSweepDue('sweep-drawer')) {
        markLogoSweep('sweep-drawer');
        setDrawerSweep(true);
      }
      setSidebarOpen(!sidebarOpen);
    },
    notice: servicesNotice ? serviceHealthLabel(serviceHealth.snapshot.overall).toLowerCase() : undefined,
  };

  // Leaving the search page closes the window: its matches are in practices no longer on screen.
  useEffect(() => {
    if (!onSearchPage) closeFindWindow();
  }, [onSearchPage]);

  // Onboarding Tour
  // The search tour follows the welcome (a first visit lands on `/`): started here when the welcome
  // ends, since one tour at a time is on screen (`useTour`) and the search page asks only once. The
  // address is read when the welcome ends, not when this callback was made.
  const { startTour, prepareTour, hasSeenTour, tryStartTour } = useTour({
    theme: settings.theme as 'light' | 'dark',
    onComplete: (type) => {
      if (type === 'welcome' && window.location.pathname === '/') tryStartTour('search');
    },
  });

  // Auto-start welcome tour on first visit, once the MERL-T consent screen is not (or no longer)
  // asking: a tour's overlay over that screen would be two first-run surfaces at once.
  const consent = useConsentIfProvided();
  const consentAsking = consent !== null && (consent.status === 'loading' || consent.needsAnswer);
  useEffect(() => {
    if (consentAsking) return;
    if (!hasSeenTour('welcome')) prepareTour();
    // Small delay to ensure DOM is ready
    const timer = setTimeout(() => {
      if (!hasSeenTour('welcome')) {
        startTour('welcome');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [hasSeenTour, prepareTour, startTour, consentAsking]);

  // Apply Theme & Typography Effects
  useEffect(() => {
    const root = document.documentElement;

    // Set theme
    root.setAttribute('data-theme', settings.theme);

    // Toggle .dark class
    if (settings.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    // Font Size
    root.setAttribute('data-font-size', settings.fontSize);
    root.classList.remove('font-sans', 'font-serif', 'font-mono');
    root.classList.add(`font-${settings.fontFamily}`);

  }, [settings]);

  const toggleTheme = () => {
    const newTheme = settings.theme === 'light' ? 'dark' : 'light';
    updateSettings({ theme: newTheme });
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      // An element that stands for a field (the search page's field, `data-text-field`) is typed on too: «?» there is a letter.
      const target = e.target as HTMLElement;
      const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || Boolean(target.closest?.('[data-text-field]'));

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        // The search page's field grows into the menu with its words; elsewhere the menu opens empty (R2).
        openSearchMenu();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        navigate('/pratiche');
      }
      // The full screen: Cmd/Ctrl+Shift+F. Without Shift, F is the find window's, below. A key held down toggles it once,
      // and its repeats stay ours (Chrome on a Mac binds ⇧⌘F to its own menu).
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        if (!e.repeat) updateSettings({ focusMode: !settings.focusMode });
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        toggleSearchPanel();
      }
      // Cmd/Ctrl+F opens the floating find window (spec §13.1), or focuses its field when it is open.
      // Off the search page, and under an overlay that covers the workspace (a modal dialog, the
      // discussion panel, Study Mode, the palette, CompareView, the PDF viewer), the browser's own find is left alone.
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f'
        && onSearchPage && !isWorkspaceCovered()) {
        e.preventDefault();
        openFindWindow();
      }
      // Open keyboard shortcuts with '?' (Shift + /)
      if (e.key === '?' && !isTyping) {
        e.preventDefault();
        openSettings('scorciatoie');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, updateSettings, settings.focusMode, toggleSidebar, toggleSearchPanel, openCommandPalette, onSearchPage, openSettings]);

  // The controls of the top bar (LC21): the version's news and «Tutto schermo», compact and in line. «Commenti» left
  // it for the bug beside «Impostazioni» in the sidebar (LC92).
  const barControls = (
    <>
      <ChangelogNotification inBar />
      <button
        type="button"
        onClick={() => updateSettings({ focusMode: !settings.focusMode })}
        id="tour-focus-toggle"
        aria-label="Tutto schermo"
        aria-pressed={settings.focusMode}
        aria-keyshortcuts={FULL_SCREEN_KEYS}
        title={settings.focusMode ? `Esci dal tutto schermo (${FULL_SCREEN_SHORTCUT})` : `Tutto schermo (${FULL_SCREEN_SHORTCUT})`}
        className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      >
        {settings.focusMode ? <Minimize2 size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}
      </button>
    </>
  );

  return (
    <div
      className="h-app overflow-hidden flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-300"
      style={{ ['--sidebar-width' as string]: `${desktopSidebarWidth}px` }}
    >
      {/* Mobile Overlay */}
      {sidebarOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={closeDrawer}
        />
      )}

      {/* Desktop Sidebar */}
      <motion.div
        initial={false}
        animate={{
          width: desktopSidebarWidth,
          opacity: sidebarVisible && !settings.focusMode ? 1 : 0,
        }}
        transition={reduceMotion ? { duration: 0 } : spring.snappy}
        className="hidden lg:block flex-shrink-0 h-full"
      >
        {sidebarVisible && !settings.focusMode && (
          <Sidebar
            theme={settings.theme}
            toggleTheme={toggleTheme}
            isOpen={true}
            layout={desktopSidebar.layout}
            onToggleWide={desktopSidebar.toggle}
            closeMobile={() => { }}
            openSettings={() => openSettings()}
            openKeyboardShortcuts={() => openSettings('scorciatoie')}
            openFeedback={isAuthenticated ? () => openSettings('segnala') : undefined}
            serviceHealth={serviceHealth}
            logoSweep={logoSweep}
          />
        )}
      </motion.div>

      {/* Mobile Sidebar */}
      {!settings.focusMode && (
        <div ref={drawerRef} className="lg:hidden">
          <Sidebar
            theme={settings.theme}
            toggleTheme={toggleTheme}
            isOpen={sidebarOpen}
            layout="drawer"
            closeMobile={closeDrawer}
            openSettings={() => openSettings()}
            openKeyboardShortcuts={() => openSettings('scorciatoie')}
            openFeedback={isAuthenticated ? () => openSettings('segnala') : undefined}
            serviceHealth={serviceHealth}
            logoSweep={drawerSweep}
          />
        </div>
      )}

      <main
        className={cn(
          // `isolate`: a stacking context of its own, as it has always been (gotcha 22).
          'isolate flex-1 flex flex-col min-w-0 h-full overflow-hidden relative',
          // It holds the focus a closing «Novità» gives back (`focusPage`), with no ring around the whole page.
          'focus:outline-none',
          // The practice's columns (`h-app-row`) are the viewport less the search bar: 56 px below lg (and the iPhone's
          // top edge), 72 from it.
          showSearchBar && '[--search-bar-height:calc(3.5rem+env(safe-area-inset-top))]',
          // From lg the practice's columns are the viewport less the top bar, 52 px.
          searchInTopBar && '[--search-bar-height:3.25rem]',
          // Where a page's sticky row pins (`top-[var(--phone-bar-offset,0px)]`, «Le mie schede»'s filters): under the
          // phone's bar while it is on screen, at the top once it has slid away, and at the top from lg.
          showPhoneBar && 'max-lg:[--phone-bar-offset:calc(3.5rem+env(safe-area-inset-top))]',
          showPhoneBar && phoneBar.hidden && 'max-md:[--phone-bar-offset:0px]',
        )}
      >
        {/* The full screen (U1, L-47: `focusMode` in the settings): it widens the frame, never narrows it. A toggle, so
            its name stays «Tutto schermo» and `aria-pressed` says the state; the `title` says what a press does. */}
        {!controlsInBar && <motion.button
          type="button"
          whileHover={reduceMotion ? undefined : { scale: 1.05 }}
          whileTap={reduceMotion ? undefined : { scale: 0.95 }}
          onClick={() => updateSettings({ focusMode: !settings.focusMode })}
          id="tour-focus-toggle"
          aria-label="Tutto schermo"
          aria-pressed={settings.focusMode}
          aria-keyshortcuts={FULL_SCREEN_KEYS}
          className={cn(
            // 44 px, the touch target (it was 42: a 20 px icon in 10 px of padding and a 1 px border).
            'hidden md:grid place-items-center h-11 w-11 fixed top-4 right-4 z-50 rounded-xl transition-colors',
            // Between md and lg it sits inside the bar's right end, centred on its 56 px.
            !settings.focusMode && 'max-lg:right-1 max-lg:top-[calc(env(safe-area-inset-top)+0.375rem)]',
            'shadow-sm border',
            settings.focusMode
              ? 'bg-primary-600 dark:bg-toga-400 dark:hover:bg-toga-300 dark:text-ink-950 text-white border-transparent hover:bg-primary-700'
              : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-300 hover:text-slate-800 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-700'
          )}
          title={settings.focusMode ? `Esci dal tutto schermo (${FULL_SCREEN_SHORTCUT})` : `Tutto schermo (${FULL_SCREEN_SHORTCUT})`}
        >
          {settings.focusMode ? <Minimize2 size={20} aria-hidden /> : <Maximize2 size={20} aria-hidden />}
        </motion.button>}

        {showTopBar && <TopBar section={activeSection} pathname={pathname} search={search} scroller={scroller} actions={barControls} onSearch={openCommandPalette} field={searchInTopBar ? <SearchField compact /> : undefined} />}

        {showPhoneBar && (
          <PhoneTopBar
            menu={menuToggle}
            section={activeSection.name}
            title={barTitle}
            hidden={phoneBar.hidden}
            onReveal={phoneBar.reveal}
            barRef={setPhoneBarElement}
            onSearch={openCommandPalette}
          />
        )}

        {showSearchBar && (
          <div
            data-testid="search-bar"
            data-palette-bar=""
            // The phone's bar on this page (M1): 56 px below lg, the menu button beside the field and the iPhone's top
            // edge above it; 72 px from lg. From md «Commenti» and the Focus toggle float at the top right: the field ends before them,
            // with 8 px of air between md and lg (10.5 rem: the toggle's 4 px and 44, 8 of gap, about 103 for «Commenti»; it was 9.75).
            // LC92: «Commenti» left the top right; the room is kept as it was until it is measured again in a browser.
            // Positioned in the dropdown band, so the line under the field paints over the practice's sticky headings
            // (its blur makes the bar a stacking context, gotcha 22) and under the floating buttons.
            className={cn(
              'relative flex h-[var(--search-bar-height)] flex-shrink-0 items-center justify-center gap-1 border-b', Z_INDEX.dropdown,
              // LC21: the page's own ground, as the top bar of the other pages: no white band over the stone.
              'border-slate-200 bg-slate-50/90 pl-1 pr-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl md:pr-[10.5rem] lg:pl-8 lg:pr-[17rem] lg:pt-0 dark:border-slate-800 dark:bg-slate-950/90',
            )}
          >
            <MenuToggle {...menuToggle} />
            <SearchField />
            {/* L-75: the search's field grows out of this one, in its place. */}
            <div data-palette-slot="" className="absolute bottom-0 left-12 right-4 flex h-14 items-center empty:hidden md:right-[10.5rem]" />
          </div>
        )}

        {/* The search (⌘K): its field grows in the bar above, its lists are a band here, under the bars, that pushes the
            page down (L-75: nothing over the content). */}
        <GlobalSearch />

        {/* Content Area. `vlx-page`: the one part a section change's View Transition animates (index.css, T1); the
            sidebar, the floating buttons and the search bar stay still. */}
        <div
          ref={setScroller}
          className={cn(
            'vlx-page flex-1 overflow-y-auto w-full h-full',
            // A page that grows past the window («Oggi», «Progressi», «Collega un'app AI», as it loads) drew its 8 px bar
            // and moved the centred column 4 px to the left: the room is kept. Not on the search page, whose practice row
            // is the scroller's height (`h-app-row`) and would only lose 8 px to an empty gutter.
            !onSearchPage && '[scrollbar-gutter:stable]',
            // What the keyboard's focus or an anchor scrolls to stops under the phone's bar, not behind it (WCAG 2.4.11).
            showPhoneBar && 'max-lg:scroll-pt-[calc(3.5rem+env(safe-area-inset-top)+0.5rem)]',
          )}
        >
          <div data-testid="layout-content" className={cn(
            // The frame (U1): the window less its margins, at most 1600 px; 2400 in full screen, which gives the content
            // the room of the sidebar and of the search page's field, and on a page that declares itself `full`
            // (`frame.ts`). The padding above and below does not change: the practice row is measured against it.
            PAGE_FRAME, 'py-4 md:py-8', !onSearchPage && 'lg:pt-10 lg:pb-24',
            settings.focusMode ? 'max-w-frame-full' : cn('max-w-frame', FULL_PAGE_FRAME),
            // Where «Commenti» and the full-screen button float over the page's top right, the room they take, which a
            // top row keeps clear (`FOCUS_BUTTON_CLEARANCE`): from md in full screen, which draws no bar for them to sit
            // in; from lg otherwise; never over the search page's field, which ends before them. 11 rem: the toggle's
            // 60 px from the edge, 8 of gap, about 96 for «Commenti» and 8 of air.
            // LC92: «Commenti» left the top right; the room is kept as it was until it is measured again in a browser.
            // Only where the controls still float: full screen below lg.
            settings.focusMode && !lgUp && 'md:[--focus-button-room:11rem]',
            // Under the phone's bar, 56 px and the iPhone's top edge, with the page's 16 px of air (md: again, or
            // md:py-8 wins).
            showPhoneBar && 'pt-[calc(4.5rem+env(safe-area-inset-top))] md:pt-[calc(4.5rem+env(safe-area-inset-top))] lg:pt-10',
          )}>
            {/* Impostazioni comes in as a page of its own and goes back the other way (LC84); every other change of page
                keeps its own transition, so the key changes only entering and leaving it. */}
            <PageSlide pageKey={pathname === SETTINGS_PATH ? 'impostazioni' : 'app'} back={pathname !== SETTINGS_PATH}>
              <AtLocation location={location}>
                <div data-page-place className="contents">
                  <RoutePage>
                    {outlet}
                  </RoutePage>
                </div>
              </AtLocation>
            </PageSlide>
          </div>
          {/* LC85: while notifications show at the bottom, the page can scroll its last rows above them. Not on the
              search page, whose practice columns are the scroller's height and scroll on their own. */}
          {!onSearchPage && notificationRoom > 0 && <div aria-hidden data-notification-room="" style={{ height: notificationRoom }} />}
        </div>
      </main>

      {/* LC60: the Corpus's practices a browser kept become pratiche, once, by the user's choice. */}
      <CorpusPracticesDialog />
      <WelcomeGuide />

      {/* Version changelog notification */}
      {/* LC92: hidden while the phone's drawer is open (at 390 it covered the drawer's foot and took its clicks); kept
          mounted, so it comes back as it was when the drawer closes. */}
      {!controlsInBar && (
        <div data-testid="news-floating-host" className="contents" hidden={sidebarOpen && drawerDrawn}>
          <ChangelogNotification />
        </div>
      )}

      {/* Global Undo Toast Container */}
      <NotificationHost />

      {/* MERL-T global plugin slot — Layout-level side-effect mounts
          (forum-signal tracker, etc.). Renders null but keeps subscribers
          active across all protected routes. */}
      <PluginSlot slot="global" props={{}} />

      {/* Global sync error toast (highlights / annotations save/load) */}
      <SyncErrorToast />

      {/* The planner's quick add («c»), its toast and the count beside «Oggi», on every page */}
      <PlannerHost enabled={isAuthenticated} />

      {/* Find in the text (Cmd/Ctrl+F, the reading toolbars' magnifier) */}
      <FindWindow />

      {/* Heavy reader overlays are loaded only when their route/state needs them: the comparison on its first opening,
          a spinner where it will stand while its code arrives and it is open. */}
      {compareOpened && (
        <CompareBoundary>
          <Suspense fallback={<CompareWaiting />}>
            <CompareView />
          </Suspense>
        </CompareBoundary>
      )}
    </div>
  );
}
