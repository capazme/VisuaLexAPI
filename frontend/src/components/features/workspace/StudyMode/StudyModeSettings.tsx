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
    border: 'border-gray-200',
    text: 'text-gray-900',
    muted: 'text-gray-500',
    button: 'hover:bg-gray-100'
  },
  dark: {
    bg: 'bg-gray-800',
    border: 'border-gray-700',
    text: 'text-gray-100',
    muted: 'text-gray-400',
    button: 'hover:bg-gray-700'
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
              "fixed top-16 right-6 z-40 w-72 rounded-xl shadow-2xl border",
              styles.bg,
              styles.border
            )}
          >
            {/* Header */}
            <div className={cn("flex items-center justify-between px-4 py-3 border-b", styles.border)}>
              <h3 className={cn("font-semibold", styles.text)}>Impostazioni</h3>
              <button
                onClick={onClose}
                className={cn("p-1 rounded-lg transition-colors", styles.button, styles.muted)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 space-y-5">
              {/* Theme Selection */}
              <div>
                <label className={cn("text-xs font-semibold uppercase mb-2 block", styles.muted)}>
                  Tema
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => onThemeChange('light')}
                    className={cn(
                      "flex-1 flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-all",
                      theme === 'light'
                        ? 'border-blue-500 bg-blue-50'
                        : cn('border-transparent', styles.button)
                    )}
                  >
                    <Sun size={20} className={theme === 'light' ? 'text-yellow-500' : styles.muted} />
                    <span className={cn("text-xs font-medium", styles.text)}>Chiaro</span>
                  </button>
                  <button
                    onClick={() => onThemeChange('sepia')}
                    className={cn(
                      "flex-1 flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-all",
                      theme === 'sepia'
                        ? 'border-amber-500 bg-amber-50'
                        : cn('border-transparent', styles.button)
                    )}
                  >
                    <BookOpen size={20} className={theme === 'sepia' ? 'text-amber-600' : styles.muted} />
                    <span className={cn("text-xs font-medium", styles.text)}>Seppia</span>
                  </button>
                  <button
                    onClick={() => onThemeChange('dark')}
                    className={cn(
                      "flex-1 flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-all",
                      theme === 'dark'
                        ? 'border-blue-500 bg-blue-900/30'
                        : cn('border-transparent', styles.button)
                    )}
                  >
                    <Moon size={20} className={theme === 'dark' ? 'text-blue-400' : styles.muted} />
                    <span className={cn("text-xs font-medium", styles.text)}>Scuro</span>
                  </button>
                </div>
              </div>

              {/* Font Size */}
              <div>
                <label className={cn("text-xs font-semibold uppercase mb-2 block", styles.muted)}>
                  Dimensione testo
                </label>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => onFontSizeChange(Math.max(14, fontSize - 2))}
                    disabled={fontSize <= 14}
                    className={cn(
                      "p-2 rounded-lg transition-colors disabled:opacity-30",
                      styles.button
                    )}
                  >
                    <Minus size={16} />
                  </button>
                  <div className="flex-1 text-center">
                    <span className={cn("text-lg font-mono font-medium", styles.text)}>
                      {fontSize}px
                    </span>
                  </div>
                  <button
                    onClick={() => onFontSizeChange(Math.min(32, fontSize + 2))}
                    disabled={fontSize >= 32}
                    className={cn(
                      "p-2 rounded-lg transition-colors disabled:opacity-30",
                      styles.button
                    )}
                  >
                    <Plus size={16} />
                  </button>
                </div>
                {/* Slider */}
                <input
                  type="range"
                  min={14}
                  max={32}
                  step={2}
                  value={fontSize}
                  onChange={(e) => onFontSizeChange(parseInt(e.target.value))}
                  className="w-full mt-2 accent-blue-500"
                />
              </div>

              {/* Line Height */}
              <div>
                <label className={cn("text-xs font-semibold uppercase mb-2 block", styles.muted)}>
                  Interlinea
                </label>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => onLineHeightChange(Math.max(1.4, lineHeight - 0.2))}
                    disabled={lineHeight <= 1.4}
                    className={cn(
                      "p-2 rounded-lg transition-colors disabled:opacity-30",
                      styles.button
                    )}
                  >
                    <Minus size={16} />
                  </button>
                  <div className="flex-1 text-center">
                    <span className={cn("text-lg font-mono font-medium", styles.text)}>
                      {lineHeight.toFixed(1)}
                    </span>
                  </div>
                  <button
                    onClick={() => onLineHeightChange(Math.min(2.4, lineHeight + 0.2))}
                    disabled={lineHeight >= 2.4}
                    className={cn(
                      "p-2 rounded-lg transition-colors disabled:opacity-30",
                      styles.button
                    )}
                  >
                    <Plus size={16} />
                  </button>
                </div>
                {/* Slider */}
                <input
                  type="range"
                  min={1.4}
                  max={2.4}
                  step={0.2}
                  value={lineHeight}
                  onChange={(e) => onLineHeightChange(parseFloat(e.target.value))}
                  className="w-full mt-2 accent-blue-500"
                />
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
