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
    border: 'border-slate-200',
    section: 'bg-slate-50',
    sectionHover: 'hover:bg-slate-100',
    text: 'text-slate-900',
    muted: 'text-slate-500'
  },
  dark: {
    bg: 'bg-slate-900',
    border: 'border-slate-700',
    section: 'bg-slate-800',
    sectionHover: 'hover:bg-slate-700',
    text: 'text-slate-100',
    muted: 'text-slate-400'
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
    <div className={cn("rounded-lg border overflow-hidden transition-colors", styles.border)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 transition-colors text-left",
          styles.section,
          styles.sectionHover
        )}
      >
        <span className={cn("text-xs font-semibold uppercase tracking-wide", styles.muted)}>
          {title}
          {Array.isArray(validContent) && (
            <span className="ml-1 opacity-60 font-normal">({validContent.length})</span>
          )}
        </span>
        <ChevronDown
          size={14}
          className={cn("transition-transform opacity-60", styles.muted, isOpen && "rotate-180")}
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
            <div className={cn("p-3 text-sm max-h-48 overflow-y-auto custom-scrollbar", styles.text)}>
              {title === 'Massime' && Array.isArray(validContent) ? (
                <div className="space-y-3">
                  {validContent.map((item, idx) => (
                    <div key={`popover-massima-${idx}`} className="flex gap-2 text-xs group">
                      <span className={cn(
                        "shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold mt-0.5 transition-colors",
                        theme === 'dark' ? "bg-slate-700 text-slate-300" : theme === 'sepia' ? "bg-[#d4c4a8] text-[#5c4b37]" : "bg-slate-100 text-slate-500 group-hover:bg-slate-200"
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
                <ul className="space-y-1.5 text-xs list-disc list-outside pl-4">
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
    <div className={cn("rounded-lg border overflow-hidden transition-colors", styles.border)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 transition-colors text-left",
          styles.section,
          styles.sectionHover
        )}
      >
        <span className={cn("text-xs font-semibold uppercase tracking-wide", styles.muted)}>
          Note
          <span className="ml-1 opacity-60 font-normal">({footnotes.length})</span>
        </span>
        <ChevronDown
          size={14}
          className={cn("transition-transform opacity-60", styles.muted, isOpen && "rotate-180")}
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
            <div className={cn("p-3 text-sm max-h-48 overflow-y-auto space-y-3 custom-scrollbar", styles.text)}>
              {footnotes.map((footnote) => (
                <div key={`popover-footnote-${footnote.numero}`} className="flex gap-2 text-xs">
                  <span className={cn(
                    "shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold mt-0.5",
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
            "absolute flex flex-col rounded-xl shadow-2xl border z-20 overflow-hidden",
            // Mobile: nearly full width, centered
            "left-4 right-4 top-auto bottom-4 max-h-[70vh]",
            // Desktop: fixed position and width
            "sm:left-auto sm:right-4 sm:top-14 sm:bottom-auto sm:w-80 sm:max-h-[calc(100vh-100px)]",
            styles.bg,
            styles.border
          )}
        >
          {/* Header */}
          <div className={cn("flex items-center justify-between px-3 py-2.5 border-b shrink-0", styles.border)}>
            <h3 className={cn("text-xs font-bold uppercase tracking-wide flex items-center gap-2", styles.text)}>
              <Lightbulb size={14} className="text-amber-500" />
              Approfondimenti
            </h3>
            <button
              onClick={onClose}
              className={cn(
                "p-1 rounded-md transition-colors",
                styles.muted,
                'hover:bg-slate-100 dark:hover:bg-slate-700'
              )}
            >
              <X size={16} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
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
                    className="flex items-center justify-center gap-1.5 text-xs text-primary-600 hover:text-primary-700 hover:underline py-3 mt-2 border-t border-dashed border-slate-200 dark:border-slate-700"
                  >
                    <ExternalLink size={12} />
                    Fonte Brocardi.it
                  </a>
                )}
              </>
            ) : (
              <div className={cn("text-center py-8 flex flex-col items-center gap-2", styles.muted)}>
                <Lightbulb size={24} className="opacity-30" />
                <p className="text-xs opacity-70">Nessun approfondimento disponibile.</p>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
