import { useEffect, useState, useMemo, useRef } from 'react';
import { Clock, Loader2, Search, ArrowRight, Calendar, Trash2, Zap, FolderPlus, MoreVertical, Check, Plus, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { it } from 'date-fns/locale';
import { cn } from '../../../lib/utils';
import { EmptyState } from '../../ui/EmptyState';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { useAppStore, appStore } from '../../../store/useAppStore';
import { useNavigate } from 'react-router-dom';
import type { NormaVisitata, SearchParams } from '../../../types';
import { useTour } from '../../../hooks/useTour';
import { getHistory, deleteHistoryItem, clearHistory, type SearchHistoryItem } from '../../../services/historyService';

// Stripe color per act_type — keyed on lowercased exact match. Codes get
// distinct colors so the user can scan the timeline visually; everything
// else falls back to slate. Same hex-map pattern as SharedEnvironmentCard.
const ACT_TYPE_STRIPE: Record<string, string> = {
    'codice civile': '#3b82f6',                // blue
    'codice penale': '#ef4444',                // red
    'codice di procedura civile': '#6366f1',   // indigo
    'codice di procedura penale': '#8b5cf6',   // violet
    'costituzione': '#f59e0b',                 // amber
    'regolamento ue': '#0ea5e9',               // sky
    'direttiva ue': '#06b6d4',                 // cyan
};

function stripeColor(actType: string | null | undefined): string {
    return ACT_TYPE_STRIPE[(actType ?? '').toLowerCase()] ?? '#94a3b8';
}

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
function historyToNormaVisitata(item: any): NormaVisitata {
    return {
        tipo_atto: item.act_type || '',
        data: item.date || '',
        numero_atto: item.act_number || undefined,
        numero_articolo: item.article?.toString() || '',
        versione: 'vigente',
    };
}

// Converte un history item in SearchParams
function historyToSearchParams(item: any): SearchParams {
    return {
        act_type: item.act_type || '',
        act_number: item.act_number || '',
        date: item.date || '',
        article: item.article?.toString() || '',
        version: 'vigente',
        show_brocardi_info: true,
    };
}

// Genera una label per QuickNorm
function generateQuickNormLabel(item: any): string {
    const parts = [`Art. ${item.article}`];
    if (item.act_type) {
        // Abbrevia il tipo atto
        const abbrev = item.act_type
            .replace('codice civile', 'CC')
            .replace('codice penale', 'CP')
            .replace('codice di procedura civile', 'CPC')
            .replace('codice di procedura penale', 'CPP')
            .replace('costituzione', 'Cost.')
            .replace(/^decreto legislativo$/i, 'D.Lgs.')
            .replace(/^decreto legge$/i, 'D.L.')
            .replace(/^legge$/i, 'L.');
        parts.push(abbrev);
    }
    if (item.act_number) {
        parts.push(`n. ${item.act_number}`);
    }
    return parts.join(' ');
}

export function HistoryView() {
    const [history, setHistory] = useState<SearchHistoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [clearing, setClearing] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [openMenu, setOpenMenu] = useState<string | null>(null);
    const [showDossierList, setShowDossierList] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [createDossierFor, setCreateDossierFor] = useState<SearchHistoryItem | null>(null);
    const [newDossierTitle, setNewDossierTitle] = useState('');
    // Menu position is computed from the trigger's getBoundingClientRect on open
    // so the dropdown can use position:fixed and escape parent overflow contexts
    // (the page layout has overflow-hidden on <main>; absolute positioning was
    // getting clipped by it). flip is set when there's not enough space below.
    const [menuPos, setMenuPos] = useState<{
        top?: number;
        bottom?: number;
        right: number;
    } | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const closeMenu = () => {
        setOpenMenu(null);
        setShowDossierList(null);
        setMenuPos(null);
    };

    const handleToggleMenu = (e: React.MouseEvent, itemId: string) => {
        e.stopPropagation();
        if (openMenu === itemId) {
            closeMenu();
            return;
        }
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const ESTIMATED_MENU_HEIGHT = 180;
        const spaceBelow = window.innerHeight - rect.bottom;
        const flipUp = spaceBelow < ESTIMATED_MENU_HEIGHT && rect.top > ESTIMATED_MENU_HEIGHT;
        setMenuPos({
            top: flipUp ? undefined : rect.bottom + 4,
            bottom: flipUp ? window.innerHeight - rect.top + 4 : undefined,
            right: window.innerWidth - rect.right,
        });
        setOpenMenu(itemId);
        setShowDossierList(null);
    };

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

    // Chiudi menu quando si clicca fuori, oppure quando l'utente scrolla
    // (il dropdown è position:fixed con coordinate calcolate, quindi non
    // riposiziona da solo — chiuderlo è la UX più semplice e coerente).
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                closeMenu();
            }
        };
        const handleScrollOrResize = () => closeMenu();
        document.addEventListener('mousedown', handleClickOutside);
        if (openMenu) {
            window.addEventListener('scroll', handleScrollOrResize, true);
            window.addEventListener('resize', handleScrollOrResize);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('scroll', handleScrollOrResize, true);
            window.removeEventListener('resize', handleScrollOrResize);
        };
    }, [openMenu]);

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
        const hasOverlay = clearConfirmOpen || createDossierFor !== null || openMenu !== null;
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
    }, [clearConfirmOpen, createDossierFor, openMenu, searchTerm]);

    const showFeedback = (message: string, type: 'success' | 'error' = 'success') => {
        setFeedback({ message, type });
    };

    const handleAddQuickNorm = (e: React.MouseEvent, item: any) => {
        e.stopPropagation();
        const searchParams = historyToSearchParams(item);
        const label = generateQuickNormLabel(item);
        addQuickNorm(label, searchParams);
        showFeedback('Aggiunto alle norme rapide');
        setOpenMenu(null);
    };

    const handleAddToDossier = (e: React.MouseEvent, item: any, dossierId: string) => {
        e.stopPropagation();
        const norma = historyToNormaVisitata(item);
        addToDossier(dossierId, norma, 'norma');
        showFeedback('Aggiunto al dossier');
        setOpenMenu(null);
        setShowDossierList(null);
    };

    const handleCreateDossierAndAdd = (e: React.MouseEvent, item: any) => {
        e.stopPropagation();
        setCreateDossierFor(item);
        setNewDossierTitle('');
        setOpenMenu(null);
        setShowDossierList(null);
    };

    const handleConfirmCreateDossier = () => {
        const title = newDossierTitle.trim();
        if (!title || !createDossierFor) return;
        const norma = historyToNormaVisitata(createDossierFor);
        createDossier(title);
        // Il dossier appena creato sarà l'ultimo nello store
        setTimeout(() => {
            const newDossier = appStore.getState().dossiers.slice(-1)[0];
            if (newDossier) {
                addToDossier(newDossier.id, norma, 'norma');
                showFeedback(`Creato "${title}" e aggiunta norma`);
            }
        }, 0);
        setCreateDossierFor(null);
        setNewDossierTitle('');
    };

    const handleClearHistory = () => {
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
        try {
            await deleteHistoryItem(id);
            setHistory(prev => prev.filter(item => item.id !== id));
        } catch (err) {
            console.error(err);
        }
    };

    const handleItemClick = (item: any) => {
        // Navigate to search page and trigger search
        navigate('/');
        triggerSearch({
            act_type: item.act_type,
            act_number: item.act_number || '',
            date: item.date || '',
            article: item.article?.toString() || '',
            version: 'vigente',
            version_date: '',
            show_brocardi_info: true
        });
    };

    useEffect(() => {
        getHistory()
            .then(data => {
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
                generateQuickNormLabel(item),
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
        <div className="max-w-4xl mx-auto animate-in fade-in duration-300">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
                {/* Mobile Header */}
                <div className="md:hidden p-3 border-b border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between mb-2">
                        <h2 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <Clock size={18} /> Cronologia
                        </h2>
                        {history.length > 0 && (
                            <button
                                onClick={handleClearHistory}
                                disabled={clearing}
                                className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50 min-h-[44px] min-w-[44px]"
                                title="Svuota cronologia"
                            >
                                {clearing ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                            </button>
                        )}
                    </div>
                    <div className="relative">
                        <input
                            ref={searchInputRef}
                            type="text"
                            placeholder="Cerca..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            aria-keyshortcuts="/"
                            title="Cerca (premi /)"
                            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-700 border-transparent focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900 transition-all min-h-[44px]"
                        />
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    </div>
                </div>

                {/* Desktop Header */}
                <div className="hidden md:flex p-4 border-b border-slate-200 dark:border-slate-700 flex-col sm:flex-row justify-between items-center gap-4">
                    <h2 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Clock size={20} /> Cronologia Ricerche
                    </h2>

                    <div className="flex items-center gap-2">
                        <div id="tour-history-search" className="relative w-full sm:w-64">
                            <input
                                ref={searchInputRef}
                                type="text"
                                placeholder="Cerca nella cronologia..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                aria-keyshortcuts="/"
                                title="Cerca (premi /)"
                                className="w-full pl-9 pr-4 py-1.5 text-sm rounded-full bg-slate-100 dark:bg-slate-700 border-transparent focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900 transition-all"
                            />
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        </div>
                        {history.length > 0 && (
                            <button
                                onClick={handleClearHistory}
                                disabled={clearing}
                                className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full transition-colors disabled:opacity-50"
                                title="Svuota cronologia"
                            >
                                {clearing ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                            </button>
                        )}
                    </div>
                </div>
                
                {/* Timeline with grouped dates. No inner scroll: the page is the
                    scroll context so the action dropdown isn't clipped. Sticky date
                    headers attach to the next overflow ancestor. */}
                <div className="p-3 md:p-6">
                    {loading ? (
                        <div className="p-8 text-center">
                            <Loader2 className="animate-spin mx-auto text-blue-500" size={24} />
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
                                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg inline-flex items-center gap-2 transition-colors min-h-[44px]"
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
                                    <div className="md:hidden flex items-center gap-2 mb-3 sticky top-0 bg-white dark:bg-slate-800 py-1 z-10">
                                        <div className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-900/30 px-2.5 py-1 rounded-full">
                                            <Calendar size={12} className="text-blue-600 dark:text-blue-400" />
                                            <span className="text-xs font-bold text-blue-600 dark:text-blue-400">{label}</span>
                                        </div>
                                        <div className="flex-1 h-px bg-gradient-to-r from-blue-200 dark:from-blue-800 to-transparent" />
                                    </div>

                                    {/* Desktop: full date label */}
                                    <div className="hidden md:flex items-center gap-3 mb-4 sticky top-0 bg-white dark:bg-slate-800 py-2 z-10">
                                        <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/30 px-3 py-1.5 rounded-full">
                                            <Calendar size={14} className="text-blue-600 dark:text-blue-400" />
                                            <span className="text-sm font-bold text-blue-600 dark:text-blue-400">{label}</span>
                                        </div>
                                        <div className="flex-1 h-px bg-gradient-to-r from-blue-200 dark:from-blue-800 to-transparent" />
                                    </div>

                                    {/* Timeline items */}
                                    {/* Mobile: simpler timeline */}
                                    <div className="md:hidden space-y-2">
                                        {items.map((item, idx) => (
                                            <div key={idx} className="relative">
                                                {/* Mobile Item card - compact, tap-friendly */}
                                                <div
                                                    onClick={() => handleItemClick(item)}
                                                    className={cn(
                                                        "relative bg-white dark:bg-slate-800 p-3 pl-4 rounded-lg border transition-all cursor-pointer min-h-[44px]",
                                                        "border-slate-200 dark:border-slate-700",
                                                        "active:scale-[0.98] active:border-blue-400"
                                                    )}
                                                >
                                                    {/* Act-type stripe — see desktop card for rationale */}
                                                    <span
                                                        aria-hidden
                                                        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
                                                        style={{ backgroundColor: stripeColor(item.act_type) }}
                                                    />
                                                    <div className="flex items-start justify-between gap-2">
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-1.5 mb-1">
                                                                <span className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded text-xs font-bold">
                                                                    Art. {item.article}
                                                                </span>
                                                                {item.act_number && (
                                                                    <span className="text-xs text-slate-500 dark:text-slate-400">
                                                                        n. {item.act_number}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <p className="font-semibold text-sm text-slate-900 dark:text-white capitalize truncate">
                                                                {item.act_type}
                                                            </p>
                                                            {item.created_at && (
                                                                <p
                                                                    className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5"
                                                                    title={new Date(item.created_at).toLocaleString('it-IT')}
                                                                >
                                                                    {formatDistanceToNow(new Date(item.created_at), { addSuffix: true, locale: it })}
                                                                </p>
                                                            )}
                                                        </div>
                                                        <ArrowRight size={18} className="text-blue-500 flex-shrink-0 mt-1" />
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Desktop: full timeline with dots */}
                                    <div className="hidden md:block space-y-3 pl-6 border-l-2 border-blue-100 dark:border-blue-900 relative">
                                        {items.map((item, idx) => (
                                            <div key={idx} id={idx === 0 ? 'tour-history-item' : undefined} className="relative group">
                                                {/* Timeline dot */}
                                                <div className="absolute -left-[27px] top-3 w-3 h-3 bg-blue-500 rounded-full ring-4 ring-white dark:ring-slate-800 group-hover:scale-125 transition-transform" />

                                                {/* Item card */}
                                                <div
                                                    onClick={() => handleItemClick(item)}
                                                    className={cn(
                                                        "relative bg-white dark:bg-slate-800 p-4 pl-5 rounded-xl border-2 transition-all cursor-pointer",
                                                        "border-slate-200 dark:border-slate-700",
                                                        "hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-md hover:-translate-y-0.5"
                                                    )}
                                                >
                                                    {/* Act-type stripe — rounded-l-xl matches card corner so it doesn't
                                                        poke past the rounded edges; we can't use overflow-hidden on the
                                                        card because the dropdown menu lives inside it. */}
                                                    <span
                                                        aria-hidden
                                                        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl"
                                                        style={{ backgroundColor: stripeColor(item.act_type) }}
                                                    />
                                                    <div className="flex justify-between items-start gap-4">
                                                        <div className="flex-1">
                                                            <div className="flex items-baseline gap-2 mb-2">
                                                                <p className="font-bold text-blue-600 dark:text-blue-400 text-lg capitalize">
                                                                    {item.act_type}
                                                                </p>
                                                                {item.act_number && (
                                                                    <span className="font-medium text-slate-700 dark:text-slate-300">
                                                                        n. {item.act_number}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="flex flex-wrap gap-2 text-sm text-slate-500 items-center">
                                                                <span className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-lg text-xs font-medium">
                                                                    Art. {item.article}
                                                                </span>
                                                                {item.date && (
                                                                    <span className="text-slate-500 dark:text-slate-400">
                                                                        del {item.date}
                                                                    </span>
                                                                )}
                                                                {item.created_at && (
                                                                    <span
                                                                        className="text-xs text-slate-400 dark:text-slate-500"
                                                                        title={new Date(item.created_at).toLocaleString('it-IT')}
                                                                    >
                                                                        {formatDistanceToNow(new Date(item.created_at), { addSuffix: true, locale: it })}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                                            {/* Menu azioni */}
                                                            <div className="relative" ref={openMenu === item.id ? menuRef : null}>
                                                                <button
                                                                    id={idx === 0 ? 'tour-history-actions' : undefined}
                                                                    onClick={(e) => handleToggleMenu(e, item.id)}
                                                                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                                                                    title="Altre azioni"
                                                                >
                                                                    <MoreVertical size={16} />
                                                                </button>

                                                                {/* Dropdown menu — position:fixed via menuPos to escape parent overflow */}
                                                                {openMenu === item.id && menuPos && (
                                                                    <div
                                                                        style={{
                                                                            position: 'fixed',
                                                                            top: menuPos.top,
                                                                            bottom: menuPos.bottom,
                                                                            right: menuPos.right,
                                                                            zIndex: 50,
                                                                        }}
                                                                        className="w-56 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 py-1"
                                                                    >
                                                                        {/* QuickNorm */}
                                                                        <button
                                                                            id={idx === 0 ? 'tour-history-quick-norm' : undefined}
                                                                            onClick={(e) => handleAddQuickNorm(e, item)}
                                                                            className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                                                                        >
                                                                            <Zap size={16} className="text-amber-500" />
                                                                            <span>Aggiungi a norme rapide</span>
                                                                        </button>

                                                                        {/* Divider */}
                                                                        <div className="my-1 border-t border-slate-200 dark:border-slate-700" />

                                                                        {/* Dossier */}
                                                                        <div className="relative">
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    setShowDossierList(showDossierList === item.id ? null : item.id);
                                                                                }}
                                                                                className="w-full px-3 py-2 text-left text-sm flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                                                                            >
                                                                                <span className="flex items-center gap-2">
                                                                                    <FolderPlus size={16} className="text-blue-500" />
                                                                                    <span>Aggiungi a dossier</span>
                                                                                </span>
                                                                                <ArrowRight size={14} className="text-slate-400" />
                                                                            </button>

                                                                            {/* Sub-menu dossier */}
                                                                            {showDossierList === item.id && (
                                                                                <div className="absolute left-full top-0 ml-1 w-48 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 py-1 max-h-64 overflow-y-auto">
                                                                                    {dossiers.length === 0 ? (
                                                                                        <p className="px-3 py-2 text-sm text-slate-500">Nessun dossier</p>
                                                                                    ) : (
                                                                                        dossiers.map(dossier => (
                                                                                            <button
                                                                                                key={dossier.id}
                                                                                                onClick={(e) => handleAddToDossier(e, item, dossier.id)}
                                                                                                className="w-full px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors truncate"
                                                                                            >
                                                                                                {dossier.title}
                                                                                            </button>
                                                                                        ))
                                                                                    )}
                                                                                    <div className="border-t border-slate-200 dark:border-slate-700 mt-1 pt-1">
                                                                                        <button
                                                                                            onClick={(e) => handleCreateDossierAndAdd(e, item)}
                                                                                            className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                                                                                        >
                                                                                            <Plus size={14} />
                                                                                            <span>Nuovo dossier...</span>
                                                                                        </button>
                                                                                    </div>
                                                                                </div>
                                                                            )}
                                                                        </div>

                                                                        {/* Divider */}
                                                                        <div className="my-1 border-t border-slate-200 dark:border-slate-700" />

                                                                        {/* Elimina */}
                                                                        <button
                                                                            onClick={(e) => {
                                                                                handleDeleteItem(e, item.id);
                                                                                setOpenMenu(null);
                                                                            }}
                                                                            className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                                                        >
                                                                            <Trash2 size={16} />
                                                                            <span>Rimuovi dalla cronologia</span>
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>

                                                            <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-blue-500 pointer-events-none">
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
                variant="danger"
                title="Svuotare la cronologia?"
                message="Tutte le ricerche salvate verranno rimosse. I dossier e i segnalibri non saranno toccati."
                confirmLabel="Svuota"
                onConfirm={handleConfirmClear}
                onCancel={() => setClearConfirmOpen(false)}
            />

            {/* New-dossier inline modal */}
            {createDossierFor && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md p-5">
                        <div className="flex items-start justify-between mb-3">
                            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                                Crea nuovo dossier
                            </h3>
                            <button
                                onClick={() => { setCreateDossierFor(null); setNewDossierTitle(''); }}
                                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded"
                                aria-label="Chiudi"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                            La norma verrà aggiunta automaticamente al nuovo dossier.
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
                            placeholder="Nome del dossier"
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
                                className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Crea e aggiungi
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
