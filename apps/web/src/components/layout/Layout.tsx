import { useState, useEffect, lazy, Suspense } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { useDesktopSidebar } from './sidebarWidth';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { SettingsModal } from '../ui/SettingsModal';
import { FeedbackButton } from '../ui/FeedbackButton';
import { ChangelogNotification } from '../ui/ChangelogNotification';
import { UndoToastContainer } from '../ui/Toast';
import { SyncErrorToast } from '../ui/SyncErrorToast';
import { KeyboardShortcutsModal } from '../ui/KeyboardShortcutsModal';
import { cn } from '../../lib/utils';
import { Z_INDEX } from '../../constants/zIndex';
import { FindWindow } from '../features/search/FindWindow';
import { GlobalSearch } from '../features/search/GlobalSearch';
import { SearchField, SEARCH_BAR_HEIGHT } from '../features/search/SearchField';
import { closeFindWindow, isWorkspaceCovered, openFindWindow } from '../../utils/findWindowControl';
const CompareView = lazy(() => import('../features/compare/CompareView').then(m => ({ default: m.CompareView })));
import { useTour } from '../../hooks/useTour';
import { useConsentIfProvided } from '../../features/merlt/consent/useConsent';
import { useAuth } from '../../hooks/useAuth';
import { useServiceHealth } from '../../hooks/useServiceHealth';
import { ServiceHealthDot } from '../ui/ServiceHealthMenuEntry';
import { serviceHealthLabel, serviceHealthNeedsNotice } from '../../utils/serviceHealth';
import { PluginSlot } from '../../plugins/PluginSlot';
import { spring } from '../../lib/motion';
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
  // The review's grade bar and the validators' vote bar are pinned to the bottom edge on a phone,
  // where the feedback button would cover them.
  const inReviewSession = pathname.startsWith('/studia/ripasso/sessione');
  const onValidationQueue = pathname === '/studia/valida' || pathname.startsWith('/studia/valida/');
  const barPinnedAtBottom = inReviewSession || onValidationQueue;
  // The search page's field sits above its content, outside the scroller, so it is always on screen
  // (spec 2026-10-13-fixed-search-design.md); Focus mode hides it, ⌘K still opens the palette.
  const showSearchBar = onSearchPage && !settings.focusMode;
  // Below lg the menu button floats at the top left over the content: every page starts under it,
  // except the search page, whose field sits beside it.
  const headerBesideMenuButton = onSearchPage;
  // The services' probe, once for both copies of the sidebar and running with the menu closed (S1): its
  // status is the user menu's «Stato dei servizi», and a fault is a dot on the user button and, on a
  // phone, on the button that opens the drawer, whose names say it.
  const serviceHealth = useServiceHealth();
  const servicesNotice = serviceHealthNeedsNotice(serviceHealth.snapshot.overall);

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
          onClick={() => setSidebarOpen(false)}
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
            serviceHealth={serviceHealth}
          />
        )}
      </motion.div>

      {/* Mobile Sidebar */}
      {!settings.focusMode && (
        <div className="lg:hidden">
          <Sidebar
            theme={settings.theme}
            toggleTheme={toggleTheme}
            isOpen={sidebarOpen}
            layout="drawer"
            closeMobile={() => setSidebarOpen(false)}
            openSettings={() => setSettingsOpen(true)}
            openKeyboardShortcuts={() => setKeyboardShortcutsOpen(true)}
            serviceHealth={serviceHealth}
          />
        </div>
      )}

      <main
        // `vlx-page`: the one part a section change animates (index.css, spec §6.3.2); the sidebar stays still.
        className="vlx-page flex-1 flex flex-col min-w-0 h-full overflow-hidden relative"
        // The practice's columns (`h-app-row`) are the viewport less this bar.
        style={showSearchBar ? { ['--search-bar-height' as string]: SEARCH_BAR_HEIGHT } : undefined}
      >
        {/* Floating Focus Toggle */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => updateSettings({ focusMode: !settings.focusMode })}
          id="tour-focus-toggle"
          className={cn(
            'hidden md:block fixed top-4 right-4 z-50 p-2.5 rounded-xl transition-colors',
            'shadow-sm border',
            settings.focusMode
              ? 'bg-primary-600 text-white border-transparent hover:bg-primary-700'
              : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-300 hover:text-slate-800 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-700'
          )}
          title={settings.focusMode ? 'Esci da Focus Mode (Cmd+Space)' : 'Focus Mode (Cmd+Space)'}
        >
          {settings.focusMode ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
        </motion.button>

        {/* Mobile Menu Button */}
        {!settings.focusMode && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label={`${sidebarOpen ? 'Chiudi il menu' : 'Apri il menu'}${servicesNotice ? `, ${serviceHealthLabel(serviceHealth.snapshot.overall).toLowerCase()}` : ''}`}
            aria-expanded={sidebarOpen}
            className="lg:hidden fixed top-4 left-4 z-50 p-2.5 rounded-xl backdrop-blur-xl shadow-lg bg-white/80 dark:bg-slate-900/80 text-slate-600 dark:text-slate-300 border border-slate-200/50 dark:border-slate-700/50"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
            {servicesNotice && <ServiceHealthDot className="absolute right-1.5 top-1.5" />}
          </motion.button>
        )}

        {showSearchBar && (
          <div
            data-testid="search-bar"
            style={{ height: SEARCH_BAR_HEIGHT }}
            // Below lg the menu button floats at the top left: the field starts beside it. From md the
            // Focus toggle floats at the top right: the field ends before it. Positioned in the dropdown
            // band, so the line under the field paints over the practice's sticky headings (its blur
            // makes the bar a stacking context, gotcha 22) and under the floating buttons.
            className={cn('relative flex flex-shrink-0 items-center justify-center border-b', Z_INDEX.dropdown, 'border-slate-200 bg-white/80 pl-[4.5rem] pr-4 backdrop-blur-xl md:pr-[4.5rem] lg:pl-8 dark:border-slate-800 dark:bg-slate-900/80')}
          >
            <SearchField />
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto w-full h-full">
          <div data-testid="layout-content" className={cn(
            'max-w-7xl mx-auto p-4 md:p-8',
            // The button is about 42 px from top-4: 4.5rem clears it (md: again, or md:p-8 wins).
            !settings.focusMode && !headerBesideMenuButton && 'pt-[4.5rem] md:pt-[4.5rem] lg:pt-8',
            settings.focusMode && 'max-w-4xl py-12'
          )}>
            <Outlet />
          </div>
        </div>
      </main>

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} onRestartTour={resetAndStartTour} />

      {/* Keyboard Shortcuts Modal */}
      <KeyboardShortcutsModal isOpen={keyboardShortcutsOpen} onClose={() => setKeyboardShortcutsOpen(false)} />

      {/* Feedback Button - only for authenticated users */}
      {isAuthenticated && <FeedbackButton className={barPinnedAtBottom ? 'max-md:hidden' : undefined} />}

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
