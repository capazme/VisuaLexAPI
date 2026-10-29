import { useRef, type Ref } from 'react';
import type { ArticleData } from '../../../types';
import { ExternalLink, Zap, FolderPlus, Copy, MessageCircle, Share2, Download, MoreHorizontal, Clock, BookOpen, GitCompare, Search } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { FOCUS_RING } from '../../../constants/interactions';
import type { VersionChip } from '../../../utils/versionDisplay';
import { MenuButton, type MenuItem } from '../../ui/MenuButton';
import { VersionStatusChip } from './VersionStatusChip';
import { NotesHighlightsButtons } from './NotesHighlightsButtons';
import { HighlightColorMenu } from './HighlightColorMenu';
import { highlightColorItems } from './highlightColorItems';
import { useAppStore } from '../../../store/useAppStore';
import { useHighlightColorMeanings } from '../../../hooks/useHighlightColorMeanings';
import { namedAnnex } from '../../../utils/sources';

export interface ReadingToolbarProps {
    normaData: ArticleData['norma_data'];
    /** What the source says about the version on screen; null shows nothing (no "Vigente" by default). */
    versionChip: VersionChip | null;
    /**
     * Set on a past text: quick-norm, notes, highlights, discussions and Study Mode are
     * switched off, with this as the reason.
     */
    lockedReason?: string;
    /**
     * Set when the text may not be copied, exported or saved (the article did not exist on the
     * day, or the version does not contain it): copy, dossier and "Esporta..." are switched off
     * with this as the reason.
     */
    copyLockedReason?: string;
    url?: string;
    articleText: string;
    isNotesPeekOpen: boolean;
    notesButtonRef?: Ref<HTMLButtonElement | null>;
    notesCount: number;
    dossierButtonRef?: Ref<HTMLButtonElement | null>;
    isHighlightsPeekOpen: boolean;
    highlightsButtonRef?: Ref<HTMLButtonElement | null>;
    highlightsCount: number;
    isDiscussionOpen: boolean;
    isPinnedQuick: boolean;
    onToggleNotes: () => void;
    onToggleHighlightsPeek: () => void;
    onToggleDiscussion: () => void;
    onToggleQuickNorm: () => void;
    onMobileCopy: () => Promise<void> | void;
    onOpenStudyMode?: () => void;
    onOpenCopyModal: () => void;
    onOpenDossier: () => void;
    onShareLink: () => void;
    onOpenAdvancedExport: () => void;
    onOpenVersionInput: () => void;
    onCompare: () => void;
    /**
     * The compact form of a light window beside a practice's table (spec §4.1, T12): notes and
     * highlights in words, and behind «⋯» the discussions, the magnifier and copy, nothing else (the
     * phone row has no notes or highlights buttons to begin with). The status and the annex stay:
     * they say which text this is. The tools the table's row keeps (quick norm, dossier, Study Mode,
     * the source link, sharing, export, a date, a comparison) are the row's.
     */
    compact?: boolean;
    /**
     * «Cerca nel testo»: the magnifier (desktop row and phone row), which opens the floating find window on this tab.
     * Absent when there is no text to search.
     */
    find?: {
        /** The window is open and scoped to this tab. */
        isOpen: boolean;
        /** Told which of the two buttons was on screen, for the window to give focus back to. */
        onToggle: (button: HTMLElement | null, wasPressed: boolean) => void;
    };
}

/** The article's visible actions (R3): quiet, neutral, the word with the icon; 36 px on a computer, 44 on a phone. */
const ACTION = cn(
    'inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-slate-600 transition-colors',
    'hover:bg-slate-100 hover:text-slate-900 aria-expanded:bg-slate-200/70 aria-expanded:text-slate-900 md:h-9 md:min-h-0 md:min-w-0',
    'dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white dark:aria-expanded:bg-slate-800 dark:aria-expanded:text-white',
    'disabled:cursor-not-allowed disabled:opacity-40',
    FOCUS_RING,
);

export function ReadingToolbar({
    normaData,
    versionChip,
    lockedReason,
    copyLockedReason,
    url,
    isNotesPeekOpen,
    notesButtonRef,
    notesCount,
    dossierButtonRef,
    isHighlightsPeekOpen,
    highlightsButtonRef,
    highlightsCount,
    isDiscussionOpen,
    isPinnedQuick,
    onToggleNotes,
    onToggleHighlightsPeek,
    onToggleDiscussion,
    onToggleQuickNorm,
    onMobileCopy,
    onOpenStudyMode,
    onOpenCopyModal,
    onOpenDossier,
    onShareLink,
    onOpenAdvancedExport,
    onOpenVersionInput,
    onCompare,
    compact = false,
    find,
}: ReadingToolbarProps) {
    // Both rows are mounted and one is hidden by CSS: the find window returns the focus to the «⋯» on screen.
    const desktopMoreRef = useRef<HTMLDivElement>(null);
    const phoneMoreRef = useRef<HTMLDivElement>(null);
    const toggleFind = () => {
        if (!find) return;
        const desktop = desktopMoreRef.current?.querySelector('button') ?? null;
        const shown = desktop && desktop.getClientRects().length > 0 ? desktop : phoneMoreRef.current?.querySelector('button') ?? null;
        find.onToggle(shown, find.isOpen);
    };
    // A switched-off tool keeps its name and gains the reason in its tooltip (a menu's entry, under its name).
    const tip = (name: string, reason?: string) => (reason ? `${name} — ${reason}` : name);
    const lock = (reason?: string) => (reason ? { disabled: true } : {});
    // Exporting writes the article out like a copy does, and the export header
    // carries no version: anything that may not be copied, or is a reading, stays in.
    const exportLockedReason = copyLockedReason ?? lockedReason;

    /** The tools behind «⋯» (R3: the reading's own in words, the rest here), the phone's adding what its row does not show. */
    // The colour of new highlights (H1): a menu of its own beside «Evidenziazioni» on a computer; on a phone, where the
    // row has no room, its four choices close the «⋯», and the gear's way to their meanings after them.
    const highlightColor = useAppStore((s) => s.settings.highlightColor);
    const updateSettings = useAppStore((s) => s.updateSettings);
    const openSettings = useAppStore((s) => s.openSettings);
    const meanings = useHighlightColorMeanings();
    const moreItems = (phone: boolean): MenuItem[] => [
        ...(compact ? [] : [{
            label: isPinnedQuick ? 'Togli dalle norme rapide' : 'Aggiungi alle norme rapide',
            icon: Zap,
            onSelect: onToggleQuickNorm,
            disabled: Boolean(lockedReason),
            description: lockedReason,
        }]),
        {
            label: isDiscussionOpen ? 'Chiudi le glosse' : 'Glosse sull’articolo',
            icon: MessageCircle,
            onSelect: onToggleDiscussion,
            disabled: Boolean(lockedReason),
            description: lockedReason,
        },
        ...(find ? [{ label: find.isOpen ? 'Chiudi la ricerca nel testo' : 'Cerca nel testo', icon: Search, onSelect: toggleFind }] : []),
        {
            label: 'Copia',
            icon: Copy,
            onSelect: () => (phone ? void onMobileCopy() : onOpenCopyModal()),
            disabled: Boolean(copyLockedReason),
            description: copyLockedReason,
        },
        ...(compact ? [] : [
            ...(phone ? [
                { label: 'Modalità studio', icon: BookOpen, onSelect: () => onOpenStudyMode?.(), disabled: Boolean(lockedReason) || !onOpenStudyMode, description: lockedReason },
                ...(url ? [{ label: 'Apri la fonte', icon: ExternalLink, onSelect: () => { window.open(url, '_blank', 'noopener,noreferrer'); } }] : []),
            ] : []),
            { label: 'Condividi link', icon: Share2, onSelect: onShareLink, separatorBefore: true },
            { label: 'Esporta…', icon: Download, onSelect: onOpenAdvancedExport, disabled: Boolean(exportLockedReason), description: exportLockedReason },
            { label: 'Testo alla data…', icon: Clock, onSelect: onOpenVersionInput },
            { label: 'Confronta con…', icon: GitCompare, onSelect: onCompare },
        ]),
        // The colour of new highlights (H1), last: a setting, under its own title. Not on a text that takes none.
        ...(phone && !lockedReason
            ? highlightColorItems(highlightColor, meanings, (color) => updateSettings({ highlightColor: color }), {
                section: true,
                onChangeMeanings: () => openSettings('highlightColors'),
            })
            : []),
    ];

    // The annex as the source convention names it: never a code's own (the codice civile is Allegato 2 of its decree).
    const annex = namedAnnex(normaData);
    /** «Al dossier»: its word on a computer; on a phone the icon, so the status and the tools keep one row. */
    const dossierButton = (ref?: Ref<HTMLButtonElement | null>, phone = false) => (
        <button
            ref={ref}
            type="button"
            onClick={onOpenDossier}
            className={ACTION}
            aria-label={phone ? 'Al dossier' : undefined}
            title={tip('Aggiungi l’articolo a un dossier', copyLockedReason)}
            {...lock(copyLockedReason)}
        >
            <FolderPlus size={phone ? 18 : 16} aria-hidden />
            {!phone && 'Al dossier'}
        </button>
    );

    return (
        // One line beside the text (R3: no box of its own), opaque while it is pinned over the text it heads, on the
        // ground it stands on: the page's paper in a practice's row, the window's (and the phone's reader's) when compact.
        <div
            data-pinned-head
            className={cn(
                'glass-toolbar sticky top-[var(--reading-toolbar-top,0px)] mb-3 flex items-center justify-between gap-x-1 gap-y-1 border-b py-1 backdrop-blur-md md:flex-wrap md:gap-x-2',
                compact
                    ? 'border-slate-100 bg-white/95 dark:border-slate-700 dark:bg-slate-800/95'
                    : 'border-slate-200 bg-slate-50/95 dark:border-slate-800 dark:bg-slate-950/95',
                Z_INDEX.sticky,
            )}
        >
            {/* Which text this is, in words: the status, then the annex. */}
            {/* On a phone it takes what the tools leave (and wraps inside); from `md` its own width, so the tools wrap. */}
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 text-sm text-slate-600 md:flex-initial dark:text-slate-400">
                {versionChip && <VersionStatusChip chip={versionChip} onClick={onOpenVersionInput} />}
                {annex && (
                    // On a phone the annex has its own line under the status, so no dot ever leads a line or goes missing.
                    <span className="basis-full md:basis-auto">
                        {versionChip && <span aria-hidden className="mr-2 hidden text-slate-400 md:inline dark:text-slate-600">·</span>}
                        Allegato {annex}
                    </span>
                )}
            </div>

            {/* A phone: the dossier and «⋯», 44 px each. */}
            {/* Close together, the last one's 44 px reaching into the page's right margin (`-mr-3`): the status keeps one line
                at 320 px («In vigore dal 1° gennaio 2005», R3b). Not in the compact bar (the phone's full-screen reader, a
                window): there the card's padding is the edge, and its overflow would cut the focus ring. */}
            <div className={cn('ml-auto flex flex-shrink-0 items-center md:hidden', !compact && '-mr-3')}>
                {!compact && dossierButton(undefined, true)}
                <div ref={phoneMoreRef} className="contents">
                    {/* Its list is long (the colours close it): capped under the bar, it scrolls on its own. */}
                    <MenuButton
                        label="Altre azioni sull’articolo"
                        triggerClassName={ACTION}
                        items={moreItems(true)}
                        menuClassName="max-h-[calc(100dvh-12rem)] overflow-y-auto overscroll-contain"
                    >
                        <MoreHorizontal size={18} aria-hidden />
                    </MenuButton>
                </div>
            </div>

            {/* A computer: the tools in words («Note», «Evidenziazioni», «Colore», «Al dossier»), then «⋯». */}
            <div className="hidden flex-shrink-0 items-center gap-1 md:flex">
                <NotesHighlightsButtons
                    labelled
                    notesCount={notesCount}
                    highlightsCount={highlightsCount}
                    isNotesOpen={isNotesPeekOpen}
                    isHighlightsOpen={isHighlightsPeekOpen}
                    notesButtonRef={notesButtonRef}
                    highlightsButtonRef={highlightsButtonRef}
                    onToggleNotes={onToggleNotes}
                    onToggleHighlights={onToggleHighlightsPeek}
                    lockedReason={lockedReason}
                />
                {!lockedReason && <HighlightColorMenu labelled triggerClassName={ACTION} />}
                {!compact && dossierButton(dossierButtonRef)}
                <div ref={desktopMoreRef} className="contents">
                    <MenuButton label="Altre azioni sull’articolo" triggerClassName={ACTION} items={moreItems(false)}>
                        <MoreHorizontal size={18} aria-hidden />
                    </MenuButton>
                </div>
            </div>
        </div>
    );
}
