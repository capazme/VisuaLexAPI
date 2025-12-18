import { motion, AnimatePresence } from 'framer-motion';
import { Pin, PinOff, ExternalLink, Lightbulb, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../../../lib/utils';
import { SafeHTML } from '../../../../utils/sanitize';
import type { BrocardiInfo, MassimaStructured, Footnote } from '../../../../types';
import type { StudyModeTheme } from './StudyMode';

interface StudyModeBrocardiPanelProps {
  visible: boolean;
  isPinned: boolean;
  onTogglePin: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  brocardiInfo?: BrocardiInfo;
  theme: StudyModeTheme;
}

const THEME_PANEL_STYLES: Record<StudyModeTheme, {
  bg: string;
  border: string;
  section: string;
  sectionHover: string;
  text: string;
  muted: string;
}> = {
  light: {
    bg: 'bg-white',
    border: 'border-gray-200',
    section: 'bg-gray-50',
    sectionHover: 'hover:bg-gray-100',
    text: 'text-gray-900',
    muted: 'text-gray-500'
  },
  dark: {
    bg: 'bg-gray-800',
    border: 'border-gray-700',
    section: 'bg-gray-700',
    sectionHover: 'hover:bg-gray-600',
    text: 'text-gray-100',
    muted: 'text-gray-400'
  },
  sepia: {
    bg: 'bg-[#f4ecd8]',
    border: 'border-[#d4c4a8]',
    section: 'bg-[#efe5d1]',
    sectionHover: 'hover:bg-[#e4d4b8]',
    text: 'text-[#5c4b37]',
    muted: 'text-[#8b7355]'
  }
};

interface SectionProps {
  title: string;
  content: string | string[] | (string | MassimaStructured)[] | null;
  theme: StudyModeTheme;
}

function BrocardiSection({ title, content, theme }: SectionProps) {
  const [isOpen, setIsOpen] = useState(true);
  const styles = THEME_PANEL_STYLES[theme];

  if (!content || (Array.isArray(content) && content.length === 0)) return null;

  // Handle Massime specially - convert to string array
  let validContent: string | string[];
  if (Array.isArray(content)) {
    validContent = content
      .map(item => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'massima' in item) return item.massima;
        return '';
      })
      .filter(item => item && item.replace(/<[^>]*>/g, '').trim().length > 0);

    if (validContent.length === 0) return null;
  } else {
    validContent = content;
  }

  return (
    <div className={cn("rounded-lg border overflow-hidden", styles.border)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full flex items-center justify-between px-4 py-2 transition-colors text-left",
          styles.section,
          styles.sectionHover
        )}
      >
        <span className={cn("text-xs font-bold uppercase flex items-center gap-2", styles.muted)}>
          <Lightbulb size={14} className="text-blue-500" />
          {title}
          {Array.isArray(validContent) && (
            <span className="text-xs font-normal">({validContent.length})</span>
          )}
        </span>
        <ChevronDown
          size={14}
          className={cn("transition-transform", styles.muted, isOpen && "rotate-180")}
        />
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className={cn("p-4 text-sm", styles.text)}>
              {title === 'Massime' && Array.isArray(validContent) ? (
                <div className="space-y-3">
                  {validContent.map((item, idx) => (
                    <div key={`study-massima-${idx}`} className="flex gap-3">
                      <span className={cn(
                        "shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-xs font-medium",
                        styles.section,
                        styles.muted
                      )}>
                        {idx + 1}
                      </span>
                      <SafeHTML
                        html={item}
                        className="prose prose-sm max-w-none"
                      />
                    </div>
                  ))}
                </div>
              ) : Array.isArray(validContent) ? (
                <ul className="space-y-2">
                  {validContent.map((item, idx) => (
                    <li key={`study-item-${idx}`}>{item}</li>
                  ))}
                </ul>
              ) : (
                <SafeHTML
                  html={validContent as string}
                  className="prose prose-sm max-w-none"
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface FootnotesSectionProps {
  footnotes: Footnote[];
  theme: StudyModeTheme;
}

function FootnotesSection({ footnotes, theme }: FootnotesSectionProps) {
  const [isOpen, setIsOpen] = useState(true);
  const styles = THEME_PANEL_STYLES[theme];

  if (!footnotes || footnotes.length === 0) return null;

  return (
    <div className={cn("rounded-lg border overflow-hidden", styles.border)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full flex items-center justify-between px-4 py-2 transition-colors text-left",
          styles.section,
          styles.sectionHover
        )}
      >
        <span className={cn("text-xs font-bold uppercase flex items-center gap-2", styles.muted)}>
          <Lightbulb size={14} className="text-amber-500" />
          Note al Dispositivo
          <span className="text-xs font-normal">({footnotes.length})</span>
        </span>
        <ChevronDown
          size={14}
          className={cn("transition-transform", styles.muted, isOpen && "rotate-180")}
        />
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className={cn("p-4 text-sm space-y-3", styles.text)}>
              {footnotes.map((footnote) => (
                <div key={`study-footnote-${footnote.numero}`} className="flex gap-3">
                  <span className={cn(
                    "shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold",
                    "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                  )}>
                    {footnote.numero}
                  </span>
                  <p className="flex-1 leading-relaxed">{footnote.testo}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function StudyModeBrocardiPanel({
  visible,
  isPinned,
  onTogglePin,
  onMouseEnter,
  onMouseLeave,
  brocardiInfo,
  theme
}: StudyModeBrocardiPanelProps) {
  const styles = THEME_PANEL_STYLES[theme];

  const hasContent = brocardiInfo && (
    brocardiInfo.Brocardi ||
    brocardiInfo.Ratio ||
    brocardiInfo.Spiegazione ||
    (brocardiInfo.Massime && brocardiInfo.Massime.length > 0) ||
    (brocardiInfo.Footnotes && brocardiInfo.Footnotes.length > 0)
  );

  return (
    <AnimatePresence>
      {visible && (
        <motion.aside
          initial={{ y: '100%', opacity: 0.8 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0.8 }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          className={cn(
            // Base styles
            "absolute z-10 flex flex-col shadow-xl",
            // Mobile: bottom sheet style
            "inset-x-0 bottom-0 top-auto h-[60vh] rounded-t-xl border-t",
            // Desktop: side panel style
            "sm:right-0 sm:top-0 sm:bottom-0 sm:left-auto sm:h-auto sm:w-96 sm:rounded-none sm:border-t-0 sm:border-l",
            styles.bg,
            styles.border
          )}
        >
          {/* Header */}
          <div className={cn("flex items-center justify-between px-4 py-3 border-b", styles.border)}>
            <h3 className={cn("font-semibold flex items-center gap-2", styles.text)}>
              <Lightbulb size={18} className="text-blue-500" />
              Approfondimenti
            </h3>
            <button
              onClick={onTogglePin}
              className={cn(
                "p-1.5 rounded-lg transition-colors",
                isPinned ? 'text-blue-500' : styles.muted,
                'hover:bg-gray-100 dark:hover:bg-gray-700'
              )}
              title={isPinned ? 'Sblocca pannello' : 'Blocca pannello'}
            >
              {isPinned ? <Pin size={16} /> : <PinOff size={16} />}
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {hasContent ? (
              <>
                <BrocardiSection title="Brocardi" content={brocardiInfo.Brocardi} theme={theme} />
                <BrocardiSection title="Ratio" content={brocardiInfo.Ratio} theme={theme} />
                <BrocardiSection title="Spiegazione" content={brocardiInfo.Spiegazione} theme={theme} />
                <BrocardiSection title="Massime" content={brocardiInfo.Massime} theme={theme} />
                {brocardiInfo.Footnotes && brocardiInfo.Footnotes.length > 0 && (
                  <FootnotesSection footnotes={brocardiInfo.Footnotes} theme={theme} />
                )}

                {brocardiInfo.link && (
                  <a
                    href={brocardiInfo.link}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-2 text-sm text-blue-600 hover:text-blue-700 hover:underline py-2"
                  >
                    <ExternalLink size={14} />
                    Vedi fonte su Brocardi.it
                  </a>
                )}
              </>
            ) : (
              <div className={cn("text-center py-8", styles.muted)}>
                <Lightbulb size={32} className="mx-auto mb-3 opacity-50" />
                <p className="text-sm">Nessun approfondimento disponibile per questo articolo.</p>
              </div>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
