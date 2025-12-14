import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, Search, Folder, Clock, Moon, Sun, Settings, Sparkles, Star } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store/useAppStore';

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
}

// Spring config for smooth animations
const SPRING_CONFIG = { type: 'spring', stiffness: 400, damping: 30 };

function NavItem({ to, icon: Icon, label, onClick }: NavItemProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <NavLink
      to={to}
      className={({ isActive }) => cn(
        "relative flex items-center justify-center w-11 h-11 rounded-xl transition-all duration-200",
        "hover:bg-white/40 dark:hover:bg-white/10",
        isActive && "bg-blue-500/15 dark:bg-blue-500/20"
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
                  ? "text-blue-600 dark:text-blue-400 stroke-[2.5px]"
                  : "text-gray-600 dark:text-gray-400 stroke-[2px]"
              )}
            />
          </motion.div>

          {/* Active indicator dot */}
          {isActive && (
            <motion.span
              layoutId="activeIndicator"
              className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-blue-500 rounded-r-full"
              transition={SPRING_CONFIG}
            />
          )}

          {/* Tooltip */}
          <AnimatePresence>
            {showTooltip && (
              <motion.div
                initial={{ opacity: 0, x: -8, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -8, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute left-full ml-3 px-3 py-1.5 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium rounded-lg shadow-lg whitespace-nowrap z-50"
              >
                {label}
                {/* Arrow */}
                <span className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-2 h-2 bg-gray-900 dark:bg-gray-100 rotate-45" />
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
        "relative flex items-center justify-center w-11 h-11 rounded-xl transition-all duration-200",
        "hover:bg-white/40 dark:hover:bg-white/10",
        isActive && "bg-blue-500/15"
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
              ? "text-blue-600 dark:text-blue-400"
              : "text-gray-500 dark:text-gray-400"
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
            className="absolute left-full ml-3 px-3 py-1.5 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium rounded-lg shadow-lg whitespace-nowrap z-50"
          >
            {label}
            <span className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-2 h-2 bg-gray-900 dark:bg-gray-100 rotate-45" />
          </motion.div>
        )}
      </AnimatePresence>
    </button>
  );
}

export function Sidebar({ theme, toggleTheme, isOpen, closeMobile, openSettings }: SidebarProps) {
  const navigate = useNavigate();
  const { openCommandPalette, quickNorms } = useAppStore();

  const handleSparklesClick = () => {
    // Navigate to search page first, then open command palette
    navigate('/');
    openCommandPalette();
  };

  return (
    <aside
      className={cn(
        // Base layout
        "fixed inset-y-0 left-0 z-50 w-16 flex flex-col",
        // Glass effect using CSS variables
        "backdrop-blur-2xl",
        "shadow-glass",
        // Mobile slide
        "transform transition-transform duration-300 ease-out",
        "lg:translate-x-0 lg:static",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}
      style={{
        backgroundColor: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--glass-border)',
      }}
    >
      {/* Logo */}
      <div className="flex items-center justify-center h-16 border-b border-white/10 dark:border-white/5">
        <motion.div
          whileHover={{ scale: 1.1, rotate: 5 }}
          whileTap={{ scale: 0.95 }}
          transition={SPRING_CONFIG}
        >
          <BookOpen className="w-7 h-7 text-blue-600 dark:text-blue-400" />
        </motion.div>
      </div>

      {/* Quick Search Button */}
      <div className="flex flex-col items-center pt-4 pb-2 border-b border-white/10 dark:border-white/5">
        <ActionButton
          icon={Sparkles}
          label="Ricerca Veloce ⌘K"
          onClick={handleSparklesClick}
          isActive={false}
        />
        {quickNorms.length > 0 && (
          <div className="mt-1 w-5 h-1 rounded-full bg-amber-500/60" title={`${quickNorms.length} preferiti`} />
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 flex flex-col items-center py-4 gap-2">
        <NavItem to="/" icon={Search} label="Ricerca" onClick={closeMobile} />
        <NavItem to="/dossier" icon={Folder} label="Dossier" onClick={closeMobile} />
        <NavItem to="/history" icon={Clock} label="Cronologia" onClick={closeMobile} />
      </nav>

      {/* System Actions */}
      <div className="flex flex-col items-center py-4 gap-2 border-t border-white/10 dark:border-white/5">
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
    </aside>
  );
}
