import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../../../lib/utils';
import { STUDY_MODE_SHORTCUTS } from './hooks/useStudyModeShortcuts';
import type { StudyModeTheme } from './StudyMode';

interface StudyModeFooterProps {
  visible: boolean;
  theme: StudyModeTheme;
}

const THEME_FOOTER_STYLES: Record<StudyModeTheme, { bg: string; border: string; kbd: string; text: string }> = {
  light: {
    bg: 'bg-white/95 backdrop-blur-sm',
    border: 'border-slate-200',
    kbd: 'bg-slate-100 text-slate-600 border border-slate-200 shadow-sm',
    text: 'text-slate-500'
  },
  dark: {
    bg: 'bg-slate-900/95 backdrop-blur-sm',
    border: 'border-slate-700',
    kbd: 'bg-slate-800 text-slate-300 border border-slate-700',
    text: 'text-slate-400'
  },
  sepia: {
    bg: 'bg-[#f4ecd8]/95 backdrop-blur-sm',
    border: 'border-[#d4c4a8]',
    kbd: 'bg-[#e4d4b8] text-[#5c4b37] border border-[#d4c4a8]',
    text: 'text-[#8b7355]'
  }
};

export function StudyModeFooter({ visible, theme }: StudyModeFooterProps) {
  const styles = THEME_FOOTER_STYLES[theme];

  return (
    <AnimatePresence>
      {visible && (
        <motion.footer
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className={cn(
            "absolute bottom-0 left-0 right-0 z-20 border-t",
            styles.bg,
            styles.border
          )}
        >
          <div className="flex items-center justify-center gap-6 px-4 py-2">
            {STUDY_MODE_SHORTCUTS.map(({ key, label }) => (
              <span key={key} className={cn("text-xs flex items-center gap-1.5 font-medium", styles.text)}>
                <kbd className={cn(
                  "px-1.5 py-0.5 rounded font-mono text-[10px]",
                  styles.kbd
                )}>
                  {key}
                </kbd>
                {label}
              </span>
            ))}
          </div>
        </motion.footer>
      )}
    </AnimatePresence>
  );
}
