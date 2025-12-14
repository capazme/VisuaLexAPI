import { useEffect, useState, useMemo, useRef } from 'react';
import { Clock, Loader2, Search, ArrowRight, Calendar, Trash2, X, Zap, FolderPlus, MoreVertical, Check, Plus } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import { useNavigate } from 'react-router-dom';
import type { NormaVisitata, SearchParams } from '../../../types';

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
    const [history, setHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [clearing, setClearing] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [openMenu, setOpenMenu] = useState<string | null>(null);
    const [showDossierList, setShowDossierList] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const {
        triggerSearch,
        addQuickNorm,
        dossiers,
        addToDossier,
        createDossier
    } = useAppStore();
    const navigate = useNavigate();

    // Chiudi menu quando si clicca fuori
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setOpenMenu(null);
                setShowDossierList(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Auto-hide feedback
    useEffect(() => {
        if (feedback) {
            const timer = setTimeout(() => setFeedback(null), 2000);
            return () => clearTimeout(timer);
        }
    }, [feedback]);

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
        const title = prompt('Nome del nuovo dossier:');
        if (title) {
            const norma = historyToNormaVisitata(item);
            createDossier(title);
            // Il dossier appena creato sarà l'ultimo
            setTimeout(() => {
                const newDossier = useAppStore.getState().dossiers.slice(-1)[0];
                if (newDossier) {
                    addToDossier(newDossier.id, norma, 'norma');
                    showFeedback(`Creato "${title}" e aggiunta norma`);
                }
            }, 0);
        }
        setOpenMenu(null);
        setShowDossierList(null);
    };

    const handleClearHistory = async () => {
        if (!confirm('Sei sicuro di voler svuotare la cronologia?')) return;
        setClearing(true);
        try {
            await fetch('/history', { method: 'DELETE' });
            setHistory([]);
        } catch (err) {
            console.error(err);
        } finally {
            setClearing(false);
        }
    };

    const handleDeleteItem = async (e: React.MouseEvent, timestamp: string) => {
        e.stopPropagation();
        try {
            await fetch(`/history/${encodeURIComponent(timestamp)}`, { method: 'DELETE' });
            setHistory(prev => prev.filter(item => item.timestamp !== timestamp));
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
        fetch('/history')
            .then(res => res.json())
            .then(data => {
                setHistory(data.history || []);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    }, []);

    const filteredHistory = history.filter(item => {
        const term = searchTerm.toLowerCase();
        return (
            item.act_type?.toLowerCase().includes(term) ||
            item.act_number?.includes(term) ||
            item.article?.toString().includes(term)
        );
    });

    // Group by date
    const groupedByDate = useMemo(() => {
        const groups: Record<string, any[]> = {};
        filteredHistory.forEach(item => {
            const date = item.timestamp ? new Date(item.timestamp).toLocaleDateString('it-IT') : 'Senza data';
            if (!groups[date]) groups[date] = [];
            groups[date].push(item);
        });
        return groups;
    }, [filteredHistory]);

    return (
        <div className="max-w-4xl mx-auto animate-in fade-in duration-300">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row justify-between items-center gap-4">
                    <h2 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <Clock size={20} /> Cronologia Ricerche
                    </h2>
                    
                    <div className="flex items-center gap-2">
                        <div className="relative w-full sm:w-64">
                            <input
                                type="text"
                                placeholder="Cerca nella cronologia..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-9 pr-4 py-1.5 text-sm rounded-full bg-gray-100 dark:bg-gray-700 border-transparent focus:border-blue-500 focus:bg-white dark:focus:bg-gray-900 transition-all"
                            />
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
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
                
                {/* Timeline with grouped dates */}
                <div className="max-h-[70vh] overflow-y-auto p-6">
                    {loading ? (
                        <div className="p-8 text-center">
                            <Loader2 className="animate-spin mx-auto text-blue-500" size={24} />
                        </div>
                    ) : filteredHistory.length === 0 ? (
                        <div className="p-12 text-center text-gray-500">
                            {searchTerm ? "Nessun risultato trovato." : "Nessuna ricerca recente."}
                        </div>
                    ) : (
                        <div className="space-y-8">
                            {Object.entries(groupedByDate).map(([date, items]) => (
                                <div key={date} className="relative">
                                    {/* Date label with timeline line */}
                                    <div className="flex items-center gap-3 mb-4 sticky top-0 bg-white dark:bg-gray-800 py-2 z-10">
                                        <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/30 px-3 py-1.5 rounded-full">
                                            <Calendar size={14} className="text-blue-600 dark:text-blue-400" />
                                            <span className="text-sm font-bold text-blue-600 dark:text-blue-400">{date}</span>
                                        </div>
                                        <div className="flex-1 h-px bg-gradient-to-r from-blue-200 dark:from-blue-800 to-transparent" />
                                    </div>

                                    {/* Timeline items */}
                                    <div className="space-y-3 pl-6 border-l-2 border-blue-100 dark:border-blue-900 relative">
                                        {items.map((item, idx) => (
                                            <div key={idx} className="relative group">
                                                {/* Timeline dot */}
                                                <div className="absolute -left-[27px] top-3 w-3 h-3 bg-blue-500 rounded-full ring-4 ring-white dark:ring-gray-800 group-hover:scale-125 transition-transform" />

                                                {/* Item card */}
                                                <div
                                                    onClick={() => handleItemClick(item)}
                                                    className={cn(
                                                        "bg-white dark:bg-gray-800 p-4 rounded-xl border-2 transition-all cursor-pointer",
                                                        "border-gray-200 dark:border-gray-700",
                                                        "hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-md hover:-translate-y-0.5"
                                                    )}
                                                >
                                                    <div className="flex justify-between items-start gap-4">
                                                        <div className="flex-1">
                                                            <div className="flex items-baseline gap-2 mb-2">
                                                                <p className="font-bold text-blue-600 dark:text-blue-400 text-lg capitalize">
                                                                    {item.act_type}
                                                                </p>
                                                                {item.act_number && (
                                                                    <span className="font-medium text-gray-700 dark:text-gray-300">
                                                                        n. {item.act_number}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="flex flex-wrap gap-2 text-sm text-gray-500">
                                                                <span className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-lg text-xs font-medium">
                                                                    Art. {item.article}
                                                                </span>
                                                                {item.date && (
                                                                    <span className="text-gray-500 dark:text-gray-400">
                                                                        del {item.date}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                                            {/* Menu azioni */}
                                                            <div className="relative" ref={openMenu === item.timestamp ? menuRef : null}>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setOpenMenu(openMenu === item.timestamp ? null : item.timestamp);
                                                                        setShowDossierList(null);
                                                                    }}
                                                                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                                                                    title="Altre azioni"
                                                                >
                                                                    <MoreVertical size={16} />
                                                                </button>

                                                                {/* Dropdown menu */}
                                                                {openMenu === item.timestamp && (
                                                                    <div className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50">
                                                                        {/* QuickNorm */}
                                                                        <button
                                                                            onClick={(e) => handleAddQuickNorm(e, item)}
                                                                            className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                                                        >
                                                                            <Zap size={16} className="text-amber-500" />
                                                                            <span>Aggiungi a norme rapide</span>
                                                                        </button>

                                                                        {/* Divider */}
                                                                        <div className="my-1 border-t border-gray-200 dark:border-gray-700" />

                                                                        {/* Dossier */}
                                                                        <div className="relative">
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    setShowDossierList(showDossierList === item.timestamp ? null : item.timestamp);
                                                                                }}
                                                                                className="w-full px-3 py-2 text-left text-sm flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                                                            >
                                                                                <span className="flex items-center gap-2">
                                                                                    <FolderPlus size={16} className="text-blue-500" />
                                                                                    <span>Aggiungi a dossier</span>
                                                                                </span>
                                                                                <ArrowRight size={14} className="text-gray-400" />
                                                                            </button>

                                                                            {/* Sub-menu dossier */}
                                                                            {showDossierList === item.timestamp && (
                                                                                <div className="absolute left-full top-0 ml-1 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 max-h-64 overflow-y-auto">
                                                                                    {dossiers.length === 0 ? (
                                                                                        <p className="px-3 py-2 text-sm text-gray-500">Nessun dossier</p>
                                                                                    ) : (
                                                                                        dossiers.map(dossier => (
                                                                                            <button
                                                                                                key={dossier.id}
                                                                                                onClick={(e) => handleAddToDossier(e, item, dossier.id)}
                                                                                                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors truncate"
                                                                                            >
                                                                                                {dossier.title}
                                                                                            </button>
                                                                                        ))
                                                                                    )}
                                                                                    <div className="border-t border-gray-200 dark:border-gray-700 mt-1 pt-1">
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
                                                                        <div className="my-1 border-t border-gray-200 dark:border-gray-700" />

                                                                        {/* Elimina */}
                                                                        <button
                                                                            onClick={(e) => {
                                                                                handleDeleteItem(e, item.timestamp);
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
                    "fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-in slide-in-from-bottom-2 z-50",
                    feedback.type === 'success'
                        ? "bg-green-500 text-white"
                        : "bg-red-500 text-white"
                )}>
                    <Check size={16} />
                    <span className="text-sm font-medium">{feedback.message}</span>
                </div>
            )}
        </div>
    );
}
