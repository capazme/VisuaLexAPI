import { useEffect, useState, useMemo, useRef } from 'react';
import { Loader2, Search, ArrowRight, Trash2, Zap, FolderPlus, MoreVertical, Check, Plus, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { it } from 'date-fns/locale';
import { cn } from '../../../lib/utils';
import { MenuButton, type MenuItem } from '../../ui/MenuButton';
import { EmptyState } from '../../ui/EmptyState';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { useAppStore } from '../../../store/useAppStore';
import { useNavigate } from 'react-router-dom';
import type { NormaVisitata, SearchParams } from '../../../types';
import { useTour } from '../../../hooks/useTour';
import { getHistory, deleteHistoryItem, clearHistory, type SearchHistoryItem } from '../../../services/historyService';
import { NormaChangesSection } from './NormaChangesSection';
import { actHeading, labelFromParams } from '../../../utils/sources';
import { DecisionHistoryRow } from './DecisionHistoryRow';
import { PageFrame } from '../../layout/PageFrame';
import { decisionHistoryLabel, identityFromKey } from '../../../utils/decisionLinks';
import { FIELD_TEXT } from '../../../constants/interactions';

// Humanized group label: today/yesterday/weekday-this-week/full-date.
// Group key stays YYYY-MM-DD (ISO) for stable insertion order; only the
// rendered label is humanized.
function groupLabel(d: Date): string {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const target = new Date(d); target.setHours(0, 0, 0, 0);
    const diffDays = Math.round((today.getTime() - target.getTime()) / 86_400_000);
    if (diffDays === 0) return 'Oggi';
    if (diffDays === 1) return 'Ieri';
    if (diffDays > 1 && diffDays < 7) {
        const weekday = d.toLocaleDateString('it-IT', { weekday: 'long' });
        return weekday.charAt(0).toUpperCase() + weekday.slice(1);
    }
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
}

// Converte un history item in NormaVisitata
function historyToNormaVisitata(item: SearchHistoryItem): NormaVisitata {
    return {
        tipo_atto: item.act_type || '',
        data: item.date || '',
        numero_atto: item.act_number || undefined,
        numero_articolo: item.article?.toString() || '',
        versione: 'vigente',
    };
}

// Converte un history item in SearchParams
function historyToSearchParams(item: SearchHistoryItem): SearchParams {
    return {
        act_type: item.act_type || '',
        act_number: item.act_number || '',
        date: item.date || '',
        article: item.article?.toString() || '',
        version: 'vigente',
    };
}

// «2056,2057,2058» as the server keeps it, read as «2056, 2057, 2058» (B8).
const articlesOf = (item: SearchHistoryItem) => item.article?.toString().split(',').map((a) => a.trim()).filter(Boolean).join(', ') ?? '';

// The row's title: the norm as it is cited, «art. 2043 c.c.», «artt. 2056, 2057 c.c.» (B8).
function historyLabel(item: SearchHistoryItem): string {
    const articles = articlesOf(item);
    const label = labelFromParams({ act_type: item.act_type ?? '', act_number: item.act_number, date: item.date, article: articles });
    return articles.includes(',') ? label.replace(/^art\. /, 'artt. ') : label;
}

// The row's second line: the act by its name («Codice civile») or its citation.
const actHeadingOf = (item: SearchHistoryItem) => actHeading({ tipo_atto: item.act_type ?? '', numero_atto: item.act_number, data: item.date });

// A quick norm is suggested with the norm's short label, the act's with no article (source convention).
function generateQuickNormLabel(item: SearchHistoryItem): string {
    return labelFromParams({ act_type: item.act_type ?? '', act_number: item.act_number, date: item.date, article: item.article?.toString() });
}

export function HistoryView() {
    const [history, setHistory] = useState<SearchHistoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [clearing, setClearing] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [clearFrom, setClearFrom] = useState<HTMLElement | null>(null);
    const [createDossierFor, setCreateDossierFor] = useState<SearchHistoryItem | null>(null);
    const [newDossierTitle, setNewDossierTitle] = useState('');
    const searchInputRef = useRef<HTMLInputElement>(null);

    const {
        triggerSearch,
        addQuickNorm,
        dossiers,
        addToDossier,
        createDossier
    } = useAppStore();
    const navigate = useNavigate();
    const { tryStartTour } = useTour();

    // Start history tour on first visit
    useEffect(() => {
        tryStartTour('history');
    }, [tryStartTour]);

    // Auto-hide feedback
    useEffect(() => {
        if (feedback) {
            const timer = setTimeout(() => setFeedback(null), 2000);
            return () => clearTimeout(timer);
        }
    }, [feedback]);

    // Page-scoped shortcuts: "/" focuses search, Escape clears search when
    // focused. Skipped while any overlay is open or the user is typing in
    // a different input/textarea (mirrors DossierListView pattern).
    useEffect(() => {
        const hasOverlay = clearConfirmOpen || createDossierFor !== null;
        const handler = (e: KeyboardEvent) => {
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            const target = e.target as HTMLElement | null;
            const inSearchInput = target === searchInputRef.current;
            const inOtherField = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && !inSearchInput;
            if (e.key === '/' && !inOtherField && !inSearchInput && !hasOverlay) {
                e.preventDefault();
                searchInputRef.current?.focus();
            } else if (e.key === 'Escape' && inSearchInput && searchTerm) {
                e.preventDefault();
                setSearchTerm('');
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [clearConfirmOpen, createDossierFor, searchTerm]);

    const showFeedback = (message: string, type: 'success' | 'error' = 'success') => {
        setFeedback({ message, type });
    };

    const handleAddQuickNorm = (e: React.MouseEvent, item: SearchHistoryItem) => {
        e.stopPropagation();
        const searchParams = historyToSearchParams(item);
        const label = generateQuickNormLabel(item);
        addQuickNorm(label, searchParams);
        showFeedback('Aggiunto alle norme rapide');
    };

    const handleAddToDossier = (e: React.MouseEvent, item: SearchHistoryItem, dossierId: string) => {
        e.stopPropagation();
        const norma = historyToNormaVisitata(item);
        addToDossier(dossierId, norma, 'norma');
        showFeedback('Aggiunto alla pratica');
    };

    const handleCreateDossierAndAdd = (e: React.MouseEvent, item: SearchHistoryItem) => {
        e.stopPropagation();
        setCreateDossierFor(item);
        setNewDossierTitle('');
    };

    const handleConfirmCreateDossier = async () => {
        const title = newDossierTitle.trim();
        if (!title || !createDossierFor) return;
        const norma = historyToNormaVisitata(createDossierFor);
        setCreateDossierFor(null);
        setNewDossierTitle('');
        const id = await createDossier(title);
        if (id) {
            addToDossier(id, norma, 'norma');
            showFeedback(`Creato "${title}" e aggiunta norma`);
        } else {
            showFeedback('Errore nella creazione della pratica', 'error');
        }
    };

    const handleClearHistory = (event: { currentTarget: HTMLElement }) => {
        setClearFrom(event.currentTarget);
        setClearConfirmOpen(true);
    };

    const handleConfirmClear = async () => {
        setClearConfirmOpen(false);
        setClearing(true);
        try {
            await clearHistory();
            setHistory([]);
        } catch (err) {
            console.error(err);
        } finally {
            setClearing(false);
        }
    };

    const handleDeleteItem = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        const previous = history;
        setHistory(prev => prev.filter(item => item.id !== id));
        try {
            await deleteHistoryItem(id);
        } catch (err) {
            console.error(err);
            setHistory(previous);
            showFeedback('Impossibile eliminare la voce dalla cronologia', 'error');
        }
    };

    // A norm's «⋯»: the pratiche listed in it under their heading, as one menu (LC103: a `MenuButton`, as every other).
    const historyMenuItems = (item: SearchHistoryItem): MenuItem[] => [
        { label: 'Aggiungi a norme rapide', icon: Zap, iconClassName: 'text-amber-500', onSelect: (e) => handleAddQuickNorm(e, item) },
        ...dossiers.map((dossier, i) => ({
            label: dossier.title,
            ariaLabel: `Aggiungi a ${dossier.title}`,
            icon: FolderPlus,
            iconClassName: 'text-primary-500',
            separatorBefore: i === 0,
            sectionHeading: i === 0 ? 'Aggiungi a una pratica' : undefined,
            onSelect: (e: React.MouseEvent) => handleAddToDossier(e, item, dossier.id),
        })),
        {
            label: 'Nuova pratica…',
            ariaLabel: 'Aggiungi a una nuova pratica…',
            icon: Plus,
            separatorBefore: dossiers.length === 0,
            sectionHeading: dossiers.length === 0 ? 'Aggiungi a una pratica' : undefined,
            onSelect: (e) => handleCreateDossierAndAdd(e, item),
        },
        { label: 'Rimuovi dalla cronologia', icon: Trash2, danger: true, separatorBefore: true, onSelect: (e) => handleDeleteItem(e, item.id) },
    ];

    const handleOpenNorma = (params: SearchParams) => {
        navigate('/');
        triggerSearch(params);
    };

    const handleItemClick = (item: SearchHistoryItem) => {
        // Navigate to search page and trigger search
        navigate('/');
        triggerSearch({
            act_type: item.act_type ?? '',
            act_number: item.act_number || '',
            date: item.date || '',
            article: item.article?.toString() || '',
            version: 'vigente',
            version_date: '',
        });
    };

    useEffect(() => {
        getHistory()
            .then(data => {
                // once per row here, not in the row: the mobile and desktop lists both mount it
                data.forEach((item) => {
                    if (item.decision_key && !identityFromKey(item.decision_key)) {
                        console.error('history: unreadable decision key', { id: item.id, decision_key: item.decision_key });
                    }
                });
                setHistory(data);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    }, []);

    // Build a searchable haystack per item — combines all metadata + the
    // abbreviation label (CC/CP/Cost. ecc.) so "art. 2043 cc" matches.
    // SearchHistory has no article body, so this is the closest to "ricerca
    // nel testo" we can do without fetching+caching norma content.
    const filteredHistory = useMemo(() => {
        const tokens = searchTerm.toLowerCase().trim().split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return history;
        return history.filter(item => {
            const haystack = [
                item.act_type ?? '',
                item.act_number ?? '',
                item.article?.toString() ?? '',
                item.date ?? '',
                item.version ?? '',
                item.decision_key ? decisionHistoryLabel(item.decision_key) : generateQuickNormLabel(item),
            ].join(' ').toLowerCase();
            return tokens.every(t => haystack.includes(t));
        });
    }, [history, searchTerm]);

    // Group by ISO date (stable insertion order) and derive a humanized
    // label per group. Items without created_at fall into a "Senza data"
    // bucket at the end.
    const groupedByDate = useMemo(() => {
        const buckets = new Map<string, { label: string; items: SearchHistoryItem[] }>();
        filteredHistory.forEach(item => {
            if (!item.created_at) {
                const bucket = buckets.get('__nodate__') ?? { label: 'Senza data', items: [] };
                bucket.items.push(item);
                buckets.set('__nodate__', bucket);
                return;
            }
            const d = new Date(item.created_at);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const bucket = buckets.get(key) ?? { label: groupLabel(d), items: [] };
            bucket.items.push(item);
            buckets.set(key, bucket);
        });
        return Array.from(buckets.entries()).map(([key, value]) => ({ key, ...value }));
    }, [filteredHistory]);

    return (
        <PageFrame
            title="Cronologia"
            className="animate-in fade-in duration-200"
            action={
                <>
                    <div id="tour-history-search" className="relative min-w-0 flex-1 md:w-64 md:flex-none">
                        <input
                            ref={searchInputRef}
                            type="text"
                            placeholder="Cerca nella cronologia…"
                            aria-label="Cerca nella cronologia"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            aria-keyshortcuts="/"
                            title="Cerca (premi /)"
                            className={`w-full pl-9 pr-4 py-2 ${FIELD_TEXT} rounded-lg bg-slate-100 dark:bg-slate-700 border-transparent focus:border-primary-500 focus:bg-white dark:focus:bg-slate-900 transition-colors min-h-[44px] md:min-h-0 md:py-1.5 md:rounded-full`}
                        />
                        <Search size={16} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    </div>
                    {history.length > 0 && (
                        <button
                            onClick={handleClearHistory}
                            disabled={clearing}
                            className="flex shrink-0 items-center justify-center p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg md:rounded-full transition-colors disabled:opacity-50 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0"
                            title="Svuota cronologia"
                            aria-label="Svuota cronologia"
                        >
                            {clearing ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                        </button>
                    )}
                </>
            }
        >
            <NormaChangesSection onOpen={handleOpenNorma} />
            {/* No overflow at all: `hidden` made this card the date labels' scroll container (M1), and `clip` cut the
                «⋯» menus at its edge (LC103); its padding keeps everything inside the rounded corners. */}
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700">
                {/* Timeline with grouped dates. No inner scroll: the page is the
                    scroll context so the action dropdown isn't clipped. Sticky date
                    headers attach to the page's scroller, under the phone's bar. */}
                <div className="p-3 md:p-6">
                    {loading ? (
                        <div className="p-8 text-center">
                            <Loader2 className="animate-spin mx-auto text-primary-500" size={24} />
                        </div>
                    ) : filteredHistory.length === 0 && history.length > 0 ? (
                        <EmptyState
                            variant="search"
                            title="Nessuna corrispondenza"
                            description={`Nessuna voce trovata per "${searchTerm}".`}
                            action={
                                <button
                                    onClick={() => setSearchTerm('')}
                                    className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg inline-flex items-center gap-2 transition-colors min-h-[44px]"
                                >
                                    Azzera filtro
                                </button>
                            }
                        />
                    ) : filteredHistory.length === 0 ? (
                        <EmptyState
                            variant="history"
                            title="Nessuna ricerca recente"
                            description="Le tue ricerche appariranno qui. Inizia cercando una norma per vedere la cronologia."
                            action={
                                <button
                                    onClick={() => navigate('/')}
                                    className="px-4 py-2.5 bg-primary-600 dark:bg-toga-400 dark:hover:bg-toga-300 dark:text-ink-950 hover:bg-primary-700 text-white rounded-lg inline-flex items-center gap-2 transition-colors min-h-[44px]"
                                >
                                    <Search size={18} />
                                    Inizia una ricerca
                                </button>
                            }
                        />
                    ) : (
                        <div className="space-y-6 md:space-y-8">
                            {groupedByDate.map(({ key, label, items }) => (
                                <div key={key} className="relative">
                                    {/* Date label with timeline line */}
                                    {/* Mobile: smaller, simpler date label */}
                                    <div className="md:hidden flex items-center gap-2 mb-3 sticky top-[var(--phone-bar-offset,0px)] transition-[top] duration-200 ease-out motion-reduce:transition-none bg-slate-50 dark:bg-slate-950 py-1 z-10">
                                        <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">{label}</h2>
                                    </div>

                                    {/* Desktop: full date label */}
                                    <div className="hidden md:flex items-center gap-3 mb-4 sticky top-[var(--phone-bar-offset,0px)] transition-[top] duration-200 ease-out motion-reduce:transition-none bg-slate-50 dark:bg-slate-950 py-2 z-10">
                                        <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">{label}</h2>
                                    </div>

                                    {/* Timeline items */}
                                    {/* Mobile: simpler timeline */}
                                    <div className="md:hidden space-y-2">
                                        {items.map((item, idx) => item.decision_key ? (
                                            <DecisionHistoryRow key={item.id} item={item} variant="mobile" onDelete={handleDeleteItem} />
                                        ) : (
                                            <div key={idx} className="relative">
                                                {/* Mobile Item card - compact, tap-friendly; a button, so Tab reaches it and Enter opens it (A6) */}
                                                <button
                                                    type="button"
                                                    onClick={() => handleItemClick(item)}
                                                    className={cn(
                                                        "relative block w-full text-left bg-white dark:bg-slate-800 p-3 pr-12 rounded-lg border transition-[color,background-color,border-color,scale] cursor-pointer min-h-[44px]",
                                                        "border-slate-200 dark:border-slate-700",
                                                        "active:scale-[0.98] active:border-primary-400",
                                                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                                                    )}
                                                >
                                                    <span className="flex items-start justify-between gap-2">
                                                        <span className="block flex-1 min-w-0">
                                                            <span className="flex items-center gap-1.5 mb-1">
                                                                <span className="font-serif text-base text-slate-900 dark:text-slate-50">{historyLabel(item)}</span>
                                                            </span>
                                                            <span className="block text-[13px] text-slate-600 dark:text-slate-400 truncate">
                                                                {actHeadingOf(item)}
                                                            </span>
                                                            {item.created_at && (
                                                                <span
                                                                    className="block text-[11px] text-slate-600 dark:text-slate-400 mt-0.5"
                                                                    title={new Date(item.created_at).toLocaleString('it-IT')}
                                                                >
                                                                    {formatDistanceToNow(new Date(item.created_at), { addSuffix: true, locale: it })}
                                                                </span>
                                                            )}
                                                        </span>
                                                        <ArrowRight size={18} aria-hidden className="text-primary-500 flex-shrink-0 mt-1" />
                                                    </span>
                                                </button>
                                                {/* Beside the card, over its right edge: a button cannot hold another (LC103, 44 px to the touch). */}
                                                <MenuButton
                                                    label={`Altre azioni su ${historyLabel(item)}`}
                                                    title="Altre azioni"
                                                    items={historyMenuItems(item)}
                                                    placement="auto"
                                                    menuClassName="max-h-80"
                                                    className="absolute right-1 top-1"
                                                    triggerClassName="min-h-[44px] min-w-[44px] justify-center text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
                                                >
                                                    <MoreVertical size={18} aria-hidden />
                                                </MenuButton>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Desktop: full timeline with dots */}
                                    <div className="hidden md:block border-t border-slate-200 dark:border-slate-800">
                                        {items.map((item, idx) => item.decision_key ? (
                                            <DecisionHistoryRow key={item.id} item={item} variant="desktop" onDelete={handleDeleteItem}
                                                id={idx === 0 ? 'tour-history-item' : undefined} />
                                        ) : (
                                            <div key={idx} id={idx === 0 ? 'tour-history-item' : undefined} className="relative group">

                                                {/* Item card: the title is a button stretched over the card (A6), so the card still opens
                                                    on a click anywhere and Tab and Enter reach it; the menu sits beside it, above the stretch. */}
                                                <div
                                                    className={cn(
                                                        // LC21: a row of the list, as the prototype's: a rule under it, the hover a tint, no card.
                                                        "relative border-b border-slate-200 px-2 py-3 transition-colors cursor-pointer dark:border-slate-800",
                                                        "hover:bg-slate-100 dark:hover:bg-slate-900",
                                                        "has-[[data-history-open]:focus-visible]:ring-2 has-[[data-history-open]:focus-visible]:ring-primary-500"
                                                    )}
                                                >
                                                    <div className="flex justify-between items-start gap-4">
                                                        <button
                                                            type="button"
                                                            data-history-open
                                                            onClick={() => handleItemClick(item)}
                                                            className="flex-1 block text-left focus-visible:outline-none after:absolute after:inset-0 after:rounded-xl after:content-['']"
                                                        >
                                                            {/* The norm as it is cited («art. 2043 c.c.»), then the act's name and when it was read (B8). */}
                                                            <span className="block font-serif text-lg leading-snug text-slate-900 dark:text-slate-50">
                                                                {historyLabel(item)}
                                                            </span>
                                                            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-slate-600 dark:text-slate-400">
                                                                <span>{actHeadingOf(item)}</span>
                                                                {item.created_at && (
                                                                    <span
                                                                        className="text-xs text-slate-500 dark:text-slate-400"
                                                                        title={new Date(item.created_at).toLocaleString('it-IT')}
                                                                    >
                                                                        {formatDistanceToNow(new Date(item.created_at), { addSuffix: true, locale: it })}
                                                                    </span>
                                                                )}
                                                            </span>
                                                        </button>

                                                        <div className="relative z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-[color,background-color,border-color,opacity]">
                                                            {/* Menu azioni */}
                                                            <div id={idx === 0 ? 'tour-history-actions' : undefined}>
                                                                <MenuButton
                                                                    label={`Altre azioni su ${historyLabel(item)}`}
                                                                    title="Altre azioni"
                                                                    items={historyMenuItems(item)}
                                                                    placement="auto"
                                                                    menuClassName="max-h-80"
                                                                    triggerClassName="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"
                                                                >
                                                                    <MoreVertical size={16} aria-hidden />
                                                                </MenuButton>
                                                            </div>

                                                            <div className="p-2 bg-primary-50 dark:bg-primary-900/20 rounded-lg text-primary-500 pointer-events-none">
                                                                <ArrowRight size={18} />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Feedback toast */}
            {feedback && (
                <div className={cn(
                    "fixed bottom-4 right-4 md:right-4 left-4 md:left-auto px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-in slide-in-from-bottom-2 z-50",
                    feedback.type === 'success'
                        ? "bg-green-500 text-white"
                        : "bg-red-500 text-white"
                )}>
                    <Check size={16} />
                    <span className="text-sm font-medium">{feedback.message}</span>
                </div>
            )}

            {/* Clear-all confirmation */}
            <ConfirmDialog
                open={clearConfirmOpen}
                origin={clearFrom}
                variant="danger"
                title="Svuotare la cronologia?"
                message="Tutte le ricerche salvate verranno rimosse. Le pratiche e i segnalibri non saranno toccati."
                confirmLabel="Svuota"
                focusCancel
                onConfirm={handleConfirmClear}
                onCancel={() => setClearConfirmOpen(false)}
            />

            {/* New-dossier inline modal */}
            {createDossierFor && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-lg w-full max-w-md p-5">
                        <div className="flex items-start justify-between mb-3">
                            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                                Crea nuova pratica
                            </h2>
                            <button
                                onClick={() => { setCreateDossierFor(null); setNewDossierTitle(''); }}
                                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded"
                                aria-label="Chiudi"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                            La norma verrà aggiunta automaticamente alla nuova pratica.
                        </p>
                        <input
                            type="text"
                            autoFocus
                            value={newDossierTitle}
                            onChange={(e) => setNewDossierTitle(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && newDossierTitle.trim()) handleConfirmCreateDossier();
                                if (e.key === 'Escape') { setCreateDossierFor(null); setNewDossierTitle(''); }
                            }}
                            placeholder="Nome della pratica"
                            maxLength={120}
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                onClick={() => { setCreateDossierFor(null); setNewDossierTitle(''); }}
                                className="px-3 py-1.5 text-sm bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-200 dark:hover:bg-slate-700"
                            >
                                Annulla
                            </button>
                            <button
                                onClick={handleConfirmCreateDossier}
                                disabled={!newDossierTitle.trim()}
                                className="px-3 py-1.5 text-sm bg-primary-600 dark:bg-toga-400 dark:hover:bg-toga-300 dark:text-ink-950 dark:disabled:bg-slate-700 dark:disabled:text-slate-400 dark:disabled:opacity-100 text-white rounded hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Crea e aggiungi
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </PageFrame>
    );
}
