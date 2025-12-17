import { useState, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { SettingsModal } from '../ui/SettingsModal';
import { cn } from '../../lib/utils';
import { useTour } from '../../hooks/useTour';

export function Layout() {
  const { settings, updateSettings, sidebarVisible, toggleSidebar, toggleSearchPanel, openCommandPalette } = useAppStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const navigate = useNavigate();

  // Onboarding Tour
  const { startTour, hasSeenTour, resetAndStartTour } = useTour({ theme: settings.theme as 'light' | 'dark' });

  // Auto-start tour on first visit
  useEffect(() => {
    // Small delay to ensure DOM is ready
    const timer = setTimeout(() => {
      if (!hasSeenTour('main')) {
        startTour('main');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [hasSeenTour, startTour]);

  // Apply Theme & Typography Effects
  useEffect(() => {
    const root = document.documentElement;

    // Set theme - CSS variables handle colors via data-theme attribute
    root.setAttribute('data-theme', settings.theme);

    // Toggle .dark class for Tailwind dark: utilities (backward compatibility)
    if (settings.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    // Font Size
    root.setAttribute('data-font-size', settings.fontSize);
    // Remove previous font classes
    root.classList.remove('font-sans', 'font-serif', 'font-mono');
    // Add new
    root.classList.add(`font-${settings.fontFamily}`);

  }, [settings]);

  const toggleTheme = () => {
    const newTheme = settings.theme === 'light' ? 'dark' : 'light';
    updateSettings({ theme: newTheme });
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openCommandPalette(); // Open CommandPalette with Cmd+K
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
        toggleSearchPanel(); // Toggle floating search panel with Cmd+Shift+S
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, updateSettings, settings.focusMode, toggleSidebar, toggleSearchPanel, openCommandPalette]);

  return (
    <div className="min-h-screen flex bg-theme-bg text-theme-text transition-colors duration-300">
      {/* Mobile Overlay */}
      {sidebarOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Desktop Sidebar - Slide animation with new w-16 width */}
      <motion.div
        initial={false}
        animate={{
          width: sidebarVisible && !settings.focusMode ? 64 : 0,
          opacity: sidebarVisible && !settings.focusMode ? 1 : 0,
        }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="hidden lg:block overflow-hidden"
      >
        {sidebarVisible && !settings.focusMode && (
          <Sidebar
            theme={settings.theme}
            toggleTheme={toggleTheme}
            isOpen={true}
            closeMobile={() => { }}
            openSettings={() => setSettingsOpen(true)}
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
          />
        </div>
      )}

      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden relative">
        {/* Floating Focus Toggle - Desktop only (study feature) */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => updateSettings({ focusMode: !settings.focusMode })}
          id="tour-focus-toggle"
          className={cn(
            'hidden md:block fixed top-4 right-4 z-50 p-2.5 rounded-xl transition-all duration-200',
            // Liquid Glass effect
            'backdrop-blur-2xl shadow-glass',
            settings.focusMode
              ? 'bg-blue-500/90 text-white hover:bg-blue-600/90'
              : 'bg-white/70 dark:bg-gray-800/70 text-gray-600 dark:text-gray-300 hover:bg-white/90 dark:hover:bg-gray-800/90 border border-white/20 dark:border-white/10'
          )}
          title={settings.focusMode ? 'Esci da Focus Mode (Cmd+Space)' : 'Focus Mode (Cmd+Space)'}
        >
          {settings.focusMode ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
        </motion.button>

        {/* Mobile Menu Button - Only visible on mobile */}
        {!settings.focusMode && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden fixed top-4 left-4 z-50 p-2.5 rounded-xl backdrop-blur-2xl shadow-glass bg-white/70 dark:bg-gray-800/70 text-gray-600 dark:text-gray-300 border border-white/20 dark:border-white/10"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </motion.button>
        )}

        {/* Content Area - Full height, no navbar padding needed */}
        <div className="flex-1 overflow-y-auto w-full h-full">
          <div className={cn(
            'max-w-7xl mx-auto p-6 md:p-8',
            settings.focusMode && 'max-w-4xl py-12'
          )}>
            <Outlet />
          </div>
        </div>
      </main>

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} onRestartTour={resetAndStartTour} />
    </div>
  );
}
