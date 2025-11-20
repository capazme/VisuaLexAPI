import { useState, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Menu, Maximize2, Minimize2, Settings as SettingsIcon, SplitSquareHorizontal } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { SettingsModal } from '../ui/SettingsModal';
import { cn } from '../../lib/utils';

export function Layout() {
  const { settings, updateSettings } = useAppStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
            const select = document.getElementById('search-act-type') as HTMLSelectElement | null;
            select?.focus();
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
            e.preventDefault();
            navigate('/bookmarks');
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') {
            e.preventDefault();
            navigate('/workspace');
        }
        if ((e.metaKey || e.ctrlKey) && e.key === ' ') {
            e.preventDefault();
            updateSettings({ focusMode: !settings.focusMode });
        }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, updateSettings, settings.focusMode]);

  const pageTitles: Record<string, string> = {
    '/': 'Ricerca Normativa',
    '/workspace': 'Workspace',
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

      {!settings.focusMode && (
          <Sidebar 
            theme={settings.theme} 
            toggleTheme={toggleTheme} 
            isOpen={sidebarOpen} 
            closeMobile={() => setSidebarOpen(false)} 
            openSettings={() => setSettingsOpen(true)}
          />
      )}

      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden relative">
        
        {/* Header - Hidden in Focus Mode unless hovered? Or just a small button */}
        <header className={cn(
            "px-4 py-3 flex items-center justify-between shrink-0 transition-all duration-300",
            settings.focusMode ? "absolute top-0 left-0 right-0 z-10 bg-transparent pointer-events-none p-2" : "bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800"
        )}>
          <div className={cn("flex items-center gap-3 pointer-events-auto", settings.focusMode ? "opacity-0 hover:opacity-100 transition-opacity bg-white/90 dark:bg-black/90 p-2 rounded-lg shadow-sm backdrop-blur" : "")}>
            {!settings.focusMode && (
              <>
                <button 
                    onClick={() => updateSettings({ splitView: !settings.splitView })}
                    className={cn(
                        "p-2 rounded-md transition-colors text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800",
                        settings.splitView && "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300"
                    )}
                    title="Vista affiancata"
                >
                    <SplitSquareHorizontal size={20} />
                </button>
                <button 
                    className="lg:hidden p-2 -ml-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md"
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    >
                    <Menu size={24} className="text-gray-600 dark:text-gray-300" />
                </button>
              </>
            )}
            <h1 className="text-lg font-medium text-gray-700 dark:text-gray-200">
              {pageTitles[location.pathname] || 'VisuaLex'}
            </h1>
          </div>

          <div className="flex items-center gap-2 pointer-events-auto">
             {!settings.focusMode && (
                 <button 
                    onClick={() => setSettingsOpen(true)}
                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md text-gray-600 dark:text-gray-300"
                    title="Impostazioni"
                 >
                    <SettingsIcon size={20} />
                 </button>
             )}
             <button 
                onClick={() => updateSettings({ focusMode: !settings.focusMode })}
                className={cn(
                    "p-2 rounded-md transition-colors",
                    settings.focusMode 
                        ? "bg-blue-600 text-white shadow-lg hover:bg-blue-700" 
                        : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
                )} 
                title={settings.focusMode ? "Esci da Focus Mode" : "Focus Mode"}
            >
                {settings.focusMode ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
             </button>
          </div>
        </header>

        <div className={cn("flex-1 overflow-y-auto p-4 lg:p-6 scroll-smooth", settings.focusMode && "lg:px-20 xl:px-40")}>
          <Outlet />
        </div>
      </main>

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
