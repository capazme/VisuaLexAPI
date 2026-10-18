import { useState } from 'react';
import { FolderPlus, Folder } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { cn } from '../../lib/utils';
import { Modal } from './Modal';
import type { DossierKind } from '../../types';
import { DossierKindChoice } from '../features/dossier/DossierKindChoice';
import { useDossierKind } from '../../features/sections/useSection';

interface DossierModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Create-only: picking an existing dossier to add an item to is now handled
// by AddToDossierPopover (two-click collection from the reading toolbar). This modal is reached from "+ Nuovo dossier" CTAs on
// the dossier list pages, so it only needs the creation form.
export function DossierModal({ isOpen, onClose }: DossierModalProps) {
  const { createDossier } = useAppStore();
  const [newDossierTitle, setNewDossierTitle] = useState('');
  // The section's kind, shown and changeable (sections spec S7); di lavoro, the cautious kind (spec D2), without Gymnasium.
  const startKind = useDossierKind() ?? 'lavoro';
  const [kind, setKind] = useState<DossierKind>(startKind);
  const [isCreating, setIsCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleCreate = async () => {
    const title = newDossierTitle.trim();
    if (!title || busy) return;
    setBusy(true);
    const id = await createDossier(title, undefined, kind);
    setBusy(false);
    if (!id) return; // creation failed: stay open, keep the typed title
    setNewDossierTitle('');
    setKind(startKind);
    setIsCreating(false);
    onClose();
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
            onClick={() => {
              // Every creation starts from the section's kind, whatever was chosen before «Annulla».
              setKind(startKind);
              setIsCreating(true);
            }}
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
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={newDossierTitle}
                onChange={(e) => setNewDossierTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreate();
                  if (e.key === 'Escape') setIsCreating(false);
                }}
                placeholder="Nome Dossier..."
                className="flex-1 rounded-md border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                autoFocus
                disabled={busy}
              />
              <button
                onClick={() => void handleCreate()}
                disabled={busy || !newDossierTitle.trim()}
                className="bg-primary-600 text-white px-4 py-2 rounded-md hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Crea
              </button>
              <button
                onClick={() => setIsCreating(false)}
                disabled={busy}
                className="text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 px-3 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Annulla
              </button>
            </div>
            <DossierKindChoice value={kind} onChange={setKind} disabled={busy} />
          </div>
        )}
      </div>
    </Modal>
  );
}
