import { useState, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { SettingsModal } from '../ui/SettingsModal';
import { FeedbackButton } from '../ui/FeedbackButton';
import { ChangelogNotification } from '../ui/ChangelogNotification';
import { UndoToastContainer } from '../ui/Toast';
import { KeyboardShortcutsModal } from '../ui/KeyboardShortcutsModal';
import { cn } from '../../lib/utils';
import { GlobalSearch } from '../features/search/GlobalSearch';
import { CompareView } from '../features/compare/CompareView';
import { useTour } from '../../hooks/useTour';
import { useAuth } from '../../hooks/useAuth';

export function Layout() {
  const { settings, updateSettings, sidebarVisible, toggleSidebar, toggleSearchPanel, openCommandPalette } = useAppStore();
  const { isAuthenticated } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyboardShortcutsOpen, setKeyboardShortcutsOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const navigate = useNavigate();

  // Onboarding Tour
  const { startTour, hasSeenTour, resetAndStartTour } = useTour({ theme: settings.theme as 'light' | 'dark' });

  // Auto-start welcome tour on first visit
  useEffect(() => {
    // Small delay to ensure DOM is ready
    const timer = setTimeout(() => {
      if (!hasSeenTour('welcome')) {
        startTour('welcome');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [hasSeenTour, startTour]);

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
      // Cmd/Ctrl+F for global search
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setGlobalSearchOpen(true);
      }
      // Open keyboard shortcuts with '?' (Shift + /)
      if (e.key === '?' && !isTyping) {
        e.preventDefault();
        setKeyboardShortcutsOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, updateSettings, settings.focusMode, toggleSidebar, toggleSearchPanel, openCommandPalette]);

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-300">
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
          width: sidebarVisible && !settings.focusMode ? 64 : 0,
          opacity: sidebarVisible && !settings.focusMode ? 1 : 0,
        }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="hidden lg:block flex-shrink-0"
      >
        {sidebarVisible && !settings.focusMode && (
          <Sidebar
            theme={settings.theme}
            toggleTheme={toggleTheme}
            isOpen={true}
            closeMobile={() => { }}
            openSettings={() => setSettingsOpen(true)}
            openKeyboardShortcuts={() => setKeyboardShortcutsOpen(true)}
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
            closeMobile={() => setSidebarOpen(false)}
            openSettings={() => setSettingsOpen(true)}
            openKeyboardShortcuts={() => setKeyboardShortcutsOpen(true)}
          />
        </div>
      )}

      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden relative">
        {/* Floating Focus Toggle */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => updateSettings({ focusMode: !settings.focusMode })}
          id="tour-focus-toggle"
          className={cn(
            'hidden md:block fixed top-4 right-4 z-50 p-2.5 rounded-xl transition-all duration-200',
            'backdrop-blur-xl shadow-lg border',
            settings.focusMode
              ? 'bg-primary-600/90 text-white border-transparent hover:bg-primary-500/90'
              : 'bg-white/80 dark:bg-slate-900/80 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 border-slate-200 dark:border-slate-700'
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
            className="lg:hidden fixed top-4 left-4 z-50 p-2.5 rounded-xl backdrop-blur-xl shadow-lg bg-white/80 dark:bg-slate-900/80 text-slate-600 dark:text-slate-300 border border-slate-200/50 dark:border-slate-700/50"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </motion.button>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto w-full h-full">
          <div className={cn(
            'max-w-7xl mx-auto p-4 md:p-8',
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
      {isAuthenticated && <FeedbackButton />}

      {/* Version changelog notification */}
      <ChangelogNotification />

      {/* Global Undo Toast Container */}
      <UndoToastContainer />

      {/* Global Search (Cmd+F) */}
      <GlobalSearch isOpen={globalSearchOpen} onClose={() => setGlobalSearchOpen(false)} />

      {/* Article Compare View */}
      <CompareView />
    </div>
  );
}
