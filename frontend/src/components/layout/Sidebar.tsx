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

      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        <NavLink
          to="/"
          className={({ isActive }) => cn(
            "group flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 mx-2 relative overflow-hidden",
            isActive
              ? "text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/20 font-semibold shadow-sm"
              : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white"
          )}
          onClick={closeMobile}
        >
          {({ isActive }) => (
            <>
              {/* Active Indicator Bar */}
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-1 bg-blue-500 rounded-r-full" />
              )}
              <Search
                size={22}
                className={cn(
                  "transition-transform group-hover:scale-110",
                  isActive ? "stroke-[2.5px]" : "stroke-[2px]"
                )}
              />
              <span className="tracking-wide">Ricerca</span>
            </>
          )}
        </NavLink>
        <NavLink
          to="/dossier"
          className={({ isActive }) => cn(
            "group flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 mx-2 relative overflow-hidden",
            isActive
              ? "text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/20 font-semibold shadow-sm"
              : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white"
          )}
          onClick={closeMobile}
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-1 bg-blue-500 rounded-r-full" />
              )}
              <Folder
                size={22}
                className={cn(
                  "transition-transform group-hover:scale-110",
                  isActive ? "stroke-[2.5px]" : "stroke-[2px]"
                )}
              />
              <span className="tracking-wide">Dossier</span>
            </>
          )}
        </NavLink>
        <NavLink
          to="/history"
          className={({ isActive }) => cn(
            "group flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 mx-2 relative overflow-hidden",
            isActive
              ? "text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/20 font-semibold shadow-sm"
              : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white"
          )}
          onClick={closeMobile}
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-1 bg-blue-500 rounded-r-full" />
              )}
              <Clock
                size={22}
                className={cn(
                  "transition-transform group-hover:scale-110",
                  isActive ? "stroke-[2.5px]" : "stroke-[2px]"
                )}
              />
              <span className="tracking-wide">Cronologia</span>
            </>
          )}
        </NavLink>
        <NavLink
          to="/bookmarks"
          className={({ isActive }) => cn(
            "group flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 mx-2 relative overflow-hidden",
            isActive
              ? "text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/20 font-semibold shadow-sm"
              : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white"
          )}
          onClick={closeMobile}
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-1 bg-blue-500 rounded-r-full" />
              )}
              <Bookmark
                size={22}
                className={cn(
                  "transition-transform group-hover:scale-110",
                  isActive ? "stroke-[2.5px]" : "stroke-[2px]"
                )}
              />
              <span className="tracking-wide">Segnalibri</span>
            </>
          )}
        </NavLink>
      </nav>

      {/* System Section with Separator */}
      <div className="p-4 border-t border-gray-200 dark:border-gray-800">
        <div className="px-3 pt-2 pb-3">
          <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400 dark:text-gray-600">
            Sistema
          </span>
        </div>
        <div className="space-y-2">
          <button
            onClick={openSettings}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white transition-all group"
          >
            <Settings size={20} className="transition-transform group-hover:scale-110" />
            Impostazioni
          </button>
          <button
            onClick={toggleTheme}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white transition-all group"
          >
            {theme === 'light' ? (
              <Moon size={20} className="transition-transform group-hover:scale-110" />
            ) : (
              <Sun size={20} className="transition-transform group-hover:scale-110" />
            )}
            {theme === 'light' ? 'Tema Scuro' : 'Tema Chiaro'}
          </button>
        </div>
      </div>
    </aside>
  );
}
