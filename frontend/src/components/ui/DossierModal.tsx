import { useState } from 'react';
import { FolderPlus, Folder, Check, ChevronRight } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { cn } from '../../lib/utils';
import { Modal } from './Modal';
import type { NormaVisitata } from '../../types';

interface DossierModalProps {
  isOpen: boolean;
  onClose: () => void;
  itemToAdd?: NormaVisitata | unknown;
  itemType?: 'norma' | 'note';
}

export function DossierModal({ isOpen, onClose, itemToAdd, itemType = 'norma' }: DossierModalProps) {
  const { dossiers, createDossier, addToDossier } = useAppStore();
  const [newDossierTitle, setNewDossierTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = () => {
    if (!newDossierTitle.trim()) return;
    createDossier(newDossierTitle);
    setNewDossierTitle('');
    setIsCreating(false);
  };

  const handleAddToDossier = (dossierId: string) => {
    if (itemToAdd) {
      addToDossier(dossierId, itemToAdd as never, itemType);
      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      title="Gestione Dossier"
      icon={<Folder size={20} />}
      variant="info"
    >
      <div className="mb-4">
        {!isCreating ? (
          <button
            onClick={() => setIsCreating(true)}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-2 border-2 border-dashed rounded-lg transition-colors',
              'border-slate-300 dark:border-slate-700 text-slate-500',
              'hover:border-primary-500 hover:text-primary-500',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background'
            )}
          >
            <FolderPlus size={20} /> Crea Nuovo Dossier
          </button>
        ) : (
          <div className="flex gap-2">
            <input
              type="text"
              value={newDossierTitle}
              onChange={(e) => setNewDossierTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') setIsCreating(false);
              }}
              placeholder="Nome Dossier..."
              className="flex-1 rounded-md border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
              autoFocus
            />
            <button
              onClick={handleCreate}
              className="bg-primary-600 text-white px-4 py-2 rounded-md hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
            >
              Crea
            </button>
            <button
              onClick={() => setIsCreating(false)}
              className="text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 px-3 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
            >
              Annulla
            </button>
          </div>
        )}
      </div>

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
          dossiers.map((d) => (
            <button
              key={d.id}
              onClick={() => handleAddToDossier(d.id)}
              className={cn(
                'w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left group',
                'border-slate-200 dark:border-slate-700 hover:border-primary-500 dark:hover:border-primary-600',
                'bg-white dark:bg-slate-800 hover:bg-primary-50 dark:hover:bg-primary-900/10',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background'
              )}
            >
              <div className="p-3 bg-primary-50 dark:bg-primary-900/30 rounded-xl text-primary-600 dark:text-primary-400 shrink-0">
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
                  <Check size={20} className="text-primary-600 dark:text-primary-400" />
                </div>
              ) : (
                <ChevronRight size={20} className="text-slate-400 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors" />
              )}
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}
