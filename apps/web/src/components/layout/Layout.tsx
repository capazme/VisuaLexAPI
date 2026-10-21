import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { useDesktopSidebar } from './sidebarWidth';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { SettingsModal } from '../ui/SettingsModal';
import { FeedbackButton } from '../ui/FeedbackButton';
import { FeedbackModal } from '../ui/FeedbackModal';
import { ChangelogNotification } from '../ui/ChangelogNotification';
import { UndoToastContainer } from '../ui/Toast';
import { SyncErrorToast } from '../ui/SyncErrorToast';
import { KeyboardShortcutsModal } from '../ui/KeyboardShortcutsModal';
import { cn } from '../../lib/utils';
import { Z_INDEX } from '../../constants/zIndex';
import { FindWindow } from '../features/search/FindWindow';
import { GlobalSearch } from '../features/search/GlobalSearch';
import { SearchField } from '../features/search/SearchField';
import { closeFindWindow, isWorkspaceCovered, openFindWindow } from '../../utils/findWindowControl';
const CompareView = lazy(() => import('../features/compare/CompareView').then(m => ({ default: m.CompareView })));
import { useTour } from '../../hooks/useTour';
import { useConsentIfProvided } from '../../features/merlt/consent/useConsent';
import { useAuth } from '../../hooks/useAuth';
import { useServiceHealth } from '../../hooks/useServiceHealth';
import { serviceHealthLabel, serviceHealthNeedsNotice } from '../../utils/serviceHealth';
import { PluginSlot } from '../../plugins/PluginSlot';
import { spring } from '../../lib/motion';
import { SECTIONS, sectionForPath } from '../../features/sections/sections';
import { sectionStore } from '../../features/sections/useSection';
import { MenuToggle, PhoneTopBar } from './PhoneTopBar';
import { phoneBarTitle } from './phoneBarTitle';
import { useHideOnScroll } from './useHideOnScroll';
import { PlannerHost } from '../features/planner/PlannerHost';

export function Layout() {
  const { settings, updateSettings, sidebarVisible, toggleSidebar, toggleSearchPanel, openCommandPalette } = useAppStore(useShallow(s => ({
    settings: s.settings,
    updateSettings: s.updateSettings,
    sidebarVisible: s.sidebarVisible,
    toggleSidebar: s.toggleSidebar,
    toggleSearchPanel: s.toggleSearchPanel,
    openCommandPalette: s.openCommandPalette,
  })));
  const { isAuthenticated } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyboardShortcutsOpen, setKeyboardShortcutsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // From `xl` the desktop column shows its words unless the user narrowed it (remembered in the browser).
  const desktopSidebar = useDesktopSidebar();
  const reduceMotion = useReducedMotion();
  // The desktop column's width as it is drawn (0 when hidden or in Focus mode), set as `--sidebar-width` for
  // what would float beside it from `lg`; nothing does since the services pill went into the user menu (S1).
  const desktopSidebarWidth = sidebarVisible && !settings.focusMode ? desktopSidebar.width : 0;
  const navigate = useNavigate();
  // The find window searches the workspace, which is drawn only on the search page (spec §13.1).
  const { pathname } = useLocation();
  const onSearchPage = pathname === '/';
  // The search page's field sits above its content, outside the scroller, so it is always on screen
  // (spec 2026-10-13-fixed-search-design.md); Focus mode hides it, ⌘K still opens the palette.
  const showSearchBar = onSearchPage && !settings.focusMode;
  // Below lg a bar sits at the top of every page (M1): the search page's is its field, with the menu button beside it;
  // every other page has `PhoneTopBar` over its content area, and starts under it. Focus mode draws neither.
  // Gymnasium's lesson covers the shell (`LessonFrame`): no bar under it for Tab to reach.
  const inLesson = /^\/studia\/ripasso\/sessione(\/|$)/.test(pathname);
  const showPhoneBar = !onSearchPage && !settings.focusMode && !inLesson;
  const storedSection = sectionStore((s) => s.section);
  const sectionName = SECTIONS.find((s) => s.id === (sectionForPath(pathname) ?? storedSection))?.name ?? 'VisuaLex';
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [phoneBarElement, setPhoneBarElement] = useState<HTMLElement | null>(null);
  const phoneBar = useHideOnScroll(scroller, { enabled: showPhoneBar && !sidebarOpen, resetKey: pathname, bar: phoneBarElement });
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
  const menuToggle = {
    buttonRef: menuToggleRef,
    open: sidebarOpen,
    onToggle: () => setSidebarOpen(!sidebarOpen),
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
  const { startTour, hasSeenTour, resetAndStartTour, tryStartTour } = useTour({
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
    // Small delay to ensure DOM is ready
    const timer = setTimeout(() => {
      if (!hasSeenTour('welcome')) {
        startTour('welcome');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [hasSeenTour, startTour, consentAsking]);

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
      const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openCommandPalette();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        navigate('/dossier');
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ' ') {
        e.preventDefault();
        updateSettings({ focusMode: !settings.focusMode });
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
        setKeyboardShortcutsOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, updateSettings, settings.focusMode, toggleSidebar, toggleSearchPanel, openCommandPalette, onSearchPage]);

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
            openSettings={() => setSettingsOpen(true)}
            openKeyboardShortcuts={() => setKeyboardShortcutsOpen(true)}
            openFeedback={isAuthenticated ? () => setFeedbackOpen(true) : undefined}
            serviceHealth={serviceHealth}
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
            openSettings={() => setSettingsOpen(true)}
            openKeyboardShortcuts={() => setKeyboardShortcutsOpen(true)}
            openFeedback={isAuthenticated ? () => setFeedbackOpen(true) : undefined}
            serviceHealth={serviceHealth}
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
          showSearchBar && '[--search-bar-height:calc(3.5rem+env(safe-area-inset-top))] lg:[--search-bar-height:4.5rem]',
          // Where a page's sticky row pins (`top-[var(--phone-bar-offset,0px)]`, «Le mie schede»'s filters): under the
          // phone's bar while it is on screen, at the top once it has slid away, and at the top from lg.
          showPhoneBar && 'max-lg:[--phone-bar-offset:calc(3.5rem+env(safe-area-inset-top))]',
          showPhoneBar && phoneBar.hidden && 'max-md:[--phone-bar-offset:0px]',
        )}
      >
        {/* Floating Focus Toggle */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => updateSettings({ focusMode: !settings.focusMode })}
          id="tour-focus-toggle"
          className={cn(
            // 44 px, the touch target (it was 42: a 20 px icon in 10 px of padding and a 1 px border).
            'hidden md:grid place-items-center h-11 w-11 fixed top-4 right-4 z-50 rounded-xl transition-colors',
            // Between md and lg it sits inside the bar's right end, centred on its 56 px.
            !settings.focusMode && 'max-lg:right-1 max-lg:top-[calc(env(safe-area-inset-top)+0.375rem)]',
            'shadow-sm border',
            settings.focusMode
              ? 'bg-primary-600 text-white border-transparent hover:bg-primary-700'
              : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-300 hover:text-slate-800 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-700'
          )}
          title={settings.focusMode ? 'Esci da Focus Mode (Cmd+Space)' : 'Focus Mode (Cmd+Space)'}
        >
          {settings.focusMode ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
        </motion.button>

        {showPhoneBar && (
          <PhoneTopBar
            menu={menuToggle}
            title={phoneBarTitle(pathname, sectionName)}
            hidden={phoneBar.hidden}
            onReveal={phoneBar.reveal}
            barRef={setPhoneBarElement}
            onSearch={openCommandPalette}
          />
        )}

        {showSearchBar && (
          <div
            data-testid="search-bar"
            // The phone's bar on this page (M1): 56 px below lg, the menu button beside the field and the iPhone's top
            // edge above it; 72 px from lg. From md the Focus toggle floats at the top right: the field ends before it.
            // Positioned in the dropdown band, so the line under the field paints over the practice's sticky headings
            // (its blur makes the bar a stacking context, gotcha 22) and under the floating buttons.
            className={cn(
              'relative flex h-[var(--search-bar-height)] flex-shrink-0 items-center justify-center gap-1 border-b', Z_INDEX.dropdown,
              'border-slate-200 bg-white/80 pl-1 pr-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl md:pr-[3.25rem] lg:pl-8 lg:pr-[4.5rem] lg:pt-0 dark:border-slate-800 dark:bg-slate-900/80',
            )}
          >
            <MenuToggle {...menuToggle} />
            <SearchField />
          </div>
        )}

        {/* Content Area. `vlx-page`: the one part a section change's View Transition animates (index.css, T1); the
            sidebar, the floating buttons and the search bar stay still. */}
        <div
          ref={setScroller}
          className={cn(
            'vlx-page flex-1 overflow-y-auto w-full h-full',
            // What the keyboard's focus or an anchor scrolls to stops under the phone's bar, not behind it (WCAG 2.4.11).
            showPhoneBar && 'max-lg:scroll-pt-[calc(3.5rem+env(safe-area-inset-top)+0.5rem)]',
          )}
        >
          <div data-testid="layout-content" className={cn(
            'max-w-7xl mx-auto p-4 md:p-8',
            // Under the phone's bar, 56 px and the iPhone's top edge, with the page's 16 px of air (md: again, or
            // md:p-8 wins).
            showPhoneBar && 'pt-[calc(4.5rem+env(safe-area-inset-top))] md:pt-[calc(4.5rem+env(safe-area-inset-top))] lg:pt-8',
            settings.focusMode && 'max-w-4xl py-12'
          )}>
            <Outlet />
          </div>
        </div>
      </main>

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} onRestartTour={resetAndStartTour} />

      {/* Keyboard Shortcuts Modal */}
      <KeyboardShortcutsModal isOpen={keyboardShortcutsOpen} onClose={() => setKeyboardShortcutsOpen(false)} />

      {/* Feedback, for a signed-in user: the floating button from md; on a phone, where it covered the foot of every
          page (the bars pinned to the bottom, «6 di 10» in the progress card), the user menu's «Invia un commento» (M1). */}
      {isAuthenticated && <FeedbackButton className="max-md:hidden" onOpen={() => setFeedbackOpen(true)} />}
      <FeedbackModal isOpen={feedbackOpen} onClose={() => setFeedbackOpen(false)} />

      {/* Version changelog notification */}
      <ChangelogNotification />

      {/* Global Undo Toast Container */}
      <UndoToastContainer />

      {/* MERL-T global plugin slot — Layout-level side-effect mounts
          (forum-signal tracker, etc.). Renders null but keeps subscribers
          active across all protected routes. */}
      <PluginSlot slot="global" props={{}} />

      {/* Global sync error toast (highlights / annotations save/load) */}
      <SyncErrorToast />

      {/* The palette (⌘K) and the managers it opens, on every page */}
      <GlobalSearch />

      {/* The planner's quick add («c»), its toast and the count beside «Oggi», on every page */}
      <PlannerHost enabled={isAuthenticated} />

      {/* Find in the text (Cmd/Ctrl+F, the reading toolbars' magnifier) */}
      <FindWindow />

      {/* Heavy reader overlays are loaded only when their route/state needs them. */}
      <Suspense fallback={null}>
        {/* Article Compare View */}
        <CompareView />
      </Suspense>
    </div>
  );
}
