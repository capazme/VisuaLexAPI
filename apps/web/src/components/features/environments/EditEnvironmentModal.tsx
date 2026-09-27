import { useState } from 'react';
import { X } from 'lucide-react';
import type { Environment, EnvironmentCategory } from '../../../types';
import { ENVIRONMENT_CATEGORIES } from '../../../utils/environmentUtils';

interface EditEnvironmentModalProps {
  environment: Environment;
  onClose: () => void;
  onSave: (updates: Partial<Environment>) => void;
}

export function EditEnvironmentModal({
  environment,
  onClose,
  onSave,
}: EditEnvironmentModalProps) {
  const [name, setName] = useState(environment.name);
  const [description, setDescription] = useState(environment.description || '');
  const [category, setCategory] = useState<EnvironmentCategory>(environment.category || 'other');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <h2 className="text-base md:text-lg font-semibold text-slate-900 dark:text-white">Modifica Ambiente</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-2 -mr-2 min-h-[44px] flex items-center justify-center"
            aria-label="Chiudi"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 md:p-6 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2.5 md:py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 min-h-[44px]"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrizione</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2.5 md:py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Categoria</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as EnvironmentCategory)}
              className="w-full px-3 py-2.5 md:py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 min-h-[44px]"
            >
              {Object.entries(ENVIRONMENT_CATEGORIES).map(([key, { label, icon }]) => (
                <option key={key} value={key}>{icon} {label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-3 px-4 md:px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 md:py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors min-h-[44px]"
          >
            Annulla
          </button>
          <button
            onClick={() => onSave({ name, description: description || undefined, category })}
            disabled={!name.trim()}
            className="flex-1 py-2.5 md:py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors min-h-[44px]"
          >
            Salva
          </button>
        </div>
      </div>
    </div>
  );
}
