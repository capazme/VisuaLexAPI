import { useState } from 'react';
import { X, FolderPlus, Folder, Check, ChevronRight } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { cn } from '../../lib/utils';

interface DossierModalProps {
    isOpen: boolean;
    onClose: () => void;
    itemToAdd?: any; // NormaVisitata or Note
    itemType?: 'norma' | 'note';
}

export function DossierModal({ isOpen, onClose, itemToAdd, itemType = 'norma' }: DossierModalProps) {
    const { dossiers, createDossier, addToDossier } = useAppStore();
    const [newDossierTitle, setNewDossierTitle] = useState('');
    const [isCreating, setIsCreating] = useState(false);

    if (!isOpen) return null;

    const handleCreate = () => {
        if (!newDossierTitle.trim()) return;
        createDossier(newDossierTitle);
        setNewDossierTitle('');
        setIsCreating(false);
    };

    const handleAddToDossier = (dossierId: string) => {
        if (itemToAdd) {
            addToDossier(dossierId, itemToAdd, itemType);
            onClose(); // Close after adding
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                    <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        Gestione Dossier
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full">
                        <X size={18} />
                    </button>
                </div>
                
                <div className="p-4">
                    {/* Create New */}
                    <div className="mb-4">
                        {!isCreating ? (
                            <button 
                                onClick={() => setIsCreating(true)}
                                className="w-full flex items-center justify-center gap-2 py-2 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg text-slate-500 hover:border-blue-500 hover:text-blue-500 transition-colors"
                            >
                                <FolderPlus size={20} /> Crea Nuovo Dossier
                            </button>
                        ) : (
                            <div className="flex gap-2">
                                <input 
                                    type="text" 
                                    value={newDossierTitle}
                                    onChange={(e) => setNewDossierTitle(e.target.value)}
                                    placeholder="Nome Dossier..."
                                    className="flex-1 rounded-md border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2"
                                    autoFocus
                                />
                                <button 
                                    onClick={handleCreate}
                                    className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
                                >
                                    Crea
                                </button>
                                <button 
                                    onClick={() => setIsCreating(false)}
                                    className="text-slate-500 hover:bg-slate-100 px-3 rounded-md"
                                >
                                    Annulla
                                </button>
                            </div>
                        )}
                    </div>

                    {/* List with Rich Cards */}
                    <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
                        {dossiers.length === 0 ? (
                            <div className="text-center py-12">
                                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 mb-4">
                                    <Folder size={32} className="text-slate-400" />
                                </div>
                                <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-1">Nessun dossier presente</p>
                                <p className="text-slate-400 text-xs">Crea il tuo primo dossier per iniziare</p>
                            </div>
                        ) : (
                            dossiers.map(d => (
                                <button
                                    key={d.id}
                                    onClick={() => handleAddToDossier(d.id)}
                                    className={cn(
                                        "w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left group",
                                        "border-slate-200 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-600",
                                        "bg-white dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-900/10"
                                    )}
                                >
                                    <div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-xl text-blue-600 dark:text-blue-400 shrink-0">
                                        <Folder size={24} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h4 className="font-semibold text-slate-900 dark:text-white mb-0.5 truncate">{d.title}</h4>
                                        <p className="text-sm text-slate-500 dark:text-slate-400">
                                            {d.items.length} {d.items.length === 1 ? 'elemento' : 'elementi'}
                                        </p>
                                    </div>
                                    {itemToAdd ? (
                                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Check size={20} className="text-blue-600 dark:text-blue-400" />
                                        </div>
                                    ) : (
                                        <ChevronRight size={20} className="text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" />
                                    )}
                                </button>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

