import { useState } from 'react';
import { X, FolderPlus, Folder, Check } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

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
            <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border border-gray-200 dark:border-gray-800">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                    <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        Gestione Dossier
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full">
                        <X size={18} />
                    </button>
                </div>
                
                <div className="p-4">
                    {/* Create New */}
                    <div className="mb-4">
                        {!isCreating ? (
                            <button 
                                onClick={() => setIsCreating(true)}
                                className="w-full flex items-center justify-center gap-2 py-2 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg text-gray-500 hover:border-blue-500 hover:text-blue-500 transition-colors"
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
                                    className="flex-1 rounded-md border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-3 py-2"
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
                                    className="text-gray-500 hover:bg-gray-100 px-3 rounded-md"
                                >
                                    Annulla
                                </button>
                            </div>
                        )}
                    </div>

                    {/* List */}
                    <div className="space-y-2 max-h-[300px] overflow-y-auto">
                        {dossiers.length === 0 ? (
                            <p className="text-center text-gray-400 text-sm py-4">Nessun dossier presente.</p>
                        ) : (
                            dossiers.map(d => (
                                <button 
                                    key={d.id}
                                    onClick={() => handleAddToDossier(d.id)}
                                    className="w-full flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-transparent hover:border-blue-200 dark:hover:border-blue-800 group transition-all"
                                >
                                    <div className="flex items-center gap-3">
                                        <Folder className="text-blue-500" size={20} />
                                        <div className="text-left">
                                            <div className="font-medium text-gray-900 dark:text-white">{d.title}</div>
                                            <div className="text-xs text-gray-500">{d.items.length} elementi</div>
                                        </div>
                                    </div>
                                    {itemToAdd && (
                                        <div className="opacity-0 group-hover:opacity-100 text-blue-600">
                                            <Check size={18} />
                                        </div>
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

