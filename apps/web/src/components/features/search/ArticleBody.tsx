import { useRef, type RefObject } from 'react';
import { SafeHTML } from '../../../utils/sanitize';
import { cn } from '../../../lib/utils';
import { SelectionPopup } from './SelectionPopup';

export interface ArticleBodyProps {
    contentRef: RefObject<HTMLDivElement | null>;
    itemKey: string;
    processedContent: string;
    onPopupHighlight: (text: string, color: 'yellow' | 'green' | 'red' | 'blue', startOffset: number) => void;
    onPopupAddNote: (text: string, startOffset: number, rect: { x: number; y: number; width: number; height: number }) => void;
    onPopupCopy: (text: string) => Promise<void> | void;
    /** Optional "Discuti" action on selected passage. */
    onPopupDiscuss?: (text: string, startOffset: number) => void;
    /** Optional "Segnala come citazione" action; the popup hides it when absent. */
    onPopupReportCitation?: (text: string, startOffset: number, rect: { x: number; y: number; width: number; height: number }) => void;
    /** Unfolds the AGGIORNAMENTO notes at the bottom of the text (useArticleTextInteractions). */
    updatesOpen?: boolean;
    /** A past text: the selection popup offers only "Copia" (see SelectionPopup). */
    copyOnly?: boolean;
    /** The classes of the text root (typography and structure): `vlx-art` for an article. */
    className?: string;
    /** Receives the text root (without the selection popup), for «Cerca nel testo». */
    textRootRef?: RefObject<HTMLDivElement | null>;
}

export function ArticleBody({
    contentRef,
    itemKey,
    processedContent,
    onPopupHighlight,
    onPopupAddNote,
    onPopupCopy,
    onPopupDiscuss,
    onPopupReportCitation,
    updatesOpen = false,
    copyOnly = false,
    className = 'vlx-art',
    textRootRef,
}: ArticleBodyProps) {
    // The text alone, without the selection popup: stored offsets are measured
    // from here (see SelectionPopup's textRootRef).
    const ownTextRef = useRef<HTMLDivElement>(null);
    const textRef = textRootRef ?? ownTextRef;
    // Article text — typography and structure from `.vlx-art` (index.css, READING SURFACE)
    return (
        <div className="relative group/content" ref={contentRef}>
            <SelectionPopup
                containerRef={contentRef}
                textRootRef={textRef}
                onHighlight={onPopupHighlight}
                onAddNote={onPopupAddNote}
                onCopy={onPopupCopy}
                onDiscuss={onPopupDiscuss}
                onReportCitation={onPopupReportCitation}
                copyOnly={copyOnly}
            />
            {/* A size container: with room beside the 68ch column, each
                block's annotation sign moves to the right margin (index.css). */}
            <div className="vlx-frame">
                <div ref={textRef} className={cn(className, 'px-2 sm:px-4', updatesOpen && 'vlx-updates-open')} id={`article-content-${itemKey}`}>
                    {processedContent && <SafeHTML html={processedContent} />}
                </div>
                {/* Outside the text root: the placeholder is not text of the article, so a search never finds it. */}
                {!processedContent && (
                    <div className="text-slate-400 italic text-center py-8 flex flex-col items-center gap-2">
                        <div className="w-4 h-4 rounded-full border-2 border-slate-300 border-t-primary-500 animate-spin" />
                        Caricamento testo...
                    </div>
                )}
            </div>
        </div>
    );
}
