import type { RefObject } from 'react';
import type { Highlight } from '../../../types';
import { Highlighter, X } from 'lucide-react';
import { SafeHTML } from '../../../utils/sanitize';
import { SelectionPopup } from './SelectionPopup';
import { HIGHLIGHT_STYLES, parseInlineStyle } from '../../../utils/highlightColors';

export interface ArticleBodyProps {
    contentRef: RefObject<HTMLDivElement | null>;
    itemKey: string;
    processedContent: string;
    panelHighlights: Highlight[];
    onPopupHighlight: (text: string, color: 'yellow' | 'green' | 'red' | 'blue', startOffset: number) => void;
    onPopupAddNote: (text: string, startOffset: number) => void;
    onPopupCopy: (text: string) => Promise<void> | void;
    onRemoveHighlight: (id: string) => void;
}

export function ArticleBody({
    contentRef,
    itemKey,
    processedContent,
    panelHighlights,
    onPopupHighlight,
    onPopupAddNote,
    onPopupCopy,
    onRemoveHighlight,
}: ArticleBodyProps) {
    return (
        <>
            {/* Article Content with Prose Styling */}
            <div className="relative group/content" ref={contentRef}>
                <SelectionPopup
                    containerRef={contentRef}
                    onHighlight={onPopupHighlight}
                    onAddNote={onPopupAddNote}
                    onCopy={onPopupCopy}
                />
                <div className="prose prose-lg dark:prose-invert max-w-none legal-prose prose-slate prose-headings:font-bold font-serif px-2 sm:px-4" id={`article-content-${itemKey}`}>
                    {processedContent ? (
                        <SafeHTML html={processedContent} />
                    ) : (
                        <div className="text-slate-400 italic text-center py-8 flex flex-col items-center gap-2">
                            <div className="w-4 h-4 rounded-full border-2 border-slate-300 border-t-primary-500 animate-spin" />
                            Caricamento testo...
                        </div>
                    )}
                </div>
            </div>

            {/* Desktop only: Highlights summary panel (study feature) */}
            {panelHighlights.length > 0 && (
                <div className="hidden md:block mt-8 mb-6 bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3 border border-slate-200 dark:border-slate-700 text-sm">
                    <h6 className="font-semibold text-slate-600 dark:text-slate-300 mb-2 flex items-center gap-2">
                        <Highlighter size={14} /> Evidenziazioni
                    </h6>
                    <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                        {panelHighlights.map(h => (
                            <div key={h.id} className="flex justify-between items-start gap-2 bg-white dark:bg-slate-900 p-2 rounded border border-slate-100 dark:border-slate-700">
                                <span style={{ ...parseInlineStyle(HIGHLIGHT_STYLES[h.color]) }} className="rounded px-2 py-1 flex-1 text-xs">{h.text}</span>
                                <button onClick={() => onRemoveHighlight(h.id)} className="text-slate-400 hover:text-red-500 p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors">
                                    <X size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}
