import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ExternalLink, Lightbulb, ChevronDown } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { SafeHTML } from '../../../../utils/sanitize';
import type { BrocardiInfo, MassimaStructured, Footnote } from '../../../../types';
import type { StudyModeTheme } from './StudyMode';

interface StudyModeBrocardiPopoverProps {
  visible: boolean;
  onClose: () => void;
  brocardiInfo?: BrocardiInfo;
  theme: StudyModeTheme;
}

const THEME_STYLES: Record<StudyModeTheme, {
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
  defaultOpen?: boolean;
}

function BrocardiSection({ title, content, theme, defaultOpen = false }: SectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const styles = THEME_STYLES[theme];

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
          "w-full flex items-center justify-between px-3 py-2 transition-colors text-left",
          styles.section,
          styles.sectionHover
        )}
      >
        <span className={cn("text-xs font-medium", styles.muted)}>
          {title}
          {Array.isArray(validContent) && (
            <span className="ml-1 opacity-60">({validContent.length})</span>
          )}
        </span>
        <ChevronDown
          size={12}
          className={cn("transition-transform", styles.muted, isOpen && "rotate-180")}
        />
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className={cn("p-3 text-sm max-h-48 overflow-y-auto", styles.text)}>
              {title === 'Massime' && Array.isArray(validContent) ? (
                <div className="space-y-2">
                  {validContent.map((item, idx) => (
                    <div key={`popover-massima-${idx}`} className="flex gap-2 text-xs">
                      <span className={cn(
                        "shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-xs",
                        styles.section,
                        styles.muted
                      )}>
                        {idx + 1}
                      </span>
                      <SafeHTML
                        html={item}
                        className="prose prose-sm max-w-none leading-relaxed"
                      />
                    </div>
                  ))}
                </div>
              ) : Array.isArray(validContent) ? (
                <ul className="space-y-1 text-xs">
                  {validContent.map((item, idx) => (
                    <li key={`popover-item-${idx}`}>{item}</li>
                  ))}
                </ul>
              ) : (
                <SafeHTML
                  html={validContent as string}
                  className="prose prose-sm max-w-none text-xs leading-relaxed"
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
  const [isOpen, setIsOpen] = useState(false);
  const styles = THEME_STYLES[theme];

  if (!footnotes || footnotes.length === 0) return null;

  return (
    <div className={cn("rounded-lg border overflow-hidden", styles.border)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 transition-colors text-left",
          styles.section,
          styles.sectionHover
        )}
      >
        <span className={cn("text-xs font-medium", styles.muted)}>
          Note al Dispositivo
          <span className="ml-1 opacity-60">({footnotes.length})</span>
        </span>
        <ChevronDown
          size={12}
          className={cn("transition-transform", styles.muted, isOpen && "rotate-180")}
        />
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className={cn("p-3 text-sm max-h-48 overflow-y-auto space-y-2", styles.text)}>
              {footnotes.map((footnote) => (
                <div key={`popover-footnote-${footnote.numero}`} className="flex gap-2 text-xs">
                  <span className={cn(
                    "shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold",
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

export function StudyModeBrocardiPopover({
  visible,
  onClose,
  brocardiInfo,
  theme
}: StudyModeBrocardiPopoverProps) {
  const styles = THEME_STYLES[theme];

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
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.15 }}
          className={cn(
            // Base styles
            "absolute flex flex-col rounded-lg shadow-xl border z-20",
            // Mobile: nearly full width, centered
            "left-4 right-4 top-auto bottom-4 max-h-[70vh]",
            // Desktop: fixed position and width
            "sm:left-auto sm:right-4 sm:top-4 sm:bottom-auto sm:w-80",
            styles.bg,
            styles.border
          )}
        >
          {/* Header */}
          <div className={cn("flex items-center justify-between px-3 py-2 border-b", styles.border)}>
            <h3 className={cn("text-sm font-medium flex items-center gap-2", styles.text)}>
              <Lightbulb size={14} className="text-amber-500" />
              Approfondimenti
            </h3>
            <button
              onClick={onClose}
              className={cn(
                "p-1 rounded transition-colors",
                styles.muted,
                'hover:bg-gray-100 dark:hover:bg-gray-700'
              )}
            >
              <X size={14} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {hasContent ? (
              <>
                <BrocardiSection title="Brocardi" content={brocardiInfo.Brocardi} theme={theme} defaultOpen />
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
                    className="flex items-center justify-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 hover:underline py-2"
                  >
                    <ExternalLink size={12} />
                    Fonte Brocardi.it
                  </a>
                )}
              </>
            ) : (
              <div className={cn("text-center py-6", styles.muted)}>
                <Lightbulb size={24} className="mx-auto mb-2 opacity-50" />
                <p className="text-xs">Nessun approfondimento disponibile.</p>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
