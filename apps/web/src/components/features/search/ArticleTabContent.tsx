import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import type { ArticleData, SearchParams } from '../../../types';
import { CaseLawSection } from './CaseLawSection';
import { ExternalLink } from 'lucide-react';
import { AskMerltEntry } from './AskMerltEntry';
import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { AddToDossierPopover } from '../dossier/AddToDossierPopover';
import { ArticleCardsRow, type ArticleCardsHandle } from '../studia/ArticleCardsRow';
import { offersNewCard } from '../studia/articleCardsOffer';
import { Toast } from '../../ui/Toast';
import { CopyModal, type CopyOptions } from '../../ui/CopyModal';
import { AdvancedExportModal } from '../../ui/AdvancedExportModal';
import { CitationPreviewPopup } from '../../ui/CitationPreviewPopup';
import { DecisionPreviewPopup } from '../../ui/DecisionPreviewPopup';
import { useDecisionLinks } from '../../../hooks/useDecisionLinks';
import { useCitationPreview } from '../../../hooks/useCitationPreview';
import { useCitationLinks } from '../../../hooks/useCitationLinks';
import { wrapCitationsInHtml, type ParsedCitationData } from '../../../utils/citationMatcher';
import { wrapDecisionCitationsInHtml } from '../../../utils/decisionCitationMatcher';
import { openCompareWithArticle, getCompareState } from '../../../hooks/useCompare';
import { useAnnotationActions } from '../../../hooks/useAnnotationActions';
import { useInlineNoteAnchors } from '../../../hooks/useInlineNoteAnchors';
import { useArticleMarkers } from '../../../hooks/useArticleMarkers';
import { ReadingToolbar } from './ReadingToolbar';
import { NotesPeekPanel } from './NotesPeekPanel';
import { HighlightsActionsPicker } from './HighlightsActionsPicker';
import { InlineNotePopover } from './InlineNotePopover';
import { InlineNoteComposer } from './InlineNoteComposer';
import { ArticleBody } from './ArticleBody';
import { closeFindWindow, openFindWindow } from '../../../utils/findWindowControl';
import { useFindWindowScopedTo } from '../../../hooks/useFindWindowScopedTo';
import { quickNormParamsOf } from '../../../utils/quickNormParams';
import { ArticleDiscussionPanel } from './ArticleDiscussionPanel';
import { UpdateNotePopover } from './UpdateNotePopover';
import { BlockAnnotationsPopover } from './BlockAnnotationsPopover';
import { LooseHighlightsList } from './LooseHighlightsList';
import { useArticleTextInteractions } from '../../../hooks/useArticleTextInteractions';
import { getRubricText, getUpdateNoteParagraphs, isNotice, parseArticleStructure } from '../../../utils/articleStructure';
import { PluginSlot } from '../../../plugins/PluginSlot';
import { MERLT_EVENT_TYPES, publishMerltEvent } from '../../../features/merlt/merltEventBus';
import { useMerltFeatures } from '../../../features/merlt/useMerltFeatures';
import { useDevMode } from '../../../features/devMode/useDevMode';
import { sendNerFeedback } from '../../../services/merltService';
import type { NerFeedbackType, NerCorrectReference } from '../../../services/merltService';
import { buildArticleXrefNerPayload } from './articleXrefNer';
import { MissedCitationReporter } from '../../../features/merlt/ner/MissedCitationReporter';
import { buildMissedNerPayload, MISSED_SELECTION_MAX } from '../../../features/merlt/ner/missedCitation';
import type { NerReference } from '../../../features/merlt/ner/NerReferenceEditor';
import { describeBlock, groupAnnotationsByBlock, hasAnnotations, highlightsWithoutSign, type LocatedThread } from '../../../utils/articleAnnotations';
import type { Annotation, Highlight } from '../../../types';
import { buildItemKey, uniqueArticleIdFromNorma } from '../../../utils/normaKeys';
import { citeNorm, shortNorm } from '../../../utils/sources';
import { downloadTxt, highlightsTxt, notesTxt, slugify } from '../../../utils/annotationExport';
import { buildSearchDeepLink } from '../../../utils/deepLinks';
import { notificationService } from '../../../services/notificationService';
import { isAuthenticated } from '../../../services/authService';
import { useDiscussionWiring } from '../../../hooks/useDiscussionWiring';
import { useRegisterFindRoot } from '../../../hooks/useRegisterFindRoot';
import { plainText } from '../../../utils/threadPassages';
import { PassageThreadsStatus } from './PassageThreadsStatus';
import { VersionBanner } from './VersionBanner';
import { TextAtDateDialog } from './TextAtDateDialog';
import { formatNormCitation, unversionedCitation, withCitation } from '../../../utils/citation';
import { copyNormLink, linkPinDay, normLink, normLinkToast } from '../../../utils/normattivaLink';
import { formatDateForDisplay, todayInRome } from '../../../utils/dateUtils';
import {
    READ_ONLY_REASON,
    buildTextAtDateParams,
    describeVersion,
    isEuropeanAct,
    requestIsHistorical,
    versionKey,
    versionTabSuffix,
    type BannerAction,
    type TextAtDateChoice,
} from '../../../utils/versionDisplay';

// What a past text is shown with in place of the reader's marks (stable, so the
// memoised rendering does not run again for a fresh empty array).
const NO_HIGHLIGHTS: Highlight[] = [];
const NO_ANNOTATIONS: Annotation[] = [];
const NO_THREADS: LocatedThread[] = [];

interface ArticleTabContentProps {
    data: ArticleData;
    onCrossReferenceNavigate?: (articleNumber: string, normaData: ArticleData['norma_data']) => void;
    onOpenStudyMode?: () => void;
    /**
     * Where this article sits in the workspace, so a citation jump can record
     * the way back. Surfaces outside the workspace (the dossier reader) leave
     * it undefined and simply do not push — there is no tab to return to.
     * A practice's row adds its `articleKey` (`practiceArticleKey`), so going back to a past text
     * reveals that row, not the text in force (carry-over ruling 12).
     */
    readingOrigin?: { tabId: string; blockId: string; articleKey?: string };
    /**
     * The host this article is read in when it has no act to come back to (a preview): a decision
     * opened from its «Giurisprudenza» opens beside that host, with no way-back entry.
     * `readingOrigin` wins when both are given.
     */
    tabId?: string;
    /**
     * The id the find window knows this reading place by, when it is not the place's own: a light
     * window beside a practice's table reads under its own id (its way back and its focus) and is
     * found under its practice's, so «Questa pratica» searches it (spec §6.6). Only the find
     * window's registration, pressed state and opener read it; the text root is untouched.
     */
    findHostId?: string;
    /**
     * `row` (default): the article as the table's row shows it. `beside`: in a light
     * window (spec §4.1): the compact reading bar, and none of Studio,
     * the Studia row, «Chiedi a MERL-T» or the graph rail. Only the siblings of the text root change.
     */
    variant?: 'row' | 'beside';
}

export function ArticleTabContent({ data, onCrossReferenceNavigate, onOpenStudyMode, readingOrigin, tabId, findHostId, variant = 'row' }: ArticleTabContentProps) {
    const isBeside = variant === 'beside';
    const { article_text, norma_data, url, versionInfo } = data;
    // Flattened to scalars so the citation listener effect below depends on
    // stable values: an inline `readingOrigin` object would change identity on
    // every render and re-attach the listeners each time.
    const originTabId = readingOrigin?.tabId;
    const originBlockId = readingOrigin?.blockId;
    const originArticleKey = readingOrigin?.articleKey;
    // Subscribe only to the store slices this component actually reads.
    // Action references are already stable across store lifetimes; the
    // useShallow on the whole picked object means a change to unrelated
    // state (bookmarks, dossiers…) no longer re-renders us.
    const {
        annotations,
        removeAnnotation,
        updateAnnotation,
        loadAnnotationsForArticle,
        highlights,
        removeHighlight,
        loadHighlightsForArticle,
        triggerSearch,
        addQuickNorm,
        removeQuickNormByParams,
        isQuickNorm,
        bookmarks,
    } = useAppStore(useShallow(s => ({
        annotations: s.annotations,
        removeAnnotation: s.removeAnnotation,
        updateAnnotation: s.updateAnnotation,
        loadAnnotationsForArticle: s.loadAnnotationsForArticle,
        highlights: s.highlights,
        removeHighlight: s.removeHighlight,
        loadHighlightsForArticle: s.loadHighlightsForArticle,
        triggerSearch: s.triggerSearch,
        addQuickNorm: s.addQuickNorm,
        removeQuickNormByParams: s.removeQuickNormByParams,
        isQuickNorm: s.isQuickNorm,
        bookmarks: s.bookmarks,
    })));

    const [dossierPopoverOpen, setDossierPopoverOpen] = useState(false);
    // State (not ref) so the popover re-reads the anchor when the button
    // actually mounts — same reasoning as notesButtonEl below (gotcha #13).
    const [dossierBtnEl, setDossierBtnEl] = useState<HTMLButtonElement | null>(null);
    const [isPeekOpen, setIsPeekOpen] = useState(false);
    // State (not ref) so the popover re-reads the anchor when the button
    // actually mounts. Using ref.current in render triggers the
    // react-hooks/refs lint and can miss the post-mount update.
    const [notesButtonEl, setNotesButtonEl] = useState<HTMLButtonElement | null>(null);
    const [showCopyModal, setShowCopyModal] = useState(false);
    const [showAdvancedExport, setShowAdvancedExport] = useState(false);
    const [showVersionInput, setShowVersionInput] = useState(false);
    const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
    const [isHighlightsPeekOpen, setIsHighlightsPeekOpen] = useState(false);
    const [highlightsButtonEl, setHighlightsButtonEl] = useState<HTMLButtonElement | null>(null);
    // Local visibility toggle: when true, the article body keeps the markup
    // (so highlights aren't lost) but renders `.highlight-mark` transparent
    // via the `.highlights-hidden` class scoped to contentRef. Per-article,
    // not persisted across sessions.
    const [highlightsHidden, setHighlightsHidden] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);
    // The find window searches ArticleBody's text root only: not the case law below it.
    const textRootRef = useRef<HTMLDivElement>(null);
    // The cards row owns the card form; the selection popup opens it through this.
    const cardsRowRef = useRef<ArticleCardsHandle>(null);
    // Loop β #2 "missed" surface: a selection the user flagged as a legal
    // reference the citation detector did not link. Offset is in the same
    // marker projection as highlights; the rect was captured before the
    // selection was cleared.
    const [missedCitation, setMissedCitation] = useState<{
        text: string;
        startOffset: number;
        rect: { x: number; y: number; width: number; height: number };
    } | null>(null);
    // Citation preview hook - destructure to get stable function references
    const citationPreviewState = useCitationPreview();
    const { showPreview, hidePreview } = citationPreviewState;
    const isHoveringPopupRef = useRef(false);

    // Full-consent contributors in the development mode get the inline NER feedback bar on the
    // citation preview popup (surface=article_xref, Loop β #2): a citation report, like the
    // selection popup's. Gated strictly on canContribute (level === 'full'); never widen this.
    // qaAskable drives the in-article "Chiedi su questo articolo" entry (Slice 3 §3.5): shown
    // from `basic`; at `none` nothing (the consent is asked once, by the consent screen).
    const { canContribute, qaAskable, merltEnabled } = useMerltFeatures();
    // The MERL-T surfaces on an article (the graph rail, «Chiedi su questo articolo», the citation
    // reports) are drawn in the development mode only. It hides, never grants: the consent gates
    // above still decide. The tracker, the Massimario's panel and the implicit citation feedback
    // are collection and content for every reader, and stay as they are.
    const devMode = useDevMode();

    const itemKey = useMemo(() => buildItemKey(norma_data), [norma_data]);
    // The find window's target for this article (spec §13.1): the host this surface reads in,
    // `readingOrigin` winning like everywhere else it is given, so the root lands under the host and
    // key the scope computes from the store. No host (a
    // preview outside the practices, such as the palette's result card) registers nothing.
    const findTargetKey = useMemo(() => `${itemKey}|${versionKey(norma_data)}`, [itemKey, norma_data]);
    const findHost = findHostId ?? originTabId ?? tabId;
    useRegisterFindRoot(findHost, findTargetKey, shortNorm(norma_data), textRootRef);
    // Exact (R3): «Cerca nel testo» is a menu entry, and on a practice the window covers with no text pointed at it
    // points the window here; only on this very text does it say «Chiudi».
    const isFindOpen = useFindWindowScopedTo(findHost, findTargetKey, true);
    const isSavedArticle = useMemo(
        () => bookmarks.some(bookmark => bookmark.normaKey === itemKey),
        [bookmarks, itemKey],
    );

    const uniqueArticleId = useMemo(() => uniqueArticleIdFromNorma(norma_data), [norma_data]);

    // What the source says about the text that came back, and what that switches
    // off. A past text is a reading: notes, highlights and discussions are keyed
    // by article, not by version, so they would attach to the wrong words.
    const display = useMemo(() => describeVersion(data.validity, norma_data, data.upcoming), [data.validity, norma_data, data.upcoming]);
    const readOnly = display.readOnly;
    // The study cards anchor to the text in force only.
    const cardsHistorical = readOnly || !!versionInfo?.isHistorical;
    // Where a decision opened from the article's case law walks back to
    const decisionBackEntry = useMemo(() => originTabId && originBlockId ? {
        tabId: originTabId,
        blockId: originBlockId,
        articleId: uniqueArticleIdFromNorma(norma_data),
        ...(originArticleKey ? { articleKey: originArticleKey } : {}),
        label: shortNorm(norma_data),
    } : undefined, [originTabId, originBlockId, originArticleKey, norma_data]);
    const requestedDate = norma_data.data_versione?.trim() || undefined;
    // "art. 1284 c.c., nel testo in vigore …" for a past text; null for the text in force.
    const citationNow = () => (display.canCite
        ? formatNormCitation({
            norma: norma_data,
            validity: display.citeAs ?? data.validity,
            requestedDate,
            original: !requestedDate && requestIsHistorical(norma_data),
            consultedAt: todayInRome(),
        })
        : null);

    const discussionAnchor = useMemo(() => ({
        normaKey: itemKey,
        articleId: uniqueArticleId,
        articleLabel: norma_data.numero_articolo,
        version: norma_data.versione || norma_data.data_versione,
    }), [itemKey, uniqueArticleId, norma_data.numero_articolo, norma_data.versione, norma_data.data_versione]);

    const plainArticle = useMemo(() => plainText(article_text || ''), [article_text]);
    const discussion = useDiscussionWiring({
        anchor: { normaKey: discussionAnchor.normaKey, articleId: discussionAnchor.articleId },
        text: article_text || '',
        plain: plainArticle,
        enabled: Boolean(discussionAnchor.articleId) && Boolean(article_text) && !readOnly,
        contentRef,
        onInvalidSelection: () => showToast('Non è possibile aprire una glossa su questa selezione', 'error'),
    });
    const { locatedThreads, textHash, focusedThreadId } = discussion;

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

    // Panel list (notes + highlights summary) includes the article's sub-sections (the
    // `<article>/<section>` ids the Brocardi sections were marked under, D-078), so users see
    // everything they've saved for this article in one place.
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

    const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
        setToastMessage({ text, type });
    };

    // The reader's marks, as every surface that renders them does them (hooks/useAnnotationActions).
    // The MERL-T events are the article's own.
    const {
        noteAnchor, composerRect, clearAnchor,
        handlePopupHighlight, handlePopupAddNote, handleAddNote, closeComposer, commitComposer,
    } = useAnnotationActions({
        key: itemKey,
        articleId: uniqueArticleId,
        highlights: articleHighlights,
        showToast,
        enabled: !readOnly,
        onHighlightAdded: (text, color, startOffset) => publishMerltEvent({
            interaction_type: MERLT_EVENT_TYPES.highlightCreated,
            article_urn: norma_data.urn,
            metadata: { anchor_text: text, color, start_offset: startOffset, text_length: text.length },
        }),
        onNoteSelection: (text, startOffset) => publishMerltEvent({
            interaction_type: MERLT_EVENT_TYPES.textSelected,
            article_urn: norma_data.urn,
            metadata: { source: 'selection_note', start_offset: startOffset, text_length: text.length },
        }),
        onNoteAdded: ({ targetArticleId, anchor, text }) => publishMerltEvent({
            interaction_type: MERLT_EVENT_TYPES.annotationCreated,
            article_urn: norma_data.urn,
            metadata: {
                source: 'annotation',
                scoped_article_id: targetArticleId,
                anchored: Boolean(anchor),
                anchor_text: anchor?.anchorText ?? '',
                start_offset: anchor?.startOffset ?? 0,
                // Never the note's words: MERL-T does not collect them (the owner, 18 October 2026).
                text_length: text.length,
            },
        }),
    });
    const { inlineNote, closeInlineNote } = useInlineNoteAnchors(contentRef, itemAnnotations);

    // Fetch persisted highlights + annotations from the Node backend when the
    // article first mounts (or when the user switches to a different article
    // inside the same row). The store actions guard against racing
    // against in-flight optimistic inserts by replacing only the entries for
    // this specific (normaKey, articleId) pair.
    useEffect(() => {
        if (!itemKey || !uniqueArticleId) return;
        loadHighlightsForArticle(itemKey, uniqueArticleId);
        loadAnnotationsForArticle(itemKey, uniqueArticleId);
    }, [itemKey, uniqueArticleId, loadHighlightsForArticle, loadAnnotationsForArticle]);

    // Change tracking, for saved (bookmarked) articles only: register the
    // snapshot the reader is showing and let the server say whether the text
    // moved since the last one. Keyed on identity and on the saved flag —
    // bookmarking starts the watch — and the body is read through a ref so a
    // re-render that hands down the same text as a new object does not post
    // it again. The check sends the full text on purpose: an earlier version
    // sent only norma_data, so a changed article was never detected.
    // The watch key (buildItemKey) carries no version segment, so only the
    // current text may be registered: a historical or "originale" view of a
    // bookmarked article would otherwise read as a change and overwrite the
    // stored text with the old one — a false alert on the way in and another
    // on the way back to vigente.
    const isCurrentText = !versionInfo?.isHistorical
        && !readOnly
        && (norma_data.versione ?? 'vigente') === 'vigente'
        && !norma_data.data_versione;
    const latestSnapshotRef = useRef({ norma_data, article_text });
    useEffect(() => {
        latestSnapshotRef.current = { norma_data, article_text };
    });
    useEffect(() => {
        if (!itemKey || !isSavedArticle || !isCurrentText || !isAuthenticated()) return;
        const snapshot = latestSnapshotRef.current;
        notificationService.checkNorma(itemKey, {
            norma_data: snapshot.norma_data,
            article_text: snapshot.article_text || '',
        })
            .then(result => {
                if (result.changed) {
                    setToastMessage({ text: 'Questa norma salvata è cambiata dall’ultima consultazione', type: 'info' });
                }
            })
            .catch(error => console.debug('Norma change check unavailable:', error));
    }, [itemKey, isSavedArticle, isCurrentText]);

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

    const quickNormParams = useMemo(
        () => quickNormParamsOf(norma_data),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the fields it reads, not the object
        [norma_data.tipo_atto, norma_data.numero_atto, norma_data.data, norma_data.numero_articolo, norma_data.allegato],
    );

    const isPinnedQuick = isQuickNorm(quickNormParams);

    const handleToggleQuickNorm = () => {
        if (readOnly) return;
        if (isPinnedQuick) {
            removeQuickNormByParams(quickNormParams);
            publishMerltEvent({
                interaction_type: MERLT_EVENT_TYPES.bookmarkDeleted,
                article_urn: norma_data.urn,
                metadata: { source: 'quick_norm', params: quickNormParams },
            });
            showToast('Rimosso dalle norme rapide', 'info');
            return;
        }
        const label = shortNorm(norma_data);
        addQuickNorm(label, quickNormParams);
        publishMerltEvent({
            interaction_type: MERLT_EVENT_TYPES.bookmarkCreated,
            article_urn: norma_data.urn,
            metadata: { source: 'quick_norm', label, params: quickNormParams },
        });
        showToast('Aggiunto alle norme rapide', 'success');
    };

    const handleAdvancedCopy = async (options: CopyOptions) => {
        if (!display.canCopyOrSave) {
            showToast(display.copyBlockedReason ?? '', 'info');
            return;
        }
        try {
            let textToCopy = '';

            if (options.includeText) {
                const plainText = (article_text || '').replace(/<[^>]+>/g, '').replace(/\n/g, ' ');
                textToCopy += plainText;
            }

            if (options.includeCitation) {
                // Every copy starts with its citation: a past text's version, or the text in force (D8).
                textToCopy = withCitation(textToCopy, citationNow(), unversionedCitation(norma_data, todayInRome()));
            }

            if (options.includeNotes && !readOnly && allPanelAnnotations.length > 0) {
                textToCopy += `\n\nNote personali:\n${allPanelAnnotations.map((n, i) => `${i + 1}. ${n.text}`).join('\n')}`;
            }

            if (options.includeHighlights && !readOnly && allPanelHighlights.length > 0) {
                textToCopy += `\n\nEvidenziazioni:\n${allPanelHighlights.map((h, i) => `${i + 1}. "${h.text}"`).join('\n')}`;
            }

            await navigator.clipboard.writeText(textToCopy);
            showToast('Contenuto copiato negli appunti', 'success');
        } catch {
            showToast('Errore durante la copia', 'error');
        }
    };

    const handleMobileCopy = async () => {
        if (!display.canCopyOrSave) {
            showToast(display.copyBlockedReason ?? '', 'info');
            return;
        }
        try {
            const plainText = (article_text || '').replace(/<[^>]+>/g, '').replace(/\n/g, ' ');
            await navigator.clipboard.writeText(withCitation(plainText, citationNow(), unversionedCitation(norma_data, todayInRome())));
            showToast('Testo copiato', 'success');
        } catch {
            showToast('Errore durante la copia', 'error');
        }
    };

    const articleSlug = () =>
        slugify(`${norma_data.tipo_atto}-art-${norma_data.numero_articolo}`) || 'articolo';

    const handleExportNotesTxt = () => {
        if (allPanelAnnotations.length === 0) {
            showToast('Nessuna nota da esportare', 'info');
            return;
        }
        downloadTxt(notesTxt(citeNorm(norma_data), allPanelAnnotations), `note-${articleSlug()}`);
        showToast(`Esportate ${allPanelAnnotations.length} note`, 'success');
    };

    const handleExportHighlightsTxt = () => {
        if (allPanelHighlights.length === 0) {
            showToast('Nessuna evidenziazione da esportare', 'info');
            return;
        }
        downloadTxt(highlightsTxt(citeNorm(norma_data), allPanelHighlights), `evidenziazioni-${articleSlug()}`);
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
            };
            const shareUrl = buildSearchDeepLink(params, uniqueArticleId);
            await navigator.clipboard.writeText(shareUrl);
            showToast('Link copiato negli appunti', 'success');
        } catch {
            showToast('Errore durante la copia del link', 'error');
        }
    };

    // «Copia link Normattiva»: the address the API returned, with its version marker; a past
    // text's link reads as its version, as «Copia citazione» says it.
    const copyLink = async () => {
        if (!display.canCopyOrSave) {
            showToast(display.copyBlockedReason ?? '', 'info');
            return;
        }
        const pinDay = linkPinDay(norma_data, display.citeAs ?? data.validity, data.upcoming, todayInRome());
        const link = normLink(norma_data, citationNow(), pinDay);
        if (!link) return;
        try {
            await copyNormLink(link);
            showToast(normLinkToast(link), 'success');
        } catch {
            showToast('Errore durante la copia del link', 'error');
        }
    };
    const handleCopyLink = normLink(norma_data, null) ? copyLink : undefined;

    // Handler for SelectionPopup copy action. The popup stays on a text that may
    // not be copied (a reading), so the table is asked here, and the click says why.
    const handlePopupCopy = async (text: string) => {
        if (!display.canCopyOrSave) {
            showToast(display.copyBlockedReason ?? '', 'info');
            return;
        }
        try {
            await navigator.clipboard.writeText(withCitation(text, citationNow(), unversionedCitation(norma_data, todayInRome())));
            showToast('Testo copiato con citazione', 'success');
        } catch {
            showToast('Errore durante la copia', 'error');
        }
    };

    // Opens the previewed citation in the practice
    const handleOpenCitation = useCallback((citation: ParsedCitationData) => {
        // MERLT-1.9: emit citation_click for the bus tracker. The target URN
        // is null at click time (resolution happens later via triggerSearch);
        // the BFF accepts null target and forwards it as such.
        const citationText = [
            citation.act_type,
            citation.act_number ? `n. ${citation.act_number}` : null,
            citation.article ? `art. ${citation.article}` : null,
        ].filter(Boolean).join(' ');
        publishMerltEvent({
            interaction_type: MERLT_EVENT_TYPES.citationClicked,
            article_urn: norma_data.urn,
            metadata: {
                source_urn: norma_data.urn,
                target_urn: null,
                citation_text: citationText,
                citation,
            },
        });
        // Loop β #2: the 'implicit' NER capture surface — clicking a citation
        // chip through to its article is a low-weight automatic CONFIRMATION that the
        // detected reference was real. Full-consent only, fire-and-forget.
        if (canContribute) {
            const implicitPayload = buildArticleXrefNerPayload({
                citation,
                articleUrn: norma_data.urn,
                articleText: article_text || '',
                matchText: citationText,
                feedbackType: 'confirmation',
                surface: 'implicit',
            });
            void sendNerFeedback(implicitPayload).catch((err) => {
                console.error('NER implicit feedback failed:', err);
            });
        }
        triggerSearch({
            act_type: citation.act_type,
            act_number: citation.act_number || '',
            date: citation.date || '',
            article: citation.article,
            version: 'vigente',
        });
    }, [norma_data.urn, article_text, canContribute, triggerSearch]);

    // Loop β #2: forward one NER correction/confirmation for the previewed
    // citation (surface=article_xref — the highest-volume capture surface).
    // Context window is ±500 chars of the SOURCE article around the citation
    // span (the privacy budget); fire-and-forget. Only reachable when the
    // popup renders the bar, which itself is gated on canContribute.
    const handleCitationNerFeedback = useCallback(
        (feedbackType: NerFeedbackType, correctReference?: NerCorrectReference) => {
            const citation = citationPreviewState.citation;
            if (!citation) return;

            const payload = buildArticleXrefNerPayload({
                citation,
                articleUrn: norma_data.urn,
                articleText: article_text || '',
                matchText: citationPreviewState.targetElement?.textContent ?? '',
                feedbackType,
                correctReference,
            });

            void sendNerFeedback(payload).catch((err) => {
                console.error('NER article_xref feedback failed:', err);
            });
        },
        [citationPreviewState.citation, citationPreviewState.targetElement, article_text, norma_data.urn],
    );

    // Loop β #2, surface=article_xref, feedbackType=missed: "Segnala come
    // citazione" from the selection popup. Only wired for full-consent
    // contributors (the prop stays undefined otherwise, so the popup hides the
    // action); SelectionPopup / ArticleBody stay free of MERL-T imports.
    const handlePopupReportCitation = (text: string, startOffset: number, rect: { x: number; y: number; width: number; height: number }) => {
        if (text.length > MISSED_SELECTION_MAX) {
            showToast(`Seleziona solo il riferimento normativo (al massimo ${MISSED_SELECTION_MAX} caratteri).`, 'info');
            return;
        }
        setMissedCitation({ text, startOffset, rect });
    };

    const submitMissedCitation = (reference: NerReference) => {
        if (!missedCitation) return;
        const payload = buildMissedNerPayload({
            articleUrn: norma_data.urn,
            articleText: article_text || '',
            selectedText: missedCitation.text,
            startOffset: missedCitation.startOffset,
            actType: reference.actType,
            article: reference.article,
        });
        setMissedCitation(null);
        void sendNerFeedback(payload)
            .then(() => showToast('Segnalazione inviata. Grazie.', 'success'))
            .catch((err) => {
                console.error('NER missed-citation feedback failed:', err);
                showToast('Segnalazione non registrata. Riprova.', 'error');
            });
    };

    const handleCompare = () => {
        const label = `${shortNorm(norma_data)}${versionTabSuffix({ version: norma_data.versione, versionDate: norma_data.data_versione })}`;
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

    const handleTextAtDate = (choice: TextAtDateChoice) => {
        setShowVersionInput(false);
        showToast(
            choice.kind === 'original' ? 'Ricerca del testo originale' : `Ricerca del testo al ${formatDateForDisplay(choice.date)}`,
            'info',
        );
        triggerSearch(buildTextAtDateParams(norma_data, choice));
    };

    const handleBannerAction = async (action: BannerAction) => {
        switch (action) {
            case 'go_current':
                triggerSearch(quickNormParams);
                break;
            case 'pick_date':
                setShowVersionInput(true);
                break;
            case 'open_next_day':
                if (display.banner?.nextDay) {
                    triggerSearch(buildTextAtDateParams(norma_data, { kind: 'date', date: display.banner.nextDay }));
                }
                break;
            case 'copy_link':
                await handleCopyLink?.();
                break;
            case 'copy_citation': {
                const citation = citationNow();
                if (!citation) return;
                try {
                    await navigator.clipboard.writeText(citation.long);
                    showToast('Citazione copiata', 'success');
                } catch {
                    showToast('Errore durante la copia', 'error');
                }
                break;
            }
        }
    };

    // The structure (heading, rubric, commi, items, Normattiva's modifications
    // and update notes) is read once per text; the shared useArticleMarkers
    // hook renders it with the highlights and note anchors (the dossier reader
    // and Study Mode use the same pair). Citation wrapping is article-specific
    // and happens after.
    const structure = useMemo(() => parseArticleStructure(article_text || ''), [article_text]);
    // A past text carries none of the reader's marks (see `display`).
    const shownHighlights = readOnly ? NO_HIGHLIGHTS : articleHighlights;
    const shownAnnotations = readOnly ? NO_ANNOTATIONS : itemAnnotations;
    const shownThreads = readOnly ? NO_THREADS : locatedThreads;
    const markedHtml = useArticleMarkers({
        rawText: article_text || '',
        highlights: shownHighlights,
        annotations: shownAnnotations,
        structure,
        signs: !readOnly,
        threads: shownThreads,
        focusedThreadId: readOnly ? null : focusedThreadId,
    });
    // What each block's sign counts, for the popover it opens (the renderer
    // derives the signs from the same inputs, through the same module).
    const blockGroups = useMemo(
        () => groupAnnotationsByBlock(article_text || '', structure, shownHighlights, shownAnnotations, shownThreads),
        [article_text, structure, shownHighlights, shownAnnotations, shownThreads],
    );
    // Highlights no sign can reach — those of a sub-section no longer shown (Brocardi's, D-078),
    // and those whose text changed — keep a list of their own, so they can still be removed.
    const looseHighlights = useMemo(
        () => (readOnly ? NO_HIGHLIGHTS : highlightsWithoutSign(allPanelHighlights, blockGroups)),
        [readOnly, allPanelHighlights, blockGroups],
    );

    // The norms the text cites are linked first; the decisions (Normattiva's update notes cite the
    // Corte costituzionale) take what the norm links leave.
    const processedContent = useMemo(
        () => wrapDecisionCitationsInHtml(wrapCitationsInHtml(markedHtml, norma_data)),
        [markedHtml, norma_data],
    );

    // "(119)" references open their AGGIORNAMENTO note; the notes at the bottom
    // fold; an annotation sign opens its block's notes and highlights.
    const { updatesOpen, openNote, closeNote, openBlock, closeBlock } = useArticleTextInteractions(contentRef, itemKey, {
        contentKey: processedContent,
        updatesOpenByDefault: display.updateNotesOpen,
    });
    const openGroup = openBlock === null ? undefined : blockGroups[openBlock];

    // Citation hover and click: a click jumps within the same act or opens a search, recording the
    // way back from this block first.
    const citationOrigin = useMemo(() => (originTabId && originBlockId
        ? {
            tabId: originTabId,
            blockId: originBlockId,
            articleId: uniqueArticleIdFromNorma(norma_data),
            ...(originArticleKey ? { articleKey: originArticleKey } : {}),
            label: shortNorm(norma_data),
        }
        : undefined), [originTabId, originBlockId, originArticleKey, norma_data]);
    const openCitation = useCallback((parsed: ParsedCitationData) => {
        // Navigate within same norma if possible
        if (parsed.act_type === norma_data.tipo_atto && parsed.act_number === norma_data.numero_atto) {
            onCrossReferenceNavigate?.(parsed.article, norma_data);
        } else {
            // Open in new search
            triggerSearch({
                act_type: parsed.act_type,
                act_number: parsed.act_number || '',
                date: parsed.date || '',
                article: parsed.article,
                version: 'vigente',
            });
        }
    }, [onCrossReferenceNavigate, norma_data, triggerSearch]);
    const decisionLinks = useDecisionLinks({ besideId: originTabId ?? tabId, origin: citationOrigin });
    useCitationLinks(contentRef, {
        onOpen: onCrossReferenceNavigate ? openCitation : undefined,
        origin: citationOrigin,
        showPreview,
        hidePreview,
        isHoveringPopupRef,
        decisions: decisionLinks.links,
    });

    // «Cerca sentenze sul tema dell'articolo» searches the Cassazione by the rubric, when the text has one:
    // not a notice the source served in its place (an article that did not exist yet, one repealed or
    // suppressed, an omission), whether or not the source's page said what the text is (`validity`).
    const rubric = useMemo(() => {
        if (!display.textVisible || data.validity?.state === 'abrogated') return null;
        const text = getRubricText(article_text || '', structure);
        return text && !isNotice(text) ? text : null;
    }, [display.textVisible, data.validity?.state, article_text, structure]);

    return (
        <div className="animate-in fade-in duration-200 relative">
            <ReadingToolbar
                normaData={norma_data}
                versionChip={display.chip}
                lockedReason={readOnly ? READ_ONLY_REASON : undefined}
                copyLockedReason={display.copyBlockedReason}
                url={url}
                articleText={article_text || ''}
                isNotesPeekOpen={isPeekOpen}
                notesButtonRef={setNotesButtonEl}
                notesCount={readOnly ? 0 : allPanelAnnotations.length}
                isHighlightsPeekOpen={isHighlightsPeekOpen}
                highlightsButtonRef={setHighlightsButtonEl}
                highlightsCount={readOnly ? 0 : allPanelHighlights.length}
                isDiscussionOpen={discussion.open}
                onToggleNotes={() => setIsPeekOpen(v => !v)}
                onToggleHighlightsPeek={() => setIsHighlightsPeekOpen(v => !v)}
                onToggleDiscussion={discussion.toggle}
                isPinnedQuick={isPinnedQuick}
                onToggleQuickNorm={handleToggleQuickNorm}
                onMobileCopy={handleMobileCopy}
                onOpenStudyMode={isBeside ? undefined : onOpenStudyMode}
                compact={isBeside}
                onOpenCopyModal={() => setShowCopyModal(true)}
                onOpenDossier={() => setDossierPopoverOpen(true)}
                dossierButtonRef={setDossierBtnEl}
                onShareLink={handleShareLink}
                onCopyLink={handleCopyLink}
                onOpenAdvancedExport={() => setShowAdvancedExport(true)}
                onOpenVersionInput={() => setShowVersionInput(true)}
                onCompare={handleCompare}
                find={display.textVisible ? {
                    isOpen: isFindOpen,
                    onToggle: (button, wasPressed) => (wasPressed
                        ? closeFindWindow()
                        : openFindWindow({ tabId: findHost, targetKey: findTargetKey, returnFocus: button })),
                } : undefined}
            />

            <NotesPeekPanel
                isOpen={isPeekOpen}
                anchorEl={notesButtonEl}
                annotations={allPanelAnnotations}
                articleLabel={shortNorm(norma_data)}
                noteAnchor={noteAnchor}
                onClose={() => setIsPeekOpen(false)}
                onAddNote={handleAddNote}
                onUpdateNote={updateAnnotation}
                onRemoveNote={removeAnnotation}
                onClearAnchor={clearAnchor}
                onOpenStudyMode={readOnly || isBeside ? undefined : onOpenStudyMode}
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
                    onClose={closeInlineNote}
                    onUpdate={updateAnnotation}
                    onRemove={removeAnnotation}
                />
            )}

            {composerRect && noteAnchor && (
                <InlineNoteComposer
                    anchorRect={composerRect}
                    anchorText={noteAnchor.anchorText}
                    onSave={commitComposer}
                    onClose={closeComposer}
                />
            )}

            {devMode && canContribute && missedCitation && (
                <MissedCitationReporter
                    anchorRect={missedCitation.rect}
                    selectedText={missedCitation.text}
                    onSubmit={submitMissedCitation}
                    onClose={() => setMissedCitation(null)}
                />
            )}

            {display.banner && (
                <VersionBanner
                    // No address of the source, no «Copia link Normattiva».
                    banner={handleCopyLink ? display.banner : { ...display.banner, actions: display.banner.actions.filter((a) => a !== 'copy_link') }}
                    onAction={handleBannerAction}
                    variant={display.textVisible ? 'banner' : 'state'}
                />
            )}

            {display.textVisible && (
                <ArticleBody
                    contentRef={contentRef}
                    textRootRef={textRootRef}
                    itemKey={itemKey}
                    processedContent={processedContent}
                    onPopupHighlight={handlePopupHighlight}
                    onPopupAddNote={handlePopupAddNote}
                    onPopupCopy={handlePopupCopy}
                    onPopupDiscuss={readOnly ? undefined : discussion.popupDiscuss}
                    onPopupReportCitation={devMode && canContribute && !readOnly ? handlePopupReportCitation : undefined}
                    onPopupCreateCard={!isBeside && offersNewCard(norma_data, cardsHistorical)
                        ? (text) => cardsRowRef.current?.createFromPassage(text)
                        : undefined}
                    updatesOpen={updatesOpen}
                    copyOnly={readOnly}
                />
            )}

            {!discussion.open && (
                <PassageThreadsStatus error={discussion.error} loading={discussion.loading} onRetry={discussion.reload} />
            )}

            <LooseHighlightsList highlights={looseHighlights} articleId={uniqueArticleId} onRemove={removeHighlight} />

            {openNote && structure.notes[openNote.id] && (
                <UpdateNotePopover
                    noteId={openNote.id}
                    paragraphs={getUpdateNoteParagraphs(article_text || '', structure.notes[openNote.id])}
                    anchorEl={openNote.anchorEl}
                    onClose={closeNote}
                />
            )}

            {openBlock !== null && hasAnnotations(openGroup) && (
                <BlockAnnotationsPopover
                    key={openBlock}
                    containerRef={contentRef}
                    blockIndex={openBlock}
                    blockLabel={describeBlock(article_text || '', structure.blocks[openBlock])}
                    group={openGroup}
                    contentKey={processedContent}
                    textHash={textHash}
                    onOpenThread={discussion.openThread}
                    onClose={closeBlock}
                    onUpdateNote={updateAnnotation}
                    onRemoveNote={removeAnnotation}
                    onRemoveHighlight={removeHighlight}
                />
            )}

            <ArticleDiscussionPanel
                anchor={discussionAnchor}
                label={`Art. ${discussionAnchor.articleLabel ?? discussionAnchor.articleId}`}
                articleUrn={norma_data.urn}
                {...discussion.panelProps}
            />

            {/* It asks about the article by its URN: on a past text the answer would describe the current one. */}
            {devMode && !readOnly && !isBeside && (
                <AskMerltEntry
                    merltEnabled={merltEnabled}
                    qaAskable={qaAskable}
                    articleUrn={norma_data.urn}
                    articleNumber={norma_data.numero_articolo}
                    actType={norma_data.tipo_atto}
                    actNumber={norma_data.numero_atto}
                    actDate={norma_data.data}
                    actRealType={norma_data.tipo_atto_reale}
                    annex={norma_data.allegato}
                />
            )}

            {!isBeside && (
                <ArticleCardsRow
                    ref={cardsRowRef}
                    norma={norma_data}
                    articleText={article_text || ''}
                    structure={structure}
                    historical={cardsHistorical}
                />
            )}

            <PluginSlot
                slot="article_content_after"
                props={{
                    articleUrn: data.norma_data.urn,
                    containerRef: contentRef,
                    validity: data.validity,
                    isHistorical: readOnly,
                }}
            />

            {devMode && !isBeside && (
                <PluginSlot
                    slot="article_sidebar"
                    props={{ articleUrn: data.norma_data.urn }}
                />
            )}

            {/* «Giurisprudenza»: the Massimario's reviews, the Cassazione on request and a topic search
                by the rubric. It stays on a past text. */}
            <CaseLawSection
                norma={norma_data}
                topic={rubric}
                articleUrn={norma_data.urn}
                tabId={originTabId ?? tabId}
                backEntry={decisionBackEntry}
                isHistorical={readOnly}
            />

            {url && (
                // 44 px to tap on a phone (M1), the words as they were: the row's padding goes into the link there.
                <div className="mt-4 md:pt-3 border-t border-slate-100 dark:border-slate-800">
                    <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-[44px] items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline md:min-h-0"
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

            <AddToDossierPopover
                isOpen={dossierPopoverOpen}
                anchorEl={dossierBtnEl}
                onClose={() => setDossierPopoverOpen(false)}
                norma={norma_data}
                onAdded={(_dossierId, title) => showToast(`Aggiunto a «${title}»`, 'success')}
                onDuplicate={(title) => showToast(`Già presente in «${title}»`, 'info')}
            />

            <CopyModal
                isOpen={showCopyModal}
                onClose={() => setShowCopyModal(false)}
                onCopy={handleAdvancedCopy}
                hasNotes={!readOnly && allPanelAnnotations.length > 0}
                hasHighlights={!readOnly && allPanelHighlights.length > 0}
            />

            <AdvancedExportModal
                isOpen={showAdvancedExport}
                onClose={() => setShowAdvancedExport(false)}
                articleData={data}
                annotations={readOnly ? NO_ANNOTATIONS : allPanelAnnotations}
                highlights={readOnly ? NO_HIGHLIGHTS : allPanelHighlights}
            />

            <TextAtDateDialog
                isOpen={showVersionInput}
                onClose={() => setShowVersionInput(false)}
                onConfirm={handleTextAtDate}
                euAct={isEuropeanAct(norma_data.tipo_atto)}
                today={todayInRome()}
                initialDate={requestedDate}
            />

            <DecisionPreviewPopup {...decisionLinks.popupProps} />

            {/* Citation Preview Popup */}
            <CitationPreviewPopup
                isVisible={citationPreviewState.isVisible}
                isLoading={citationPreviewState.isLoading}
                error={citationPreviewState.error}
                citation={citationPreviewState.citation}
                article={citationPreviewState.article}
                position={citationPreviewState.position}
                onClose={hidePreview}
                onOpenCitation={handleOpenCitation}
                nerFeedbackEnabled={devMode && canContribute}
                onNerFeedback={handleCitationNerFeedback}
                onMouseEnter={() => { isHoveringPopupRef.current = true; }}
                onMouseLeave={() => {
                    isHoveringPopupRef.current = false;
                    hidePreview();
                }}
            />

        </div>
    );
}
