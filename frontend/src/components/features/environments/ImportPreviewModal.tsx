import { useState } from 'react';
import { X, FileJson, Check } from 'lucide-react';
import type { Environment } from '../../../types';
import {
  ENVIRONMENT_CATEGORIES,
  createFullSelection,
  createEmptySelection,
  countSelectedItems,
  isAllSelected,
  type EnvironmentSelection,
} from '../../../utils/environmentUtils';
import { EnvironmentContentViewer } from './EnvironmentContentViewer';

interface ImportPreviewModalProps {
  environment: Environment;
  onClose: () => void;
  onConfirm: (selection: EnvironmentSelection, mode: 'merge' | 'replace') => void;
}

export function ImportPreviewModal({
  environment,
  onClose,
  onConfirm,
}: ImportPreviewModalProps) {
  const [selection, setSelection] = useState<EnvironmentSelection>(() => createFullSelection(environment));
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const category = environment.category ? ENVIRONMENT_CATEGORIES[environment.category] : null;
  const selectedCount = countSelectedItems(selection);
  const allSelected = isAllSelected(environment, selection);

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelection(createEmptySelection());
    } else {
      setSelection(createFullSelection(environment));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
              <FileJson className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base md:text-lg font-semibold text-slate-900 dark:text-white">Importa Ambiente</h2>
              <p className="text-xs text-slate-500">Seleziona cosa importare</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-2 -mr-2 min-h-[44px] flex items-center justify-center flex-shrink-0"
            aria-label="Chiudi"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 md:p-6 overflow-y-auto flex-1 space-y-4">
          {/* Environment Header */}
          <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 md:p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base md:text-lg">{category?.icon || '📁'}</span>
              <h3 className="font-medium text-sm md:text-base text-slate-900 dark:text-white">{environment.name}</h3>
            </div>
            {environment.description && (
              <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mb-2">{environment.description}</p>
            )}
            {(environment.author || environment.version) && (
              <div className="flex gap-3 text-xs text-slate-500 dark:text-slate-400">
                {environment.author && <span>Autore: {environment.author}</span>}
                {environment.version && <span>v{environment.version}</span>}
              </div>
            )}
          </div>

          {/* Select All Toggle */}
          <label className="flex items-center gap-2 cursor-pointer px-1">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Seleziona tutto
            </span>
          </label>

          {/* Content Viewer with Selection */}
          <EnvironmentContentViewer
            environment={environment}
            selectable
            selection={selection}
            onSelectionChange={setSelection}
            maxHeight="250px"
          />

          {/* Import Mode */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
              Modalita' Import
            </label>
            <div className="flex gap-3">
              <label className={`
                flex-1 flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors
                ${importMode === 'merge'
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                }
              `}>
                <input
                  type="radio"
                  name="importMode"
                  value="merge"
                  checked={importMode === 'merge'}
                  onChange={() => setImportMode('merge')}
                  className="w-4 h-4 text-blue-600"
                />
                <div>
                  <span className="text-sm font-medium text-slate-900 dark:text-white">Unisci</span>
                  <p className="text-xs text-slate-500">Aggiunge ai dati esistenti</p>
                </div>
              </label>

              <label className={`
                flex-1 flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors
                ${importMode === 'replace'
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                }
              `}>
                <input
                  type="radio"
                  name="importMode"
                  value="replace"
                  checked={importMode === 'replace'}
                  onChange={() => setImportMode('replace')}
                  className="w-4 h-4 text-blue-600"
                />
                <div>
                  <span className="text-sm font-medium text-slate-900 dark:text-white">Sostituisci</span>
                  <p className="text-xs text-slate-500">Rimpiazza i dati attuali</p>
                </div>
              </label>
            </div>
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
            onClick={() => onConfirm(selection, importMode)}
            disabled={selectedCount === 0}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 md:py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 text-white rounded-lg transition-colors disabled:cursor-not-allowed min-h-[44px]"
          >
            <Check size={18} />
            Importa {selectedCount > 0 && `(${selectedCount})`}
          </button>
        </div>
      </div>
    </div>
  );
}
