import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, Search, Folder, Clock, Moon, Sun, Settings, Sparkles, Globe, LogOut, Shield } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store/useAppStore';
import { useAuth } from '../../hooks/useAuth';

interface SidebarProps {
  theme: string;
  toggleTheme: () => void;
  isOpen: boolean;
  closeMobile: () => void;
  openSettings: () => void;
}

interface NavItemProps {
  to: string;
  icon: React.ElementType;
  label: string;
  onClick?: () => void;
  id?: string;
}

// Spring config for smooth animations
const SPRING_CONFIG = { type: 'spring' as const, stiffness: 400, damping: 30 };

function NavItem({ to, icon: Icon, label, onClick, id }: NavItemProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <NavLink
      to={to}
      id={id}
      className={({ isActive }) => cn(
        "relative flex items-center justify-center rounded-xl transition-all duration-200",
        "hover:bg-slate-100 dark:hover:bg-slate-800",
        // Mobile: larger touch target (min 44px)
        "w-12 h-12 md:w-11 md:h-11",
        isActive && "bg-primary-50 dark:bg-primary-900/10"
      )}
      onClick={onClick}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {({ isActive }) => (
        <>
          <motion.div
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            transition={SPRING_CONFIG}
          >
            <Icon
              size={22}
              className={cn(
                "transition-colors duration-200",
                isActive
                  ? "text-primary-600 dark:text-primary-400 stroke-[2.5px]"
                  : "text-slate-500 dark:text-slate-400 stroke-[2px]"
              )}
            />
          </motion.div>

          {/* Active indicator dot */}
          {isActive && (
            <motion.span
              layoutId="activeIndicator"
              className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-primary-600 rounded-r-full"
              transition={SPRING_CONFIG}
            />
          )}

          {/* Tooltip - hidden on mobile */}
          <AnimatePresence>
            {showTooltip && (
              <motion.div
                initial={{ opacity: 0, x: -8, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -8, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="hidden md:block absolute left-full ml-3 px-3 py-1.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium rounded-lg shadow-lg whitespace-nowrap z-50"
              >
                {label}
                {/* Arrow */}
                <span className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-2 h-2 bg-slate-900 dark:bg-slate-100 rotate-45" />
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </NavLink>
  );
}

interface ActionButtonProps {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  isActive?: boolean;
}

function ActionButton({ icon: Icon, label, onClick, isActive }: ActionButtonProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      className={cn(
        "relative flex items-center justify-center rounded-xl transition-all duration-200",
        "hover:bg-slate-100 dark:hover:bg-slate-800",
        // Mobile: larger touch target
        "w-12 h-12 md:w-11 md:h-11",
        isActive && "bg-primary-50 dark:bg-primary-900/10"
      )}
    >
      <motion.div
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        transition={SPRING_CONFIG}
      >
        <Icon
          size={20}
          className={cn(
            "transition-colors duration-200",
            isActive
              ? "text-primary-600 dark:text-primary-400"
              : "text-slate-500 dark:text-slate-400"
          )}
        />
      </motion.div>

      {/* Tooltip */}
      <AnimatePresence>
        {showTooltip && (
          <motion.div
            initial={{ opacity: 0, x: -8, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="hidden md:block absolute left-full ml-3 px-3 py-1.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium rounded-lg shadow-lg whitespace-nowrap z-50"
          >
            {label}
            <span className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-2 h-2 bg-slate-900 dark:bg-slate-100 rotate-45" />
          </motion.div>
        )}
      </AnimatePresence>
    </button>
  );
}

export function Sidebar({ theme, toggleTheme, isOpen, closeMobile, openSettings }: SidebarProps) {
  const navigate = useNavigate();
  const { openCommandPalette, quickNorms } = useAppStore();
  const { user, isAdmin, logout } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userButtonRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState({ bottom: 0, left: 0 });

  // Calculate menu position when showing
  useEffect(() => {
    if (showUserMenu && userButtonRef.current) {
      const rect = userButtonRef.current.getBoundingClientRect();
      // Position the menu to the right of the button, aligned to bottom of button
      setMenuPosition({
        bottom: window.innerHeight - rect.bottom,
        left: rect.right + 8, // 8px gap from button
      });
    }
  }, [showUserMenu]);

  const handleSparklesClick = () => {
    // Navigate to search page first, then open command palette
    navigate('/');
    openCommandPalette();
  };

  return (
    <aside
      className={cn(
        // Base layout
        "fixed inset-y-0 left-0 z-50 flex flex-col",
        "w-20 md:w-16",
        // Clean Slate/Glass effect
        "bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl",
        "border-r border-slate-200 dark:border-slate-800",
        // Mobile slide
        "transform transition-transform duration-300 ease-smooth-out",
        "lg:translate-x-0 lg:static",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}
    >
      {/* Logo */}
      <div className="flex items-center justify-center h-16 border-b border-slate-100 dark:border-slate-800/50">
        <motion.div
          whileHover={{ scale: 1.1, rotate: 5 }}
          whileTap={{ scale: 0.95 }}
          transition={SPRING_CONFIG}
        >
          <BookOpen className="w-7 h-7 text-primary-600 dark:text-primary-400" />
        </motion.div>
      </div>

      {/* Quick Search Button */}
      <div className="flex flex-col items-center pt-4 pb-2 border-b border-slate-100 dark:border-slate-800/50">
        <div id="tour-quick-search">
          <ActionButton
            icon={Sparkles}
            label="Ricerca Veloce ⌘K"
            onClick={handleSparklesClick}
            isActive={false}
          />
        </div>
        {quickNorms.length > 0 && (
          <div className="mt-1 w-5 h-1 rounded-full bg-amber-500/60" title={`${quickNorms.length} preferiti`} />
        )}
      </div>

      {/* Navigation */}
      <nav id="tour-sidebar" className="flex-1 flex flex-col items-center py-4 gap-3 md:gap-2">
        <NavItem to="/" icon={Search} label="Ricerca" onClick={closeMobile} />
        <NavItem to="/dossier" icon={Folder} label="Dossier" onClick={closeMobile} id="tour-nav-dossier" />
        <NavItem to="/environments" icon={Globe} label="Ambienti" onClick={closeMobile} />
        <NavItem to="/history" icon={Clock} label="Cronologia" onClick={closeMobile} />
      </nav>

      {/* System Actions */}
      <div className="flex flex-col items-center py-4 gap-3 md:gap-2 border-t border-slate-100 dark:border-slate-800/50">
        <ActionButton
          icon={Settings}
          label="Impostazioni"
          onClick={openSettings}
        />
        <ActionButton
          icon={theme === 'dark' ? Sun : Moon}
          label={theme === 'dark' ? 'Tema Chiaro' : 'Tema Scuro'}
          onClick={toggleTheme}
        />
      </div>

      {/* User Menu */}
      <div className="flex flex-col items-center py-4 border-t border-slate-100 dark:border-slate-800/50">
        <button
          ref={userButtonRef}
          onClick={() => setShowUserMenu(!showUserMenu)}
          className={cn(
            "relative flex items-center justify-center rounded-xl transition-all duration-200",
            "hover:bg-slate-100 dark:hover:bg-slate-800",
            "w-12 h-12 md:w-11 md:h-11",
            showUserMenu && "bg-primary-50 dark:bg-primary-900/10"
          )}
        >
          <motion.div
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            transition={SPRING_CONFIG}
            className={cn(
              "rounded-lg flex items-center justify-center text-sm font-semibold",
              "w-9 h-9 md:w-8 md:h-8",
              isAdmin
                ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                : "bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400"
            )}
          >
            {user?.username?.charAt(0).toUpperCase() || 'U'}
          </motion.div>
        </button>

        {/* User Dropdown Menu - rendered via Portal */}
        {showUserMenu && createPortal(
          <>
            {/* Backdrop - cattura click esterni */}
            <div
              className="fixed inset-0 z-[9990]"
              onClick={() => setShowUserMenu(false)}
            />
            {/* Menu popup */}
            <div
              style={{ bottom: menuPosition.bottom, left: menuPosition.left }}
              className="fixed z-[9991] w-56 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 py-2 animate-in fade-in zoom-in-95 duration-150"
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
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowUserMenu(false);
                      navigate('/admin');
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                  >
                    <Shield size={16} />
                    Pannello Admin
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setShowUserMenu(false);
                    logout();
                    navigate('/login');
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors cursor-pointer"
                >
                  <LogOut size={16} />
                  Esci
                </button>
              </div>
            </div>
          </>,
          document.body
        )}
      </div>
    </aside>
  );
}
