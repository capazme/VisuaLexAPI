import { Folder } from 'lucide-react';
import type { Dossier } from '../../../types';

interface Props {
  currentDossierId: string;
  dossiers: Dossier[];
  onMove: (targetDossierId: string) => void;
  onClose: () => void;
}

export function MoveToDossierModal({ currentDossierId, dossiers, onMove, onClose }: Props) {
  const others = dossiers.filter((d) => d.id !== currentDossierId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-sm border border-slate-200 dark:border-slate-800">
        <div className="p-6">
          <h3 className="font-semibold text-lg text-slate-900 dark:text-white mb-4">Sposta in altro dossier</h3>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {others.map((d) => (
              <button
                key={d.id}
                onClick={() => onMove(d.id)}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <Folder size={16} className="text-blue-500" />
                {d.title}
              </button>
            ))}
            {others.length === 0 && (
              <p className="text-slate-500 text-sm text-center py-4">Nessun altro dossier disponibile</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="mt-4 w-full px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Annulla
          </button>
        </div>
      </div>
    </div>
  );
}
