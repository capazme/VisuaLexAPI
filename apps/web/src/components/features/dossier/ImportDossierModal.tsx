import { FolderInput } from 'lucide-react';
import type { Dossier } from '../../../types';
import { computeItemCounts } from './dossierUtils';

interface Props {
  dossier: Dossier;
  /** What the check of a share link or a file left out, with the reason (`validateImportedDossier`). */
  discarded?: Array<{ index: number; reason: string }>;
  onClose: () => void;
  onConfirm: () => void;
}

export function ImportDossierModal({ dossier, discarded, onClose, onConfirm }: Props) {
  const counts = computeItemCounts(dossier.items);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-lg w-full p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
            <FolderInput className="text-blue-600" size={24} />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Importa Dossier</h2>
            <p className="text-sm text-slate-500">Qualcuno ha condiviso un dossier con te</p>
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-4 mb-4">
          <h3 className="font-medium text-slate-900 dark:text-white text-lg mb-2">{dossier.title}</h3>
          {dossier.description && (
            <p className="text-slate-600 dark:text-slate-300 text-sm mb-3">{dossier.description}</p>
          )}
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
              {dossier.items.length} elementi
            </span>
            {counts.norme > 0 && (
              <span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded">
                {counts.norme} articoli
              </span>
            )}
            {counts.sentenze > 0 && (
              <span className="px-2 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded">
                {counts.sentenze} {counts.sentenze === 1 ? 'sentenza' : 'sentenze'}
              </span>
            )}
            {counts.note > 0 && (
              <span className="px-2 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 rounded">
                {counts.note} note
              </span>
            )}
          </div>
          {dossier.tags && dossier.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-3">
              {dossier.tags.map((tag) => (
                <span key={tag} className="px-2 py-0.5 bg-slate-200 dark:bg-slate-600 rounded text-xs text-slate-600 dark:text-slate-300">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {discarded && discarded.length > 0 && (
          <div role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
            {discarded.length} {discarded.length === 1 ? 'voce non importabile' : 'voci non importabili'}:{' '}
            {[...new Set(discarded.map((d) => d.reason))].join('; ')}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Annulla
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            <FolderInput size={18} />
            Importa
          </button>
        </div>
      </div>
    </div>
  );
}
