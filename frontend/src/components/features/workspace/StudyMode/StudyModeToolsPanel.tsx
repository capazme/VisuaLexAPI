import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Pin, PinOff, StickyNote, Highlighter, X, Send } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { Annotation, Highlight } from '../../../../types';
import type { StudyModeTheme } from './StudyMode';

interface StudyModeToolsPanelProps {
  visible: boolean;
  isPinned: boolean;
  onTogglePin: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  annotations: Annotation[];
  highlights: Highlight[];
  normaKey: string;
  articleId: string;
  onAddAnnotation: (normaKey: string, articleId: string, text: string) => void;
  onRemoveAnnotation: (id: string) => void;
  onRemoveHighlight: (id: string) => void;
  focusNoteInput: boolean;
  onNoteInputFocused: () => void;
  theme: StudyModeTheme;
}

type Tab = 'notes' | 'highlights';

const HIGHLIGHT_COLORS: Record<string, { bg: string; text: string }> = {
  yellow: { bg: 'bg-yellow-100', text: 'text-yellow-800' },
  green: { bg: 'bg-green-100', text: 'text-green-800' },
  red: { bg: 'bg-red-100', text: 'text-red-800' },
  blue: { bg: 'bg-blue-100', text: 'text-blue-800' },
};

const THEME_PANEL_STYLES: Record<StudyModeTheme, {
  bg: string;
  border: string;
  tab: string;
  tabActive: string;
  input: string;
  card: string;
  text: string;
  muted: string;
}> = {
  light: {
    bg: 'bg-white',
    border: 'border-gray-200',
    tab: 'text-gray-500 hover:text-gray-700',
    tabActive: 'text-blue-600 border-blue-600',
    input: 'bg-gray-50 border-gray-200 focus:border-blue-500',
    card: 'bg-gray-50 hover:bg-gray-100',
    text: 'text-gray-900',
    muted: 'text-gray-500'
  },
  dark: {
    bg: 'bg-gray-800',
    border: 'border-gray-700',
    tab: 'text-gray-400 hover:text-gray-200',
    tabActive: 'text-blue-400 border-blue-400',
    input: 'bg-gray-900 border-gray-700 focus:border-blue-500',
    card: 'bg-gray-700 hover:bg-gray-600',
    text: 'text-gray-100',
    muted: 'text-gray-400'
  },
  sepia: {
    bg: 'bg-[#f4ecd8]',
    border: 'border-[#d4c4a8]',
    tab: 'text-[#8b7355] hover:text-[#5c4b37]',
    tabActive: 'text-[#5c4b37] border-[#5c4b37]',
    input: 'bg-[#efe5d1] border-[#d4c4a8] focus:border-[#8b7355]',
    card: 'bg-[#efe5d1] hover:bg-[#e4d4b8]',
    text: 'text-[#5c4b37]',
    muted: 'text-[#8b7355]'
  }
};

export function StudyModeToolsPanel({
  visible,
  isPinned,
  onTogglePin,
  onMouseEnter,
  onMouseLeave,
  annotations,
  highlights,
  normaKey,
  articleId,
  onAddAnnotation,
  onRemoveAnnotation,
  onRemoveHighlight,
  focusNoteInput,
  onNoteInputFocused,
  theme
}: StudyModeToolsPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('notes');
  const [noteText, setNoteText] = useState('');
  const noteInputRef = useRef<HTMLTextAreaElement>(null);
  const styles = THEME_PANEL_STYLES[theme];

  // Focus note input when requested
  useEffect(() => {
    if (focusNoteInput && noteInputRef.current) {
      setActiveTab('notes');
      noteInputRef.current.focus();
      onNoteInputFocused();
    }
  }, [focusNoteInput, onNoteInputFocused]);

  const handleAddNote = () => {
    if (!noteText.trim()) return;
    onAddAnnotation(normaKey, articleId, noteText.trim());
    setNoteText('');
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.aside
          initial={{ x: '-100%', opacity: 0.8 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '-100%', opacity: 0.8 }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          className={cn(
            "absolute left-0 top-0 bottom-0 w-80 z-10 flex flex-col border-r shadow-xl",
            styles.bg,
            styles.border
          )}
        >
          {/* Header */}
          <div className={cn("flex items-center justify-between px-4 py-3 border-b", styles.border)}>
            <h3 className={cn("font-semibold", styles.text)}>Strumenti</h3>
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

          {/* Tabs */}
          <div className={cn("flex border-b", styles.border)}>
            <button
              onClick={() => setActiveTab('notes')}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                activeTab === 'notes' ? styles.tabActive : cn(styles.tab, 'border-transparent')
              )}
            >
              <StickyNote size={16} />
              Note
              {annotations.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">
                  {annotations.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('highlights')}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                activeTab === 'highlights' ? styles.tabActive : cn(styles.tab, 'border-transparent')
              )}
            >
              <Highlighter size={16} />
              Evidenziazioni
              {highlights.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700 rounded-full">
                  {highlights.length}
                </span>
              )}
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === 'notes' ? (
              <div className="space-y-3">
                {annotations.length === 0 ? (
                  <p className={cn("text-sm text-center py-4", styles.muted)}>
                    Nessuna nota per questo articolo.
                    <br />
                    <span className="text-xs">Seleziona del testo o usa il campo sotto.</span>
                  </p>
                ) : (
                  annotations.map(note => (
                    <div
                      key={note.id}
                      className={cn("group relative p-3 rounded-lg transition-colors", styles.card)}
                    >
                      <p className={cn("text-sm whitespace-pre-wrap pr-6", styles.text)}>
                        {note.text}
                      </p>
                      <p className={cn("text-xs mt-2", styles.muted)}>
                        {new Date(note.createdAt).toLocaleDateString()}
                      </p>
                      <button
                        onClick={() => onRemoveAnnotation(note.id)}
                        className="absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-100 hover:text-red-600 transition-all"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {highlights.length === 0 ? (
                  <p className={cn("text-sm text-center py-4", styles.muted)}>
                    Nessuna evidenziazione.
                    <br />
                    <span className="text-xs">Seleziona del testo per evidenziarlo.</span>
                  </p>
                ) : (
                  highlights.map(h => {
                    const colorStyle = HIGHLIGHT_COLORS[h.color] || HIGHLIGHT_COLORS.yellow;
                    return (
                      <div
                        key={h.id}
                        className={cn("group relative p-3 rounded-lg transition-colors", styles.card)}
                      >
                        <div className={cn(
                          "inline-block px-2 py-1 rounded text-sm mb-2",
                          colorStyle.bg,
                          colorStyle.text
                        )}>
                          {h.text.substring(0, 100)}
                          {h.text.length > 100 && '...'}
                        </div>
                        <button
                          onClick={() => onRemoveHighlight(h.id)}
                          className="absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-100 hover:text-red-600 transition-all"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Add Note Input (only in notes tab) */}
          {activeTab === 'notes' && (
            <div className={cn("p-4 border-t", styles.border)}>
              <div className="flex gap-2">
                <textarea
                  ref={noteInputRef}
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      handleAddNote();
                    }
                  }}
                  placeholder="Scrivi una nota..."
                  className={cn(
                    "flex-1 text-sm rounded-lg border px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500",
                    styles.input,
                    styles.text
                  )}
                  rows={2}
                />
                <button
                  onClick={handleAddNote}
                  disabled={!noteText.trim()}
                  className="self-end p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Send size={16} />
                </button>
              </div>
              <p className={cn("text-xs mt-1", styles.muted)}>
                Premi ⌘+Enter per salvare
              </p>
            </div>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
