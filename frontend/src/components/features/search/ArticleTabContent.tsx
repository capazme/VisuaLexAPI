import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import type { ArticleData, SearchParams } from '../../../types';
import { BrocardiDisplay } from './BrocardiDisplay';
import { ExternalLink, Clock } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { DossierModal } from '../../ui/DossierModal';
import { Toast } from '../../ui/Toast';
import { CopyModal, type CopyOptions } from '../../ui/CopyModal';
import { AdvancedExportModal } from '../../ui/AdvancedExportModal';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { CitationPreviewPopup } from '../../ui/CitationPreviewPopup';
import { useCitationPreview } from '../../../hooks/useCitationPreview';
import { wrapCitationsInHtml, deserializeCitation, type ParsedCitationData } from '../../../utils/citationMatcher';
import { openCompareWithArticle, getCompareState } from '../../../hooks/useCompare';
import { useArticleMarkers } from '../../../hooks/useArticleMarkers';
import { subscribeSearchNavigation } from '../../../hooks/useGlobalSearch';
import { ReadingToolbar } from './ReadingToolbar';
import { NotesPeekPanel } from './NotesPeekPanel';
import { HighlightsActionsPicker } from './HighlightsActionsPicker';
import { InlineNotePopover } from './InlineNotePopover';
import { InlineNoteComposer } from './InlineNoteComposer';
import { ArticleBody } from './ArticleBody';
import type { Annotation } from '../../../types';

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
    // Subscribe only to the store slices this component actually reads.
    // Action references are already stable across store lifetimes; the
    // useShallow on the whole picked object means a change to unrelated
    // state (bookmarks, dossiers…) no longer re-renders us.
    const {
        annotations,
        addAnnotation,
        removeAnnotation,
        updateAnnotation,
        loadAnnotationsForArticle,
        highlights,
        addHighlight,
        removeHighlight,
        loadHighlightsForArticle,
        triggerSearch,
        addQuickNorm,
        removeQuickNormByParams,
        isQuickNorm,
    } = useAppStore(useShallow(s => ({
        annotations: s.annotations,
        addAnnotation: s.addAnnotation,
        removeAnnotation: s.removeAnnotation,
        updateAnnotation: s.updateAnnotation,
        loadAnnotationsForArticle: s.loadAnnotationsForArticle,
        highlights: s.highlights,
        addHighlight: s.addHighlight,
        removeHighlight: s.removeHighlight,
        loadHighlightsForArticle: s.loadHighlightsForArticle,
        triggerSearch: s.triggerSearch,
        addQuickNorm: s.addQuickNorm,
        removeQuickNormByParams: s.removeQuickNormByParams,
        isQuickNorm: s.isQuickNorm,
    })));

    const [showDossierModal, setShowDossierModal] = useState(false);
    const [isPeekOpen, setIsPeekOpen] = useState(false);
    const [inlineNote, setInlineNote] = useState<{ note: Annotation; anchorEl: HTMLElement } | null>(null);
    // State (not ref) so the popover re-reads the anchor when the button
    // actually mounts. Using ref.current in render triggers the
    // react-hooks/refs lint and can miss the post-mount update.
    const [notesButtonEl, setNotesButtonEl] = useState<HTMLButtonElement | null>(null);
    const [showMoreMenu, setShowMoreMenu] = useState(false);
    const [showCopyModal, setShowCopyModal] = useState(false);
    const [showAdvancedExport, setShowAdvancedExport] = useState(false);
    const [showVersionInput, setShowVersionInput] = useState(false);
    const [versionDate, setVersionDate] = useState('');
    const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
    const [isHighlightsPeekOpen, setIsHighlightsPeekOpen] = useState(false);
    const [highlightsButtonEl, setHighlightsButtonEl] = useState<HTMLButtonElement | null>(null);
    // Local visibility toggle: when true, the article body keeps the markup
    // (so highlights aren't lost) but renders `.highlight-mark` transparent
    // via the `.highlights-hidden` class scoped to contentRef. Per-article,
    // not persisted across sessions.
    const [highlightsHidden, setHighlightsHidden] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);
    // When the user picks "Aggiungi nota" from the selection popup the
    // selected span becomes the note's anchor. Kept in state so the panel
    // can render a chip ("Ancorata a: …") until the user submits.
    // scopedArticleId defaults to the article body; markable brocardi
    // sections override it to target their own sub-section scope.
    const [noteAnchor, setNoteAnchor] = useState<{ anchorText: string; startOffset: number; scopedArticleId: string } | null>(null);
    // Captured selection rect (viewport coords) used to anchor the tooltip-style
    // composer on the selected span itself, rather than the Notes toolbar button.
    // When null, the composer isn't open; when set, `noteAnchor` carries the
    // corresponding anchorText / offset / scope.
    const [composerRect, setComposerRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
    const versionDateInputRef = useRef<HTMLInputElement>(null);

    // Citation preview hook - destructure to get stable function references
    const citationPreviewState = useCitationPreview();
    const { showPreview, hidePreview } = citationPreviewState;
    const isHoveringPopupRef = useRef(false);

    const itemKey = useMemo(() => {
        const sanitize = (str: string) => str.replace(/\s+/g, '-').replace(/[^\w-]/g, '').toLowerCase();
        const parts = [norma_data.tipo_atto];
        if (norma_data.numero_atto?.trim()) parts.push(norma_data.numero_atto);
        if (norma_data.data?.trim()) parts.push(norma_data.data);
        if (norma_data.allegato?.trim()) parts.push(`all${norma_data.allegato}`);
        if (norma_data.numero_articolo?.trim()) parts.push(norma_data.numero_articolo);
        return parts.map(part => sanitize(part || '')).join('--');
    }, [norma_data.tipo_atto, norma_data.numero_atto, norma_data.data, norma_data.allegato, norma_data.numero_articolo]);

    const uniqueArticleId = useMemo(
        () => norma_data.allegato ? `all${norma_data.allegato}:${norma_data.numero_articolo}` : norma_data.numero_articolo,
        [norma_data.allegato, norma_data.numero_articolo],
    );

    // Memo the four filters: without this, the full annotations/highlights
    // arrays being new-ref on every store mutation (even unrelated articles)
    // would re-run the marker pipeline and force ArticleBody to re-render.
    const itemAnnotations = useMemo(
        () => annotations.filter(a => a.normaKey === itemKey && a.articleId === uniqueArticleId),
        [annotations, itemKey, uniqueArticleId],
    );
    const articleHighlights = useMemo(
        () => highlights.filter(h => h.normaKey === itemKey && h.articleId === uniqueArticleId),
        [highlights, itemKey, uniqueArticleId],
    );

    // Panel list (notes + highlights summary) includes brocardi sub-sections
    // so users see everything they've saved for this article in one place.
    const allPanelAnnotations = useMemo(() => {
        const subSectionPrefix = `${uniqueArticleId}/`;
        return annotations.filter(a =>
            a.normaKey === itemKey &&
            (a.articleId === uniqueArticleId || a.articleId.startsWith(subSectionPrefix))
        );
    }, [annotations, itemKey, uniqueArticleId]);
    const allPanelHighlights = useMemo(() => {
        const subSectionPrefix = `${uniqueArticleId}/`;
        return highlights.filter(h =>
            h.normaKey === itemKey &&
            (h.articleId === uniqueArticleId || h.articleId.startsWith(subSectionPrefix))
        );
    }, [highlights, itemKey, uniqueArticleId]);

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

    // Cmd+F click → scroll this article body to the requested occurrence.
    // useArticleMarkers tags each search hit with `data-search-idx`; we
    // wait one frame (so the re-render from the setGlobalHighlight typing
    // AND the article switch has settled) before querying the DOM.
    useEffect(() => {
        return subscribeSearchNavigation((req) => {
            if (!req) return;
            if (req.articleId !== uniqueArticleId) return;
            const container = contentRef.current;
            if (!container) return;
            // rAF twice: first frame lets React commit, second lets the
            // browser lay out the scrollIntoView target.
            requestAnimationFrame(() => requestAnimationFrame(() => {
                const target = container.querySelector<HTMLElement>(
                    `.search-match[data-search-idx="${req.occurrenceIdx}"]`,
                );
                if (!target) return;
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                target.classList.add('search-match-active');
                setTimeout(() => target.classList.remove('search-match-active'), 1600);
            }));
        });
    }, [uniqueArticleId]);

    useEffect(() => {
        if (!toastMessage) return;
        const timeout = setTimeout(() => setToastMessage(null), 3000);
        return () => clearTimeout(timeout);
    }, [toastMessage]);

    // Toggle a `highlights-hidden` class on the article body so CSS can
    // make `.highlight-mark` spans transparent without rebuilding the
    // markup. This way nothing is lost — re-toggling restores the colors.
    useEffect(() => {
        const container = contentRef.current;
        if (!container) return;
        container.classList.toggle('highlights-hidden', highlightsHidden);
    }, [highlightsHidden]);

    // Delegated click handler on the article body: tap on a wavy
    // `.note-anchor` underline opens the compact InlineNotePopover for
    // that single note. The full Peek panel stays for the toolbar button.
    useEffect(() => {
        const container = contentRef.current;
        if (!container) return;
        const handler = (e: MouseEvent) => {
            const target = (e.target as HTMLElement | null)?.closest('.note-anchor') as HTMLElement | null;
            if (!target) return;
            const noteId = target.getAttribute('data-note-id');
            if (!noteId) return;
            const note = itemAnnotations.find(a => a.id === noteId);
            if (!note) return;
            e.preventDefault();
            e.stopPropagation();
            setInlineNote({ note, anchorEl: target });
        };
        container.addEventListener('click', handler);
        return () => container.removeEventListener('click', handler);
    }, [itemAnnotations]);

    const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
        setToastMessage({ text, type });
    };

    const quickNormParams = useMemo(() => ({
        act_type: norma_data.tipo_atto,
        act_number: norma_data.numero_atto || '',
        date: norma_data.data || '',
        article: norma_data.numero_articolo,
        annex: norma_data.allegato,
        version: 'vigente' as const,
        show_brocardi_info: true,
    }), [norma_data.tipo_atto, norma_data.numero_atto, norma_data.data, norma_data.numero_articolo, norma_data.allegato]);

    const isPinnedQuick = isQuickNorm(quickNormParams);

    const handleToggleQuickNorm = () => {
        if (isPinnedQuick) {
            removeQuickNormByParams(quickNormParams);
            showToast('Rimosso dalle norme rapide', 'info');
            return;
        }
        const label = `Art. ${norma_data.numero_articolo}${norma_data.allegato ? ` (All. ${norma_data.allegato})` : ''} ${norma_data.tipo_atto}${norma_data.numero_atto ? ` n. ${norma_data.numero_atto}` : ''}`;
        addQuickNorm(label, quickNormParams);
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

    const handleMobileCopy = async () => {
        try {
            const plainText = (article_text || '').replace(/<[^>]+>/g, '').replace(/\n/g, ' ');
            const citation = `\n\n---\nArt. ${norma_data.numero_articolo} ${norma_data.tipo_atto}${norma_data.numero_atto ? ` n. ${norma_data.numero_atto}` : ''}`;
            await navigator.clipboard.writeText(plainText + citation);
            showToast('Testo copiato', 'success');
        } catch {
            showToast('Errore durante la copia', 'error');
        }
    };

    const handleAddNote = (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const anchor = noteAnchor;
        const targetArticleId = anchor?.scopedArticleId ?? uniqueArticleId;
        const anchorPayload = anchor
            ? { anchorText: anchor.anchorText, startOffset: anchor.startOffset }
            : undefined;
        addAnnotation(itemKey, targetArticleId, trimmed, anchorPayload);
        setNoteAnchor(null);
        showToast(anchor ? 'Nota ancorata al testo' : 'Nota aggiunta', 'success');
    };

    const downloadTxt = (content: string, filenameBase: string) => {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${filenameBase}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const slugify = (s: string) =>
        s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    const articleSlug = () =>
        slugify(`${norma_data.tipo_atto}-art-${norma_data.numero_articolo}`) || 'articolo';

    const articleHeader = (kind: 'Evidenziazioni' | 'Note') => [
        `${kind} — Art. ${norma_data.numero_articolo}${norma_data.allegato ? ` (Allegato ${norma_data.allegato})` : ''}`,
        `${norma_data.tipo_atto}${norma_data.numero_atto ? ` n. ${norma_data.numero_atto}` : ''}${norma_data.data ? ` del ${norma_data.data}` : ''}`,
        `Esportato il ${new Date().toLocaleString('it-IT')}`,
        '─'.repeat(60),
        '',
    ].join('\n');

    const handleExportNotesTxt = () => {
        if (allPanelAnnotations.length === 0) {
            showToast('Nessuna nota da esportare', 'info');
            return;
        }
        const body = allPanelAnnotations.map((n, i) => {
            const lines = [`${i + 1}. ${n.text}`];
            if (n.anchorText) lines.push(`   Ancorata a: "${n.anchorText}"`);
            return lines.join('\n');
        }).join('\n\n');
        downloadTxt(articleHeader('Note') + body + '\n', `note-${articleSlug()}`);
        showToast(`Esportate ${allPanelAnnotations.length} note`, 'success');
    };

    const handleExportHighlightsTxt = () => {
        if (allPanelHighlights.length === 0) {
            showToast('Nessuna evidenziazione da esportare', 'info');
            return;
        }
        const body = allPanelHighlights.map((h, i) => `${i + 1}. [${h.color}] ${h.text}`).join('\n\n');
        downloadTxt(articleHeader('Evidenziazioni') + body + '\n', `evidenziazioni-${articleSlug()}`);
        showToast(`Esportate ${allPanelHighlights.length} evidenziazioni`, 'success');
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
    // Shows a tooltip-style composer anchored on the selection itself; the
    // full Peek panel stays reserved for the toolbar button (list + free compose).
    const handlePopupAddNote = (text: string, startOffset: number, rect: { x: number; y: number; width: number; height: number }) => {
        setNoteAnchor({ anchorText: text, startOffset, scopedArticleId: uniqueArticleId });
        setComposerRect(rect);
    };

    // Brocardi sub-sections: same tooltip-composer flow as the article body.
    // The anchor offset is relative to the sub-section's textContent, so the
    // scopedArticleId carries the sub-section identifier.
    const handleBrocardiAddNote = (scopedArticleId: string, text: string, startOffset: number, rect: { x: number; y: number; width: number; height: number }) => {
        setNoteAnchor({ anchorText: text, startOffset, scopedArticleId });
        setComposerRect(rect);
    };

    const closeInlineComposer = () => {
        setNoteAnchor(null);
        setComposerRect(null);
    };

    const commitInlineNote = (text: string) => {
        handleAddNote(text);
        setComposerRect(null);
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

    const handleCompare = () => {
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
        const state = getCompareState();
        if (state.leftArticle && !state.rightArticle) {
            showToast('Articolo aggiunto. Seleziona un altro articolo per completare il confronto.', 'info');
        } else if (state.isOpen && state.leftArticle && state.rightArticle) {
            showToast('Confronto pronto!', 'success');
        }
    };

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
            <ReadingToolbar
                normaData={norma_data}
                versionInfo={versionInfo}
                url={url}
                articleText={article_text || ''}
                isNotesPeekOpen={isPeekOpen}
                notesButtonRef={setNotesButtonEl}
                notesCount={allPanelAnnotations.length}
                isHighlightsPeekOpen={isHighlightsPeekOpen}
                highlightsButtonRef={setHighlightsButtonEl}
                highlightsCount={allPanelHighlights.length}
                showMoreMenu={showMoreMenu}
                onToggleNotes={() => setIsPeekOpen(v => !v)}
                onToggleHighlightsPeek={() => setIsHighlightsPeekOpen(v => !v)}
                onToggleMoreMenu={setShowMoreMenu}
                isPinnedQuick={isPinnedQuick}
                onToggleQuickNorm={handleToggleQuickNorm}
                onMobileCopy={handleMobileCopy}
                onOpenStudyMode={onOpenStudyMode}
                onOpenCopyModal={() => setShowCopyModal(true)}
                onOpenDossier={() => setShowDossierModal(true)}
                onShareLink={handleShareLink}
                onOpenAdvancedExport={() => setShowAdvancedExport(true)}
                onOpenVersionInput={() => setShowVersionInput(true)}
                onCompare={handleCompare}
            />

            <NotesPeekPanel
                isOpen={isPeekOpen}
                anchorEl={notesButtonEl}
                annotations={allPanelAnnotations}
                articleLabel={`Art. ${norma_data.numero_articolo}${norma_data.allegato ? ` (All. ${norma_data.allegato})` : ''}`}
                noteAnchor={noteAnchor}
                onClose={() => setIsPeekOpen(false)}
                onAddNote={handleAddNote}
                onUpdateNote={updateAnnotation}
                onRemoveNote={removeAnnotation}
                onClearAnchor={() => setNoteAnchor(null)}
                onOpenStudyMode={onOpenStudyMode}
                onExportTxt={handleExportNotesTxt}
            />

            <HighlightsActionsPicker
                isOpen={isHighlightsPeekOpen}
                anchorEl={highlightsButtonEl}
                highlightsCount={allPanelHighlights.length}
                highlightsHidden={highlightsHidden}
                onClose={() => setIsHighlightsPeekOpen(false)}
                onToggleVisibility={() => setHighlightsHidden(v => !v)}
                onExportTxt={handleExportHighlightsTxt}
            />

            {inlineNote && (
                <InlineNotePopover
                    note={inlineNote.note}
                    anchorEl={inlineNote.anchorEl}
                    onClose={() => setInlineNote(null)}
                    onUpdate={updateAnnotation}
                    onRemove={removeAnnotation}
                />
            )}

            {composerRect && noteAnchor && (
                <InlineNoteComposer
                    anchorRect={composerRect}
                    anchorText={noteAnchor.anchorText}
                    onSave={commitInlineNote}
                    onClose={closeInlineComposer}
                />
            )}

            <ArticleBody
                contentRef={contentRef}
                itemKey={itemKey}
                processedContent={processedContent}
                panelHighlights={allPanelHighlights}
                onPopupHighlight={handlePopupHighlight}
                onPopupAddNote={handlePopupAddNote}
                onPopupCopy={handlePopupCopy}
                onRemoveHighlight={removeHighlight}
            />

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
