import { motion, AnimatePresence } from 'framer-motion';
import { X, Minus, Plus, Sun, Moon, BookOpen } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { StudyModeTheme } from './StudyMode';

interface StudyModeSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  lineHeight: number;
  onLineHeightChange: (height: number) => void;
  theme: StudyModeTheme;
  onThemeChange: (theme: StudyModeTheme) => void;
}

const THEME_SETTINGS_STYLES: Record<StudyModeTheme, { bg: string; border: string; text: string; muted: string; button: string }> = {
  light: {
    bg: 'bg-white',
    border: 'border-slate-200',
    text: 'text-slate-900',
    muted: 'text-slate-500',
    button: 'hover:bg-slate-100'
  },
  dark: {
    bg: 'bg-slate-900',
    border: 'border-slate-700',
    text: 'text-slate-100',
    muted: 'text-slate-400',
    button: 'hover:bg-slate-800'
  },
  sepia: {
    bg: 'bg-[#f4ecd8]',
    border: 'border-[#d4c4a8]',
    text: 'text-[#5c4b37]',
    muted: 'text-[#8b7355]',
    button: 'hover:bg-[#e4d4b8]'
  }
};

export function StudyModeSettings({
  isOpen,
  onClose,
  fontSize,
  onFontSizeChange,
  lineHeight,
  onLineHeightChange,
  theme,
  onThemeChange
}: StudyModeSettingsProps) {
  const styles = THEME_SETTINGS_STYLES[theme];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-30"
            onClick={onClose}
          />

          {/* Settings Panel */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className={cn(
              "fixed z-40 rounded-xl shadow-2xl border overflow-hidden",
              // Mobile: nearly full width, centered horizontally
              "left-4 right-4 top-16 w-auto",
              // Desktop: fixed width and position
              "sm:left-auto sm:right-6 sm:w-72",
              styles.bg,
              styles.border
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className={cn("flex items-center justify-between px-4 py-3 border-b", styles.border)}>
              <h3 className={cn("font-semibold text-sm uppercase tracking-wide", styles.text)}>Impostazioni</h3>
              <button
                onClick={onClose}
                className={cn("p-1 rounded-md transition-colors", styles.button, styles.muted)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 space-y-6">
              {/* Theme Selection */}
              <div>
                <label className={cn("text-[10px] font-bold uppercase tracking-wider mb-3 block opacity-70", styles.muted)}>
                  Tema
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => onThemeChange('light')}
                    className={cn(
                      "flex-1 flex flex-col items-center gap-2 p-3 rounded-lg border transition-all",
                      theme === 'light'
                        ? 'border-yellow-500 bg-yellow-50 shadow-sm'
                        : cn('border-transparent', styles.button)
                    )}
                  >
                    <Sun size={20} className={theme === 'light' ? 'text-yellow-500' : styles.muted} />
                    <span className={cn("text-xs font-medium", theme === 'light' ? 'text-yellow-700' : styles.muted)}>Chiaro</span>
                  </button>
                  <button
                    onClick={() => onThemeChange('sepia')}
                    className={cn(
                      "flex-1 flex flex-col items-center gap-2 p-3 rounded-lg border transition-all",
                      theme === 'sepia'
                        ? 'border-amber-500 bg-amber-50 shadow-sm'
                        : cn('border-transparent', styles.button)
                    )}
                  >
                    <BookOpen size={20} className={theme === 'sepia' ? 'text-amber-600' : styles.muted} />
                    <span className={cn("text-xs font-medium", theme === 'sepia' ? 'text-amber-800' : styles.muted)}>Seppia</span>
                  </button>
                  <button
                    onClick={() => onThemeChange('dark')}
                    className={cn(
                      "flex-1 flex flex-col items-center gap-2 p-3 rounded-lg border transition-all",
                      theme === 'dark'
                        ? 'border-blue-500 bg-slate-800 shadow-sm'
                        : cn('border-transparent', styles.button)
                    )}
                  >
                    <Moon size={20} className={theme === 'dark' ? 'text-blue-400' : styles.muted} />
                    <span className={cn("text-xs font-medium", theme === 'dark' ? 'text-blue-200' : styles.muted)}>Scuro</span>
                  </button>
                </div>
              </div>

              {/* Font Size */}
              <div id="tour-study-typography">
                <div className="flex items-center justify-between mb-3">
                  <label className={cn("text-[10px] font-bold uppercase tracking-wider opacity-70", styles.muted)}>
                    Dimensione testo
                  </label>
                  <span className={cn("text-xs font-mono font-medium opacity-70", styles.text)}>
                    {fontSize}px
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => onFontSizeChange(Math.max(14, fontSize - 2))}
                    disabled={fontSize <= 14}
                    className={cn(
                      "p-1.5 rounded-md transition-colors disabled:opacity-30",
                      styles.button,
                      styles.text
                    )}
                  >
                    <Minus size={16} />
                  </button>
                  <div className="flex-1 px-1">
                    <input
                      type="range"
                      min={14}
                      max={32}
                      step={2}
                      value={fontSize}
                      onChange={(e) => onFontSizeChange(parseInt(e.target.value))}
                      className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-primary-500 dark:bg-slate-700"
                    />
                  </div>
                  <button
                    onClick={() => onFontSizeChange(Math.min(32, fontSize + 2))}
                    disabled={fontSize >= 32}
                    className={cn(
                      "p-1.5 rounded-md transition-colors disabled:opacity-30",
                      styles.button,
                      styles.text
                    )}
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>

              {/* Line Height */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className={cn("text-[10px] font-bold uppercase tracking-wider opacity-70", styles.muted)}>
                    Interlinea
                  </label>
                  <span className={cn("text-xs font-mono font-medium opacity-70", styles.text)}>
                    {lineHeight.toFixed(1)}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => onLineHeightChange(Math.max(1.4, lineHeight - 0.2))}
                    disabled={lineHeight <= 1.4}
                    className={cn(
                      "p-1.5 rounded-md transition-colors disabled:opacity-30",
                      styles.button,
                      styles.text
                    )}
                  >
                    <Minus size={16} />
                  </button>
                  <div className="flex-1 px-1">
                    <input
                      type="range"
                      min={1.4}
                      max={2.4}
                      step={0.2}
                      value={lineHeight}
                      onChange={(e) => onLineHeightChange(parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-primary-500 dark:bg-slate-700"
                    />
                  </div>
                  <button
                    onClick={() => onLineHeightChange(Math.min(2.4, lineHeight + 0.2))}
                    disabled={lineHeight >= 2.4}
                    className={cn(
                      "p-1.5 rounded-md transition-colors disabled:opacity-30",
                      styles.button,
                      styles.text
                    )}
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
