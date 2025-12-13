import { useEffect, useState, useMemo } from 'react';
import { Clock, Loader2, Search, ArrowRight, Calendar } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import { useNavigate } from 'react-router-dom';

export function HistoryView() {
    const [history, setHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const { triggerSearch } = useAppStore();
    const navigate = useNavigate();

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

                                                        <div className="opacity-0 group-hover:opacity-100 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-blue-500 transition-all pointer-events-none">
                                                            <ArrowRight size={18} />
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
        </div>
    );
}
