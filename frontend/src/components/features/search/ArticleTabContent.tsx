import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import type { ArticleData, SearchParams } from '../../../types';
import { BrocardiDisplay } from './BrocardiDisplay';
import { SelectionPopup } from './SelectionPopup';
import { ExternalLink, Zap, FolderPlus, Copy, StickyNote, Highlighter, Share2, Download, X, MoreHorizontal, Clock, BookOpen, GitCompare } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { cn } from '../../../lib/utils';
import { DossierModal } from '../../ui/DossierModal';
import { Toast } from '../../ui/Toast';
import { CopyModal, type CopyOptions } from '../../ui/CopyModal';
import { AdvancedExportModal } from '../../ui/AdvancedExportModal';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { SafeHTML } from '../../../utils/sanitize';
import { CitationPreviewPopup } from '../../ui/CitationPreviewPopup';
import { useCitationPreview } from '../../../hooks/useCitationPreview';
import { wrapCitationsInHtml, deserializeCitation, type ParsedCitationData } from '../../../utils/citationMatcher';
import { openCompareWithArticle, getCompareState } from '../../../hooks/useCompare';
import { useArticleMarkers } from '../../../hooks/useArticleMarkers';
import { HIGHLIGHT_STYLES, parseInlineStyle } from '../../../utils/highlightColors';
import { Z_INDEX } from '../../../constants/zIndex';
import { getPlainTextOffset, getSelectionPlainOffset } from '../../../utils/selectionOffset';

interface ArticleTabContentProps {
    data: ArticleData;
    onCrossReferenceNavigate?: (articleNumber: string, normaData: ArticleData['norma_data']) => void;
    onOpenStudyMode?: () => void;
}

const DICTIONARY_TERMS: Record<string, string> = {
    'ratio legis': 'Motivazione giuridica alla base della norma.',
    'ultra vires': 'Atto compiuto oltre i poteri conferiti.',
    'erga omnes': 'Efficace nei confronti di tutti.',
    'ex tunc': 'Con effetti retroattivi.',
    'ex nunc': 'Con effetti solo per il futuro.',
};

export function ArticleTabContent({ data, onCrossReferenceNavigate, onOpenStudyMode }: ArticleTabContentProps) {
    const { article_text, norma_data, brocardi_info, url, versionInfo } = data;
    const {
        annotations,
        addAnnotation,
        removeAnnotation,
        loadAnnotationsForArticle,
        highlights,
        addHighlight,
        removeHighlight,
        loadHighlightsForArticle,
        triggerSearch,
        addQuickNorm,
    } = useAppStore();

    const [showDossierModal, setShowDossierModal] = useState(false);
    const [showNotes, setShowNotes] = useState(false);
    const [noteText, setNoteText] = useState('');
    const [showMoreMenu, setShowMoreMenu] = useState(false);
    const [showCopyModal, setShowCopyModal] = useState(false);
    const [showAdvancedExport, setShowAdvancedExport] = useState(false);
    const [showVersionInput, setShowVersionInput] = useState(false);
    const [versionDate, setVersionDate] = useState('');
    const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
    const [showHighlightPicker, setShowHighlightPicker] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);
    // Tracks the last valid text selection inside the article body so the
    // toolbar highlight button can apply a highlight even after the user
    // moves focus away (selection may be cleared by the click).
    const highlightSelectionRef = useRef<{ text: string; startOffset: number } | null>(null);
    // When the user picks "Aggiungi nota" from the selection popup the
    // selected span becomes the note's anchor. Kept in state so the panel
    // can render a chip ("Ancorata a: …") until the user submits.
    // scopedArticleId defaults to the article body; markable brocardi
    // sections override it to target their own sub-section scope.
    const [noteAnchor, setNoteAnchor] = useState<{ anchorText: string; startOffset: number; scopedArticleId: string } | null>(null);
    const versionDateInputRef = useRef<HTMLInputElement>(null);

    // Citation preview hook - destructure to get stable function references
    const citationPreviewState = useCitationPreview();
    const { showPreview, hidePreview } = citationPreviewState;
    const isHoveringPopupRef = useRef(false);

    const generateKey = () => {
        const sanitize = (str: string) => str.replace(/\s+/g, '-').replace(/[^\w-]/g, '').toLowerCase();
        const parts = [norma_data.tipo_atto];
        if (norma_data.numero_atto?.trim()) parts.push(norma_data.numero_atto);
        if (norma_data.data?.trim()) parts.push(norma_data.data);
        if (norma_data.allegato?.trim()) parts.push(`all${norma_data.allegato}`);
        if (norma_data.numero_articolo?.trim()) parts.push(norma_data.numero_articolo);
        return parts.map(part => sanitize(part || '')).join('--');
    };

    const itemKey = generateKey();
    const uniqueArticleId = norma_data.allegato ? `all${norma_data.allegato}:${norma_data.numero_articolo}` : norma_data.numero_articolo;

    // Markers pipeline for the article body uses ONLY strict scope.
    const itemAnnotations = annotations.filter(a => a.normaKey === itemKey && a.articleId === uniqueArticleId);
    const articleHighlights = highlights.filter(h => h.normaKey === itemKey && h.articleId === uniqueArticleId);

    // Panel list (notes + highlights summary) includes brocardi sub-sections
    // so users see everything they've saved for this article in one place.
    const subSectionPrefix = `${uniqueArticleId}/`;
    const allPanelAnnotations = annotations.filter(a =>
        a.normaKey === itemKey &&
        (a.articleId === uniqueArticleId || a.articleId.startsWith(subSectionPrefix))
    );
    const allPanelHighlights = highlights.filter(h =>
        h.normaKey === itemKey &&
        (h.articleId === uniqueArticleId || h.articleId.startsWith(subSectionPrefix))
    );

    // Fetch persisted highlights + annotations from the Node backend when the
    // article first mounts (or when the user switches to a different article
    // inside the same NormaCard). The store actions guard against racing
    // against in-flight optimistic inserts by replacing only the entries for
    // this specific (normaKey, articleId) pair.
    useEffect(() => {
        if (!itemKey || !uniqueArticleId) return;
        loadHighlightsForArticle(itemKey, uniqueArticleId);
        loadAnnotationsForArticle(itemKey, uniqueArticleId);
    }, [itemKey, uniqueArticleId, loadHighlightsForArticle, loadAnnotationsForArticle]);

    useEffect(() => {
        if (!toastMessage) return;
        const timeout = setTimeout(() => setToastMessage(null), 3000);
        return () => clearTimeout(timeout);
    }, [toastMessage]);

    // Capture text selection for highlighting
    useEffect(() => {
        const handleSelection = () => {
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0 && contentRef.current) {
                const range = selection.getRangeAt(0);
                const selectedText = selection.toString().trim();

                if (selectedText && contentRef.current.contains(range.commonAncestorContainer)) {
                    const startOffset = getPlainTextOffset(contentRef.current, range.startContainer, range.startOffset);
                    highlightSelectionRef.current = { text: selectedText, startOffset };
                }
            }
        };

        document.addEventListener('selectionchange', handleSelection);
        return () => document.removeEventListener('selectionchange', handleSelection);
    }, []);

    // Close highlight picker on outside click
    useEffect(() => {
        if (!showHighlightPicker) return;

        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest('[data-highlight-picker]') && !target.closest('[data-highlight-button]')) {
                setShowHighlightPicker(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showHighlightPicker]);

    const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
        setToastMessage({ text, type });
    };

    const handleAddToQuickNorms = () => {
        const label = `Art. ${norma_data.numero_articolo}${norma_data.allegato ? ` (All. ${norma_data.allegato})` : ''} ${norma_data.tipo_atto}${norma_data.numero_atto ? ` n. ${norma_data.numero_atto}` : ''}`;
        addQuickNorm(label, {
            act_type: norma_data.tipo_atto,
            act_number: norma_data.numero_atto || '',
            date: norma_data.data || '',
            article: norma_data.numero_articolo,
            annex: norma_data.allegato,
            version: 'vigente',
            show_brocardi_info: true,
        });
        showToast('Aggiunto alle norme rapide', 'success');
    };

    const handleAdvancedCopy = async (options: CopyOptions) => {
        try {
            let textToCopy = '';

            if (options.includeText) {
                const plainText = (article_text || '').replace(/<[^>]+>/g, '').replace(/\n/g, ' ');
                textToCopy += plainText;
            }

            if (options.includeCitation) {
                const citation = `\n\n---\nTratto da: ${norma_data.tipo_atto}${norma_data.numero_atto ? ` n. ${norma_data.numero_atto}` : ''}${norma_data.data ? ` del ${norma_data.data}` : ''}, Art. ${norma_data.numero_articolo}${norma_data.allegato ? ` (Allegato ${norma_data.allegato})` : ''}`;
                textToCopy += citation;
            }

            if (options.includeNotes && allPanelAnnotations.length > 0) {
                textToCopy += `\n\nNote personali:\n${allPanelAnnotations.map((n, i) => `${i + 1}. ${n.text}`).join('\n')}`;
            }

            if (options.includeHighlights && allPanelHighlights.length > 0) {
                textToCopy += `\n\nEvidenziazioni:\n${allPanelHighlights.map((h, i) => `${i + 1}. "${h.text}"`).join('\n')}`;
            }

            await navigator.clipboard.writeText(textToCopy);
            showToast('Contenuto copiato negli appunti', 'success');
        } catch (err) {
            showToast('Errore durante la copia', 'error');
        }
    };

    const handleAddNote = () => {
        if (!noteText.trim()) {
            showToast('Inserisci una nota', 'error');
            return;
        }
        const anchor = noteAnchor;
        const targetArticleId = anchor?.scopedArticleId ?? uniqueArticleId;
        const anchorPayload = anchor
            ? { anchorText: anchor.anchorText, startOffset: anchor.startOffset }
            : undefined;
        addAnnotation(itemKey, targetArticleId, noteText, anchorPayload);
        setNoteText('');
        setNoteAnchor(null);
        showToast(anchor ? 'Nota ancorata al testo' : 'Nota aggiunta', 'success');
    };

    const handleShareLink = async () => {
        try {
            const params: SearchParams = {
                act_type: norma_data.tipo_atto,
                act_number: norma_data.numero_atto || '',
                date: norma_data.data || '',
                article: norma_data.numero_articolo,
                annex: norma_data.allegato,
                version: (norma_data.versione as 'vigente' | 'originale') || 'vigente',
                version_date: norma_data.data_versione || '',
                show_brocardi_info: true
            };
            const encoded = btoa(JSON.stringify(params));
            const shareUrl = `${window.location.origin}${window.location.pathname}?share=${encoded}`;
            await navigator.clipboard.writeText(shareUrl);
            showToast('Link copiato negli appunti', 'success');
        } catch (err) {
            showToast('Errore durante la copia del link', 'error');
        }
    };

    const handleHighlightAdd = (color?: 'yellow' | 'green' | 'red' | 'blue') => {
        const selection = window.getSelection();
        const selectedText = selection?.toString().trim();

        if (!selectedText) {
            // Try to use saved selection (user may have clicked the toolbar
            // button which stole focus and cleared the live selection).
            if (highlightSelectionRef.current) {
                const saved = highlightSelectionRef.current;
                const alreadyHighlighted = articleHighlights.some(h =>
                    h.text.toLowerCase() === saved.text.toLowerCase() && h.startOffset === saved.startOffset
                );
                if (alreadyHighlighted) {
                    showToast('Questa occorrenza è già evidenziata', 'info');
                    highlightSelectionRef.current = null;
                    setShowHighlightPicker(false);
                    return;
                }
                addHighlight(itemKey, uniqueArticleId, saved.text, '', color || 'yellow', saved.startOffset);
                showToast('Testo evidenziato', 'success');
                highlightSelectionRef.current = null;
            } else {
                showToast('Seleziona del testo da evidenziare', 'error');
            }
            setShowHighlightPicker(false);
            return;
        }

        const liveOffset = getSelectionPlainOffset(contentRef.current, selection);

        // Already-highlighted check: same text AND same occurrence (startOffset).
        // A user can legitimately highlight two different occurrences of the
        // same word, so we don't block on text alone.
        const alreadyHighlighted = articleHighlights.some(h =>
            h.text.toLowerCase() === selectedText.toLowerCase() && h.startOffset === liveOffset
        );
        if (alreadyHighlighted) {
            showToast('Questa occorrenza è già evidenziata', 'info');
            setShowHighlightPicker(false);
            selection?.removeAllRanges();
            return;
        }

        const finalColor = color || 'yellow';
        addHighlight(itemKey, uniqueArticleId, selectedText, '', finalColor, liveOffset);
        showToast(`Testo evidenziato in ${finalColor}`, 'success');
        setShowHighlightPicker(false);
        highlightSelectionRef.current = null;

        // Clear selection
        selection?.removeAllRanges();
    };

    // Handler for SelectionPopup highlight action
    const handlePopupHighlight = (text: string, color: 'yellow' | 'green' | 'red' | 'blue', startOffset: number) => {
        const alreadyHighlighted = articleHighlights.some(h =>
            h.text.toLowerCase() === text.toLowerCase() && h.startOffset === startOffset
        );
        if (alreadyHighlighted) {
            showToast('Questa occorrenza è già evidenziata', 'info');
            return;
        }
        addHighlight(itemKey, uniqueArticleId, text, '', color, startOffset);
        showToast(`Testo evidenziato in ${color}`, 'success');
    };

    // Handler for SelectionPopup note action in the article body.
    const handlePopupAddNote = (text: string, startOffset: number) => {
        setNoteAnchor({ anchorText: text, startOffset, scopedArticleId: uniqueArticleId });
        setNoteText('');
        setShowNotes(true);
    };

    // Called by a markable brocardi sub-section (Ratio / Spiegazione) when
    // the user chooses "Aggiungi nota" inside it. The anchor offset is
    // relative to that section's own textContent, so the scopedArticleId
    // carries the sub-section identifier.
    const handleBrocardiAddNote = (scopedArticleId: string, text: string, startOffset: number) => {
        setNoteAnchor({ anchorText: text, startOffset, scopedArticleId });
        setNoteText('');
        setShowNotes(true);
    };

    // Handler for SelectionPopup copy action
    const handlePopupCopy = async (text: string) => {
        try {
            const citation = `\n\n---\nTratto da: ${norma_data.tipo_atto}${norma_data.numero_atto ? ` n. ${norma_data.numero_atto}` : ''}${norma_data.data ? ` del ${norma_data.data}` : ''}, Art. ${norma_data.numero_articolo}${norma_data.allegato ? ` (Allegato ${norma_data.allegato})` : ''}`;
            await navigator.clipboard.writeText(text + citation);
            showToast('Testo copiato con citazione', 'success');
        } catch (err) {
            showToast('Errore durante la copia', 'error');
        }
    };

    // Handler for opening citation in new tab
    const handleOpenCitationInTab = useCallback((citation: ParsedCitationData) => {
        triggerSearch({
            act_type: citation.act_type,
            act_number: citation.act_number || '',
            date: citation.date || '',
            article: citation.article,
            version: 'vigente',
            show_brocardi_info: true,
        });
    }, [triggerSearch]);

    // Highlights + note anchors are applied by the shared useArticleMarkers
    // hook (reusable on Brocardi sections too). Dictionary + citation
    // wrapping are article-specific and happen after.
    const markedHtml = useArticleMarkers({
        rawText: article_text || '',
        highlights: articleHighlights,
        annotations: itemAnnotations,
    });

    const processedContent = useMemo(() => {
        let html = markedHtml;

        Object.entries(DICTIONARY_TERMS).forEach(([term, definition]) => {
            const regex = new RegExp(`(?<!<mark[^>]*>)\\b${term}\\b(?!</mark>)`, 'gi');
            html = html.replace(regex, (match) => `<span class="dictionary-term" data-definition="${definition}">${match}</span>`);
        });

        html = wrapCitationsInHtml(html, norma_data);

        return html;
    }, [markedHtml, norma_data]);

    // Handle citation hover and click events
    useEffect(() => {
        const container = contentRef.current;
        if (!container) return;

        // Click handler for citations - navigate to article
        const handleClick = (event: Event) => {
            const target = event.target as HTMLElement;
            const citationElement = target.closest('.citation-hover');
            if (citationElement) {
                const citationData = citationElement.getAttribute('data-citation');
                if (citationData) {
                    const parsed = deserializeCitation(citationData);
                    if (parsed && onCrossReferenceNavigate) {
                        // Navigate within same norma if possible
                        if (parsed.act_type === norma_data.tipo_atto &&
                            parsed.act_number === norma_data.numero_atto) {
                            onCrossReferenceNavigate(parsed.article, norma_data);
                        } else {
                            // Open in new search
                            triggerSearch({
                                act_type: parsed.act_type,
                                act_number: parsed.act_number || '',
                                date: parsed.date || '',
                                article: parsed.article,
                                version: 'vigente',
                                show_brocardi_info: true,
                            });
                        }
                        hidePreview();
                    }
                }
            }
        };

        // Hover handler for citations - show preview
        const handleMouseEnter = (event: Event) => {
            const target = event.target as HTMLElement;
            const citationElement = target.closest('.citation-hover') as HTMLElement;
            if (citationElement) {
                const citationData = citationElement.getAttribute('data-citation');
                const cacheKey = citationElement.getAttribute('data-cache-key');
                if (citationData && cacheKey) {
                    const parsed = deserializeCitation(citationData);
                    if (parsed) {
                        showPreview(citationElement, parsed, cacheKey);
                    }
                }
            }
        };

        // Mouse leave handler
        const handleMouseLeave = (event: Event) => {
            const target = event.target as HTMLElement;
            const citationElement = target.closest('.citation-hover');
            if (citationElement) {
                // Delay hide to allow moving to popup
                setTimeout(() => {
                    if (!isHoveringPopupRef.current) {
                        hidePreview();
                    }
                }, 100);
            }
        };

        container.addEventListener('click', handleClick);
        container.addEventListener('mouseenter', handleMouseEnter, true);
        container.addEventListener('mouseleave', handleMouseLeave, true);

        return () => {
            container.removeEventListener('click', handleClick);
            container.removeEventListener('mouseenter', handleMouseEnter, true);
            container.removeEventListener('mouseleave', handleMouseLeave, true);
        };
    }, [onCrossReferenceNavigate, norma_data, triggerSearch, showPreview, hidePreview]);

    return (
        <div className="animate-in fade-in duration-300 relative">
            {/* Sticky Reading Toolbar */}
            <div className={cn('glass-toolbar sticky top-0 flex items-center justify-between p-2 rounded-t-xl mb-4 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-b-2 border-slate-200/50 dark:border-slate-800/50', Z_INDEX.sticky)}>
                {/* Version Info & Annex Source Badge */}
                <div className="flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                    {versionInfo?.isHistorical ? (
                        <span className={cn("px-2 py-1 rounded-md",
                            versionInfo.isHistorical ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300")}>
                            {versionInfo.isHistorical ? "Storica" : "Vigente"}
                        </span>
                    ) : (
                        <span className="px-2 py-1 rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                            Vigente
                        </span>
                    )}
                    {norma_data.data_versione && (
                        <>
                            <span className="text-slate-300 dark:text-slate-700">|</span>
                            <span>Aggiornato al: {norma_data.data_versione}</span>
                        </>
                    )}
                    {/* Annex Source Badge */}
                    {norma_data.allegato && (
                        <>
                            <span className="text-slate-300 dark:text-slate-700">|</span>
                            <span className="px-2 py-1 rounded-md bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                                Allegato {norma_data.allegato}
                            </span>
                        </>
                    )}
                </div>

                {/* Mobile: Quick Actions + Study Mode toggle */}
                <div className="flex md:hidden items-center gap-1">
                    <button
                        onClick={handleAddToQuickNorms}
                        className="p-2 lg:p-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-amber-500"
                        title="Aggiungi a norme rapide"
                    >
                        <Zap size={20} />
                    </button>
                    <button
                        onClick={async () => {
                            try {
                                const plainText = (article_text || '').replace(/<[^>]+>/g, '').replace(/\n/g, ' ');
                                const citation = `\n\n---\nArt. ${norma_data.numero_articolo} ${norma_data.tipo_atto}${norma_data.numero_atto ? ` n. ${norma_data.numero_atto}` : ''}`;
                                await navigator.clipboard.writeText(plainText + citation);
                                showToast('Testo copiato', 'success');
                            } catch {
                                showToast('Errore durante la copia', 'error');
                            }
                        }}
                        className="p-2 lg:p-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-emerald-500 transition-colors"
                        title="Copia testo"
                    >
                        <Copy size={20} />
                    </button>
                    {/* Study Mode button - sempre visibile */}
                    <button
                        onClick={onOpenStudyMode}
                        className="p-2 lg:p-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-purple-500 transition-colors"
                        title="Modalità studio"
                    >
                        <BookOpen size={20} />
                    </button>
                    {url && (
                        <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="p-2 lg:p-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-primary-500 transition-colors"
                            title="Apri fonte"
                        >
                            <ExternalLink size={20} />
                        </a>
                    )}
                </div>

                {/* Desktop: Full Quick Actions */}
                <div className="hidden md:flex items-center gap-1">
                    {/* Primary buttons */}
                    <button
                        onClick={handleAddToQuickNorms}
                        className="p-1.5 rounded-md hover:bg-amber-50 dark:hover:bg-amber-900/20 text-slate-400 hover:text-amber-500 transition-colors"
                        title="Aggiungi a norme rapide"
                    >
                        <Zap size={16} />
                    </button>
                    <button
                        onClick={() => setShowNotes(!showNotes)}
                        className={cn("p-1.5 rounded-md transition-colors relative",
                            showNotes || allPanelAnnotations.length > 0
                                ? "bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400"
                                : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-primary-500"
                        )}
                        title="Note Personali"
                    >
                        <StickyNote size={16} />
                        {allPanelAnnotations.length > 0 && (
                            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-primary-500 text-white text-[9px] rounded-full flex items-center justify-center">
                                {allPanelAnnotations.length}
                            </span>
                        )}
                    </button>
                    <div className="relative" data-highlight-picker>
                        <button
                            data-highlight-button
                            onClick={() => {
                                const selection = window.getSelection()?.toString().trim();
                                if (!selection && !highlightSelectionRef.current) {
                                    showToast('Seleziona del testo da evidenziare', 'error');
                                    return;
                                }
                                setShowHighlightPicker(!showHighlightPicker);
                            }}
                            className={cn(
                                "p-1.5 rounded-md transition-colors relative",
                                allPanelHighlights.length > 0
                                    ? "bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400"
                                    : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-purple-500"
                            )}
                            title="Evidenzia Testo"
                        >
                            <Highlighter size={16} />
                            {allPanelHighlights.length > 0 && (
                                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-purple-500 text-white text-[9px] rounded-full flex items-center justify-center">
                                    {allPanelHighlights.length}
                                </span>
                            )}
                        </button>
                        {showHighlightPicker && (
                            <div className={cn('absolute left-1/2 -translate-x-1/2 mt-2 p-2 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 flex gap-2 animate-in fade-in zoom-in-95 duration-200', Z_INDEX.dropdown)}>
                                {(['yellow', 'green', 'red', 'blue'] as const).map(color => (
                                    <button
                                        key={color}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleHighlightAdd(color);
                                        }}
                                        className={cn(
                                            "w-6 h-6 rounded-full border-2 transition-all hover:scale-110",
                                            color === 'yellow' && 'bg-yellow-200 border-yellow-400',
                                            color === 'green' && 'bg-emerald-200 border-emerald-400',
                                            color === 'red' && 'bg-red-200 border-red-400',
                                            color === 'blue' && 'bg-blue-200 border-blue-400',
                                            color === 'yellow' && 'ring-2 ring-offset-1 ring-purple-500'
                                        )}
                                        title={`Evidenzia in ${color}`}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                    <button
                        onClick={() => setShowCopyModal(true)}
                        className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-emerald-500 transition-colors"
                        title="Copia"
                    >
                        <Copy size={16} />
                    </button>

                    <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />

                    {/* More menu */}
                    <div className="relative">
                        <button
                            onClick={() => setShowMoreMenu(!showMoreMenu)}
                            className={cn(
                                "p-1.5 rounded-md transition-colors",
                                showMoreMenu
                                    ? "bg-slate-100 dark:bg-slate-800 text-primary-500"
                                    : "text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                            )}
                            title="Altre azioni"
                        >
                            <MoreHorizontal size={16} />
                        </button>
                        {showMoreMenu && (
                            <>
                                <div className={cn('fixed inset-0', Z_INDEX.dropdown)} onClick={() => setShowMoreMenu(false)} />
                                <div className={cn('absolute right-0 mt-2 w-48 bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in-95 duration-200 py-1', Z_INDEX.dropdown)}>
                                    <button
                                        onClick={() => {
                                            setShowDossierModal(true);
                                            setShowMoreMenu(false);
                                        }}
                                        className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                                    >
                                        <FolderPlus size={14} className="text-slate-400" />
                                        Aggiungi a dossier
                                    </button>
                                    <button
                                        onClick={() => {
                                            handleShareLink();
                                            setShowMoreMenu(false);
                                        }}
                                        className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                                    >
                                        <Share2 size={14} className="text-slate-400" />
                                        Condividi link
                                    </button>
                                    <button
                                        onClick={() => {
                                            setShowAdvancedExport(true);
                                            setShowMoreMenu(false);
                                        }}
                                        className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                                    >
                                        <Download size={14} className="text-slate-400" />
                                        Esporta...
                                    </button>

                                    <div className="border-t border-slate-200 dark:border-slate-700 my-1" />

                                    <button
                                        onClick={() => {
                                            setShowVersionInput(true);
                                            setShowMoreMenu(false);
                                        }}
                                        className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                                    >
                                        <Clock size={14} className="text-slate-400" />
                                        Cerca versione...
                                    </button>
                                    <button
                                        onClick={() => {
                                            const label = `Art. ${norma_data.numero_articolo}${norma_data.allegato ? ` (All. ${norma_data.allegato})` : ''} - ${norma_data.tipo_atto}${norma_data.numero_atto ? ` n. ${norma_data.numero_atto}` : ''}`;
                                            openCompareWithArticle({
                                                article: data,
                                                sourceNorma: {
                                                    tipo_atto: norma_data.tipo_atto,
                                                    numero_atto: norma_data.numero_atto,
                                                    data: norma_data.data,
                                                },
                                                label,
                                            });
                                            setShowMoreMenu(false);
                                            const state = getCompareState();
                                            if (state.leftArticle && !state.rightArticle) {
                                                showToast('Articolo aggiunto. Seleziona un altro articolo per completare il confronto.', 'info');
                                            } else if (state.isOpen && state.leftArticle && state.rightArticle) {
                                                showToast('Confronto pronto!', 'success');
                                            }
                                        }}
                                        className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                                    >
                                        <GitCompare size={14} className="text-slate-400" />
                                        Confronta con...
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Notes panel (study feature) */}
            {(showNotes || allPanelAnnotations.length > 0) && (
                <div className="hidden md:block mb-4 bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200/50 dark:border-amber-800/20 rounded-lg p-4 transition-all">
                    <h6 className="text-xs font-bold text-amber-700 dark:text-amber-500 uppercase mb-3 flex items-center gap-2">
                        <StickyNote size={14} /> Note Personali
                    </h6>

                    <div className="space-y-3 mb-3">
                        {allPanelAnnotations.map(note => (
                            <div key={note.id} className="bg-white dark:bg-slate-800 p-3 rounded-lg shadow-sm text-sm relative group border border-amber-100 dark:border-amber-900/20">
                                {note.anchorText && (
                                    <div className="text-xs italic text-amber-700 dark:text-amber-400 mb-1.5 flex items-start gap-1.5 pr-6">
                                        <StickyNote size={11} className="mt-0.5 shrink-0" />
                                        <span className="line-clamp-2">&ldquo;{note.anchorText}&rdquo;</span>
                                    </div>
                                )}
                                <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{note.text}</p>
                                <div className="text-xs text-slate-400 mt-2">{new Date(note.createdAt).toLocaleString()}</div>
                                <button
                                    onClick={() => removeAnnotation(note.id)}
                                    className="absolute top-2 right-2 p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-all opacity-0 group-hover:opacity-100"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ))}
                    </div>

                    {showNotes && (
                        <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                            {noteAnchor && (
                                <div className="flex items-center gap-2 mb-2 px-2.5 py-1.5 bg-amber-100/70 dark:bg-amber-900/30 rounded-md text-xs border border-amber-300/60 dark:border-amber-800/40">
                                    <StickyNote size={12} className="text-amber-600 dark:text-amber-400 shrink-0" />
                                    <span className="italic flex-1 truncate text-amber-800 dark:text-amber-300">
                                        Ancorata a: &ldquo;{noteAnchor.anchorText}&rdquo;
                                    </span>
                                    <button
                                        onClick={() => setNoteAnchor(null)}
                                        className="p-0.5 hover:bg-amber-200 dark:hover:bg-amber-800/50 rounded text-amber-700 dark:text-amber-400 transition-colors"
                                        title="Rimuovi ancoraggio"
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            )}
                            <div className="flex gap-2">
                                <textarea
                                    value={noteText}
                                    onChange={e => setNoteText(e.target.value)}
                                    placeholder={noteAnchor ? `Scrivi una nota su "${noteAnchor.anchorText.slice(0, 30)}${noteAnchor.anchorText.length > 30 ? '…' : ''}"` : 'Scrivi una nota...'}
                                    className="flex-1 text-sm rounded-lg border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900 p-2 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 min-h-[60px]"
                                />
                                <button
                                    onClick={handleAddNote}
                                    className="self-end bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                                >
                                    Salva
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}


            {/* Article Content with Prose Styling */}
            <div className="relative group/content" ref={contentRef}>
                <SelectionPopup
                    containerRef={contentRef}
                    onHighlight={handlePopupHighlight}
                    onAddNote={handlePopupAddNote}
                    onCopy={handlePopupCopy}
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
            {allPanelHighlights.length > 0 && (
                <div className="hidden md:block mt-8 mb-6 bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3 border border-slate-200 dark:border-slate-700 text-sm">
                    <h6 className="font-semibold text-slate-600 dark:text-slate-300 mb-2 flex items-center gap-2">
                        <Highlighter size={14} /> Evidenziazioni
                    </h6>
                    <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                        {allPanelHighlights.map(h => (
                            <div key={h.id} className="flex justify-between items-start gap-2 bg-white dark:bg-slate-900 p-2 rounded border border-slate-100 dark:border-slate-700">
                                <span style={{ ...parseInlineStyle(HIGHLIGHT_STYLES[h.color]) }} className="rounded px-2 py-1 flex-1 text-xs">{h.text}</span>
                                <button onClick={() => removeHighlight(h.id)} className="text-slate-400 hover:text-red-500 p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors">
                                    <X size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {brocardi_info !== undefined && (
                <div className="mt-8 border-t border-slate-200 dark:border-slate-800 pt-6">
                    <BrocardiDisplay
                        info={brocardi_info}
                        itemKey={itemKey}
                        uniqueArticleId={uniqueArticleId}
                        onRequestAddNote={handleBrocardiAddNote}
                        currentNorma={{
                            tipo_atto: norma_data.tipo_atto,
                            data: norma_data.data,
                            numero_atto: norma_data.numero_atto
                        }}
                        onArticleClick={(articleNumber, tipoAtto) => {
                            // Se è la stessa norma e onCrossReferenceNavigate è disponibile, usalo
                            if (tipoAtto.toLowerCase() === norma_data.tipo_atto.toLowerCase() && onCrossReferenceNavigate) {
                                onCrossReferenceNavigate(articleNumber, norma_data);
                            } else {
                                // Altrimenti apri nuova tab
                                const isSameActType = tipoAtto.toLowerCase() === norma_data.tipo_atto.toLowerCase();
                                triggerSearch({
                                    act_type: tipoAtto,
                                    act_number: isSameActType && norma_data.numero_atto ? norma_data.numero_atto : '',
                                    date: isSameActType && norma_data.data ? norma_data.data : '',
                                    article: articleNumber,
                                    version: 'vigente',
                                    show_brocardi_info: true,
                                });
                            }
                        }}
                    />
                </div>
            )}

            {url && (
                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
                    <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
                    >
                        <ExternalLink size={12} />
                        Visualizza fonte ufficiale su Normattiva
                    </a>
                </div>
            )}

            {toastMessage && (
                <Toast
                    message={toastMessage.text}
                    type={toastMessage.type}
                    isVisible={!!toastMessage}
                    onClose={() => setToastMessage(null)}
                />
            )}

            <DossierModal
                isOpen={showDossierModal}
                onClose={() => setShowDossierModal(false)}
                itemToAdd={norma_data}
                itemType="norma"
            />

            <CopyModal
                isOpen={showCopyModal}
                onClose={() => setShowCopyModal(false)}
                onCopy={handleAdvancedCopy}
                hasNotes={allPanelAnnotations.length > 0}
                hasHighlights={allPanelHighlights.length > 0}
            />

            <AdvancedExportModal
                isOpen={showAdvancedExport}
                onClose={() => setShowAdvancedExport(false)}
                articleData={data}
                annotations={allPanelAnnotations}
                highlights={allPanelHighlights}
            />

            <Modal
                isOpen={showVersionInput}
                onClose={() => {
                    setShowVersionInput(false);
                    setVersionDate('');
                }}
                title="Cerca Versione Storica"
                description="Inserisci una data per visualizzare la versione dell'articolo vigente in quel momento."
                size="sm"
                variant="info"
                icon={<Clock size={20} />}
                initialFocusRef={versionDateInputRef}
                footer={
                    <>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                setShowVersionInput(false);
                                setVersionDate('');
                            }}
                        >
                            Annulla
                        </Button>
                        <Button
                            variant="primary"
                            size="sm"
                            disabled={!versionDate}
                            onClick={() => {
                                if (!versionDate) {
                                    showToast('Seleziona una data', 'error');
                                    return;
                                }
                                const searchParams: SearchParams = {
                                    act_type: norma_data.tipo_atto,
                                    act_number: norma_data.numero_atto || '',
                                    date: norma_data.data || '',
                                    article: norma_data.numero_articolo,
                                    version: 'vigente',
                                    version_date: versionDate,
                                    show_brocardi_info: true,
                                };
                                showToast(`Ricerca versione del ${versionDate}`, 'info');
                                setShowVersionInput(false);
                                setVersionDate('');
                                triggerSearch(searchParams);
                            }}
                        >
                            <Clock size={16} />
                            Cerca versione
                        </Button>
                    </>
                }
            >
                <input
                    ref={versionDateInputRef}
                    type="date"
                    value={versionDate}
                    onChange={(e) => setVersionDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                />
            </Modal>

            {/* Citation Preview Popup */}
            <CitationPreviewPopup
                isVisible={citationPreviewState.isVisible}
                isLoading={citationPreviewState.isLoading}
                error={citationPreviewState.error}
                citation={citationPreviewState.citation}
                article={citationPreviewState.article}
                position={citationPreviewState.position}
                onClose={hidePreview}
                onOpenInTab={handleOpenCitationInTab}
                onMouseEnter={() => { isHoveringPopupRef.current = true; }}
                onMouseLeave={() => {
                    isHoveringPopupRef.current = false;
                    hidePreview();
                }}
            />

        </div>
    );
}

