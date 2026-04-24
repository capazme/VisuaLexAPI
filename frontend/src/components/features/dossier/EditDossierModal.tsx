import { useState } from 'react';
import type { Dossier } from '../../../types';

interface Props {
  dossier: Dossier;
  onClose: () => void;
  onSave: (title: string, description: string, tags: string[]) => void;
}

export function EditDossierModal({ dossier, onClose, onSave }: Props) {
  const [title, setTitle] = useState(dossier.title);
  const [description, setDescription] = useState(dossier.description ?? '');
  const [tagsInput, setTagsInput] = useState((dossier.tags ?? []).join(', '));

  const handleSave = () => {
    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
    onSave(title, description, tags);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-800">
        <div className="p-6">
          <h3 className="font-semibold text-lg text-slate-900 dark:text-white mb-4">Modifica Dossier</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Titolo</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrizione</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tag (separati da virgola)</label>
              <input
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="diritto civile, contratti, obbligazioni"
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={onClose}
              className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              Annulla
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              Salva
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
