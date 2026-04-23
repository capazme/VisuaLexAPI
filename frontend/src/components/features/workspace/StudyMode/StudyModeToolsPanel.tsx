import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Pin, PinOff, StickyNote, Highlighter, X, Send, ListTree } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { Annotation, Highlight } from '../../../../types';
import type { StudyModeTheme } from './StudyMode';
import { HIGHLIGHT_STYLES, parseInlineStyle } from '../../../../utils/highlightColors';
import { StudyModeSummary } from './StudyModeSummary';

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
  onAddAnnotation: (
    normaKey: string,
    articleId: string,
    text: string,
    anchor?: { anchorText: string; startOffset: number },
  ) => void;
  onRemoveAnnotation: (id: string) => void;
  onRemoveHighlight: (id: string) => void;
  focusNoteInput: boolean;
  onNoteInputFocused: () => void;
  /**
   * When the user triggered "Aggiungi nota" from the article body, this
   * carries the selected span + its document-relative plain offset. The
   * panel surfaces it as a chip above the textarea so the user knows
   * the next note will be anchored, and passes it through on save.
   */
  noteAnchor: { anchorText: string; startOffset: number } | null;
  onClearNoteAnchor: () => void;
  theme: StudyModeTheme;
}

type Tab = 'summary' | 'notes' | 'highlights';

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
    border: 'border-slate-200',
    tab: 'text-slate-500 hover:text-slate-700',
    tabActive: 'text-primary-600 border-primary-600',
    input: 'bg-slate-50 border-slate-200 focus:border-primary-500',
    card: 'bg-slate-50 hover:bg-slate-100',
    text: 'text-slate-900',
    muted: 'text-slate-500'
  },
  dark: {
    bg: 'bg-slate-900',
    border: 'border-slate-700',
    tab: 'text-slate-400 hover:text-slate-200',
    tabActive: 'text-primary-400 border-primary-400',
    input: 'bg-slate-800 border-slate-700 focus:border-primary-500',
    card: 'bg-slate-800 hover:bg-slate-700',
    text: 'text-slate-100',
    muted: 'text-slate-400'
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
  noteAnchor,
  onClearNoteAnchor,
  theme
}: StudyModeToolsPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('summary');
  const [noteText, setNoteText] = useState('');
  const noteInputRef = useRef<HTMLTextAreaElement>(null);
  const styles = THEME_PANEL_STYLES[theme];

  // Summary → article-body navigation: find the marker in the DOM
  // (`[data-highlight=id]` for highlights, `[data-note-id=id]` for note
  // anchors — both emitted by useArticleMarkers) and scroll it into
  // view with a brief flash to orient the user. Scoped to the Study
  // Mode body element — the main article view mounts a DOM twin of
  // the same markers behind the backdrop, and an un-scoped query
  // would scroll that hidden copy instead.
  const handleSummaryNavigate = (kind: 'highlight' | 'note', id: string) => {
    const root = document.getElementById('study-mode-article-body');
    if (!root) return;
    const selector = kind === 'highlight'
      ? `[data-highlight="${CSS.escape(id)}"]`
      : `[data-note-id="${CSS.escape(id)}"]`;
    const el = root.querySelector(selector) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-primary-500/70', 'ring-offset-2', 'transition');
    setTimeout(() => {
      el.classList.remove('ring-2', 'ring-primary-500/70', 'ring-offset-2', 'transition');
    }, 1200);
  };

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
    onAddAnnotation(
      normaKey,
      articleId,
      noteText.trim(),
      noteAnchor ?? undefined,
    );
    setNoteText('');
    onClearNoteAnchor();
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
          style={{ touchAction: 'pan-y' }}
          className={cn(
            // Base styles
            "absolute z-10 flex flex-col shadow-xl",
            // Mobile: bottom sheet style. `overscroll-contain` stops the
            // content scroll from bubbling up to the article body (rubber
            // banding past the top of the notes list was pulling the
            // article under the sheet); `touch-action: pan-y` on the
            // inline style keeps touch panning handled by the sheet
            // itself.
            "inset-x-0 bottom-0 top-auto h-[60vh] rounded-t-xl border-t overscroll-contain",
            // Desktop: side panel style
            "sm:left-0 sm:top-0 sm:bottom-0 sm:right-auto sm:h-auto sm:w-80 sm:rounded-none sm:border-t-0 sm:border-r",
            styles.bg,
            styles.border
          )}
        >
          {/* Header */}
          <div className={cn("flex items-center justify-between px-4 py-3 border-b", styles.border)}>
            <h3 className={cn("font-semibold text-sm uppercase tracking-wide", styles.text)}>Strumenti</h3>
            <button
              onClick={onTogglePin}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                isPinned ? 'text-primary-500 bg-primary-50 dark:bg-primary-900/30' : styles.muted,
                'hover:bg-slate-100 dark:hover:bg-slate-700'
              )}
              title={isPinned ? 'Sblocca pannello' : 'Blocca pannello'}
            >
              {isPinned ? <Pin size={16} /> : <PinOff size={16} />}
            </button>
          </div>

          {/* Tabs */}
          <div className={cn("flex border-b", styles.border)}>
            <button
              onClick={() => setActiveTab('summary')}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors",
                activeTab === 'summary' ? styles.tabActive : cn(styles.tab, 'border-transparent')
              )}
              title="Riepilogo: note ed evidenziazioni in ordine di lettura"
            >
              <ListTree size={16} />
              Riepilogo
              {(annotations.length + highlights.length) > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 text-xs bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300 rounded-full">
                  {annotations.length + highlights.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('notes')}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors",
                activeTab === 'notes' ? styles.tabActive : cn(styles.tab, 'border-transparent')
              )}
            >
              <StickyNote size={16} />
              Note
              {annotations.length > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 text-xs bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300 rounded-full">
                  {annotations.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('highlights')}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors",
                activeTab === 'highlights' ? styles.tabActive : cn(styles.tab, 'border-transparent')
              )}
            >
              <Highlighter size={16} />
              Evidenz.
              {highlights.length > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300 rounded-full">
                  {highlights.length}
                </span>
              )}
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            {activeTab === 'summary' ? (
              <StudyModeSummary
                highlights={highlights}
                annotations={annotations}
                theme={theme}
                onNavigate={handleSummaryNavigate}
              />
            ) : activeTab === 'notes' ? (
              <div className="space-y-3">
                {annotations.length === 0 ? (
                  <div className={cn("text-sm text-center py-8 flex flex-col items-center gap-2", styles.muted)}>
                    <StickyNote size={24} className="opacity-30" />
                    <div>
                      Nessuna nota per questo articolo.
                      <br />
                      <span className="text-xs opacity-70">Seleziona del testo o usa il campo sotto.</span>
                    </div>
                  </div>
                ) : (
                  annotations.map(note => (
                    <div
                      key={note.id}
                      className={cn("group relative p-3 rounded-lg transition-colors border border-transparent hover:border-slate-200 dark:hover:border-slate-700", styles.card)}
                    >
                      {note.anchorText && (
                        <div className="text-xs italic text-amber-700 dark:text-amber-400 mb-1.5 flex items-start gap-1.5 pr-6">
                          <StickyNote size={11} className="mt-0.5 shrink-0" />
                          <span className="line-clamp-2">&ldquo;{note.anchorText}&rdquo;</span>
                        </div>
                      )}
                      <p className={cn("text-sm whitespace-pre-wrap pr-6 leading-relaxed", styles.text)}>
                        {note.text}
                      </p>
                      <p className={cn("text-[10px] mt-2 font-medium opacity-60", styles.muted)}>
                        {new Date(note.createdAt).toLocaleString()}
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
                  <div className={cn("text-sm text-center py-8 flex flex-col items-center gap-2", styles.muted)}>
                    <Highlighter size={24} className="opacity-30" />
                    <div>
                      Nessuna evidenziazione.
                      <br />
                      <span className="text-xs opacity-70">Seleziona del testo per evidenziarlo.</span>
                    </div>
                  </div>
                ) : (
                  highlights.map(h => {
                    const colorStyle = parseInlineStyle(HIGHLIGHT_STYLES[h.color] ?? HIGHLIGHT_STYLES.yellow);
                    return (
                      <div
                        key={h.id}
                        className={cn("group relative p-2.5 pr-8 rounded-lg transition-colors border border-transparent hover:border-slate-200 dark:hover:border-slate-700", styles.card)}
                      >
                        <p className="text-sm leading-snug">
                          <span
                            style={colorStyle}
                            className="rounded-sm px-1 py-0.5 break-words box-decoration-clone"
                          >
                            {h.text}
                          </span>
                        </p>
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
              {noteAnchor && (
                <div className={cn(
                  "mb-2 flex items-start gap-2 px-2.5 py-1.5 rounded-md border text-xs",
                  "bg-amber-50 border-amber-200 text-amber-900",
                  "dark:bg-amber-900/20 dark:border-amber-900/40 dark:text-amber-200"
                )}>
                  <span className="font-semibold shrink-0">Ancorata a:</span>
                  <span className="flex-1 italic line-clamp-2">"{noteAnchor.anchorText}"</span>
                  <button
                    onClick={onClearNoteAnchor}
                    className="shrink-0 p-0.5 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                    title="Rimuovi ancora"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
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
                  placeholder={noteAnchor ? "Scrivi una nota sullo span selezionato..." : "Scrivi una nota..."}
                  className={cn(
                    "flex-1 text-sm rounded-lg border px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500/50 transition-shadow",
                    styles.input,
                    styles.text
                  )}
                  rows={2}
                />
                <button
                  onClick={handleAddNote}
                  disabled={!noteText.trim()}
                  className="self-end p-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  <Send size={16} />
                </button>
              </div>
              <p className={cn("text-[10px] mt-1.5 text-right opacity-70", styles.muted)}>
                Premi ⌘+Enter per salvare
              </p>
            </div>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
