import { NavLink } from 'react-router-dom';
import { BookOpen, Search, Folder, Clock, Bookmark, Moon, Sun, Settings } from 'lucide-react';
import { cn } from '../../lib/utils';

interface SidebarProps {
  theme: string;
  toggleTheme: () => void;
  isOpen: boolean;
  closeMobile: () => void;
  openSettings: () => void;
}

export function Sidebar({ theme, toggleTheme, isOpen, closeMobile, openSettings }: SidebarProps) {
  return (
    <aside 
      className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 transform transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static lg:h-screen flex flex-col",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}
    >
      <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center gap-3">
        <BookOpen className="w-8 h-8 text-blue-600" />
        <span className="text-xl font-bold text-gray-900 dark:text-white">VisuaLex</span>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        <NavLink 
          to="/" 
          className={({ isActive }) => cn(
            "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
            isActive ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium" : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          )}
          onClick={closeMobile}
        >
          <Search size={20} />
          Ricerca
        </NavLink>
        <NavLink
          to="/dossier"
          className={({ isActive }) => cn(
            "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
            isActive ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium" : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          )}
          onClick={closeMobile}
        >
          <Folder size={20} />
          Dossier
        </NavLink>
        <NavLink 
          to="/history" 
          className={({ isActive }) => cn(
            "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
            isActive ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium" : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          )}
          onClick={closeMobile}
        >
          <Clock size={20} />
          Cronologia
        </NavLink>
        <NavLink 
          to="/bookmarks" 
          className={({ isActive }) => cn(
            "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
            isActive ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium" : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          )}
          onClick={closeMobile}
        >
          <Bookmark size={20} />
          Segnalibri
        </NavLink>
      </nav>

      <div className="p-4 border-t border-gray-200 dark:border-gray-800 space-y-2">
        <button 
            onClick={openSettings}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
            <Settings size={20} />
            Impostazioni
        </button>
        <button 
          onClick={toggleTheme}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
          {theme === 'light' ? 'Tema Scuro' : 'Tema Chiaro'}
        </button>
      </div>
    </aside>
  );
}
