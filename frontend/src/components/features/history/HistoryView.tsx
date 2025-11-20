import { useEffect, useState } from 'react';
import { Clock, Loader2, Search, ArrowRight } from 'lucide-react';

export function HistoryView() {
    const [history, setHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

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
                
                <div className="divide-y divide-gray-200 dark:divide-gray-700 max-h-[70vh] overflow-y-auto">
                    {loading ? (
                        <div className="p-8 text-center">
                            <Loader2 className="animate-spin mx-auto text-blue-500" size={24} />
                        </div>
                    ) : filteredHistory.length === 0 ? (
                        <div className="p-12 text-center text-gray-500">
                            {searchTerm ? "Nessun risultato trovato." : "Nessuna ricerca recente."}
                        </div>
                    ) : (
                        filteredHistory.map((item, idx) => (
                            <div key={idx} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors flex justify-between items-center group">
                                <div>
                                    <div className="flex items-baseline gap-2">
                                        <p className="font-bold text-blue-600 dark:text-blue-400 text-lg capitalize">
                                            {item.act_type}
                                        </p>
                                        {item.act_number && <span className="font-medium text-gray-700 dark:text-gray-300">n. {item.act_number}</span>}
                                    </div>
                                    <div className="text-sm text-gray-500 mt-1 flex gap-3">
                                        <span className="bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-xs font-medium">Art. {item.article}</span>
                                        {item.date && <span>del {item.date}</span>}
                                    </div>
                                </div>
                                
                                <button className="opacity-0 group-hover:opacity-100 p-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-full text-blue-500 transition-all">
                                    <ArrowRight size={18} />
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
