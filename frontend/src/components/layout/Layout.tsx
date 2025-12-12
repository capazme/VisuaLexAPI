import { useState, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Menu, Maximize2, Minimize2, Settings as SettingsIcon } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { SettingsModal } from '../ui/SettingsModal';
import { cn } from '../../lib/utils';

export function Layout() {
  const { settings, updateSettings, sidebarVisible, toggleSidebar, toggleSearchPanel } = useAppStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Apply Theme & Typography Effects
  useEffect(() => {
    const root = document.documentElement;
    
    // Theme
    root.setAttribute('data-theme', settings.theme);
    if (settings.theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    
    // Classes for Sepia/HighContrast handling in CSS would be needed, or just rely on data-theme
    
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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            toggleSearchPanel();
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
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, updateSettings, settings.focusMode, toggleSidebar, toggleSearchPanel]);

  const pageTitles: Record<string, string> = {
    '/': 'Ricerca Normativa',
    '/dossier': 'Dossier',
    '/history': 'Cronologia',
    '/bookmarks': 'Segnalibri',
  };

  return (
    <div className={cn(
        "min-h-screen flex transition-colors duration-300",
        settings.theme === 'sepia' ? 'bg-[#f4ecd8] text-[#5b4636]' : 
        settings.theme === 'high-contrast' ? 'bg-white text-black' : 
        "bg-gray-50 dark:bg-gray-950"
    )}>
      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Desktop Sidebar - Slide animation */}
      <div className={cn(
        "hidden lg:block transition-all duration-300 ease-in-out",
        sidebarVisible ? "w-64" : "w-0"
      )}>
        {sidebarVisible && !settings.focusMode && (
          <Sidebar
            theme={settings.theme}
            toggleTheme={toggleTheme}
            isOpen={true}
            closeMobile={() => {}}
            openSettings={() => setSettingsOpen(true)}
          />
        )}
      </div>

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
        {/* Animated Header with Framer Motion */}
        <motion.header
          initial={false}
          animate={{
            y: settings.focusMode ? -100 : 0,
            opacity: settings.focusMode ? 0 : 1,
          }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between z-20 absolute w-full top-0 left-0"
        >
          <div className="flex items-center gap-3">
            {/* Mobile toggle */}
            <button
              className="lg:hidden p-2 -ml-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <Menu size={24} className="text-gray-600 dark:text-gray-300" />
            </button>

            {/* Desktop toggle */}
            <button
              className="hidden lg:block p-2 -ml-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
              onClick={toggleSidebar}
              title="Toggle Sidebar (Cmd+B)"
            >
              <Menu size={20} className="text-gray-600 dark:text-gray-300" />
            </button>

            <h1 className="text-lg font-medium text-gray-700 dark:text-gray-200">
              {pageTitles[location.pathname] || 'VisuaLex'}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setSettingsOpen(true)}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md text-gray-600 dark:text-gray-300"
              title="Impostazioni"
            >
              <SettingsIcon size={20} />
            </button>
          </div>
        </motion.header>

        {/* Floating Focus Toggle - Always Visible */}
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => updateSettings({ focusMode: !settings.focusMode })}
          className={cn(
            'absolute top-4 right-4 z-50 p-3 rounded-full shadow-lg backdrop-blur-sm transition-colors',
            settings.focusMode
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-white/80 dark:bg-gray-800/80 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800'
          )}
          title={settings.focusMode ? 'Esci da Focus Mode (Cmd+Space)' : 'Focus Mode (Cmd+Space)'}
        >
          {settings.focusMode ? <Minimize2 size={24} /> : <Maximize2 size={24} />}
        </motion.button>

        {/* Content Area with Padding Adjustment */}
        <motion.div
          animate={{ paddingTop: settings.focusMode ? 0 : 80 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="flex-1 overflow-y-auto w-full h-full"
        >
          <div className={cn('max-w-7xl mx-auto p-6 md:p-8', settings.focusMode && 'max-w-4xl py-12')}>
            <Outlet />
          </div>
        </motion.div>
      </main>

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
