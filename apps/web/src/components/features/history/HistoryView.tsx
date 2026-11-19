import { useEffect, useState, useMemo, useRef } from 'react';
import { Search, ArrowRight, Trash2, Zap, FolderPlus, MoreVertical, Plus, X } from 'lucide-react';
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
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { Input } from '../../ui/Input';
import { Toast } from '../../ui/Toast';
import { Arrive } from '../../ui/Arrive';
import { HistoryListSkeleton } from '../../ui/Skeleton';

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
            className="animate-in fade-in duration-(--dur-pop)"
            action={
                <>
                    <div id="tour-history-search" className="min-w-0 flex-1 md:w-64 md:flex-none">
                        <Input
                            ref={searchInputRef}
                            type="text"
                            placeholder="Cerca nella cronologia…"
                            aria-label="Cerca nella cronologia"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            aria-keyshortcuts="/"
                            title="Cerca (premi /)"
                            icon={<Search size={16} aria-hidden />}
                        />
                    </div>
                    {history.length > 0 && (
                        <IconButton
                            onClick={handleClearHistory}
                            loading={clearing}
                            title="Svuota cronologia"
                            aria-label="Svuota cronologia"
                            icon={<Trash2 aria-hidden />}
                            className="shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300"
                        />
                    )}
                </>
            }
        >
            <NormaChangesSection onOpen={handleOpenNorma} />
            {/* No overflow at all: `hidden` made this card the date labels' scroll container (M1), and `clip` cut the
                «⋯» menus at its edge (LC103); its padding keeps everything inside the rounded corners. */}
            <div className="bg-white dark:bg-slate-800 rounded-[8px] shadow-sm border border-slate-200 dark:border-slate-700">
                {/* Timeline with grouped dates. No inner scroll: the page is the
                    scroll context so the action dropdown isn't clipped. Sticky date
                    headers attach to the page's scroller, under the phone's bar. */}
                <div className="p-3 md:p-6">
                    {/* The rows' place held while they are read, and their entrance (LC98, LC119). */}
                    <Arrive loading={loading} placeholder={<><p role="status" className="sr-only">Apro la cronologia…</p><HistoryListSkeleton /></>}>
                    {filteredHistory.length === 0 && history.length > 0 ? (
                        <EmptyState
                            variant="search"
                            title="Nessuna corrispondenza"
                            description={`Nessuna voce trovata per "${searchTerm}".`}
                            action={
                                <Button variant="secondary" onClick={() => setSearchTerm('')}>
                                    Azzera filtro
                                </Button>
                            }
                        />
                    ) : filteredHistory.length === 0 ? (
                        <EmptyState
                            variant="history"
                            title="Nessuna ricerca recente"
                            description="Le tue ricerche appariranno qui. Inizia cercando una norma per vedere la cronologia."
                            action={
                                <Button onClick={() => navigate('/')} icon={<Search size={16} aria-hidden />}>
                                    Inizia una ricerca
                                </Button>
                            }
                        />
                    ) : (
                        <div className="space-y-6 md:space-y-8">
                            {groupedByDate.map(({ key, label, items }) => (
                                <div key={key} className="relative">
                                    {/* Date label with timeline line */}
                                    {/* Mobile: smaller, simpler date label */}
                                    <div className="md:hidden flex items-center gap-2 mb-3 sticky top-[var(--phone-bar-offset,0px)] transition-[top] duration-(--dur-pop) ease-out motion-reduce:transition-none bg-slate-50 dark:bg-slate-950 py-1 z-10">
                                        <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">{label}</h2>
                                    </div>

                                    {/* Desktop: full date label */}
                                    <div className="hidden md:flex items-center gap-3 mb-4 sticky top-[var(--phone-bar-offset,0px)] transition-[top] duration-(--dur-pop) ease-out motion-reduce:transition-none bg-slate-50 dark:bg-slate-950 py-2 z-10">
                                        <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">{label}</h2>
                                    </div>

                                    {/* Timeline items */}
                                    {/* Mobile: simpler timeline */}
                                    <div className="md:hidden space-y-2">
                                        {items.map((item) => item.decision_key ? (
                                            <DecisionHistoryRow key={item.id} item={item} variant="mobile" onDelete={handleDeleteItem} />
                                        ) : (
                                            <div key={item.id} className="relative">
                                                {/* Mobile Item card - compact, tap-friendly; a button, so Tab reaches it and Enter opens it (A6) */}
                                                {/* bare-button: the card is a whole entry of the list. */}
                                                <button
                                                    type="button"
                                                    onClick={() => handleItemClick(item)}
                                                    className={cn(
                                                        "relative block w-full text-left bg-white dark:bg-slate-800 p-3 pr-12 rounded-[8px] border transition-[color,background-color,border-color,scale] cursor-pointer min-h-[44px]",
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
                                            <div key={item.id} id={idx === 0 ? 'tour-history-item' : undefined} className="relative group">

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
                                                        {/* bare-button: the row's title, stretched over the row (A6). */}
                                                        <button
                                                            type="button"
                                                            data-history-open
                                                            onClick={() => handleItemClick(item)}
                                                            className="flex-1 block text-left focus-visible:outline-none after:absolute after:inset-0 after:content-['']"
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

                                                            <div className="p-2 bg-primary-50 dark:bg-primary-900/20 rounded-md text-primary-500 pointer-events-none">
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
                    </Arrive>
                </div>
            </div>

            {/* Feedback: the app's notifications (K1a). */}
            <Toast
                message={feedback?.message ?? ''}
                type={feedback?.type ?? 'success'}
                isVisible={feedback !== null}
                onClose={() => setFeedback(null)}
                duration={2000}
            />

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
                    <div className="bg-white dark:bg-slate-900 rounded-[8px] shadow-lg w-full max-w-md p-5">
                        <div className="flex items-start justify-between mb-3">
                            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                                Crea nuova pratica
                            </h2>
                            <IconButton
                                onClick={() => { setCreateDossierFor(null); setNewDossierTitle(''); }}
                                aria-label="Chiudi"
                                icon={<X aria-hidden />}
                            />
                        </div>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                            La norma verrà aggiunta automaticamente alla nuova pratica.
                        </p>
                        <Input
                            type="text"
                            aria-label="Nome della pratica"
                            autoFocus
                            value={newDossierTitle}
                            onChange={(e) => setNewDossierTitle(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && newDossierTitle.trim()) handleConfirmCreateDossier();
                                if (e.key === 'Escape') { setCreateDossierFor(null); setNewDossierTitle(''); }
                            }}
                            placeholder="Nome della pratica"
                            maxLength={120}
                        />
                        <div className="mt-4 flex justify-end gap-2">
                            <Button variant="secondary" onClick={() => { setCreateDossierFor(null); setNewDossierTitle(''); }}>
                                Annulla
                            </Button>
                            <Button onClick={handleConfirmCreateDossier} disabled={!newDossierTitle.trim()}>
                                Crea e aggiungi
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </PageFrame>
    );
}
