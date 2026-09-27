import { useState } from 'react';
import { X } from 'lucide-react';
import type { Annotation, Dossier, Highlight, CustomAlias, QuickNorm } from '../../../types';
import type { EnvironmentCategory } from '../../../types';
import {
  ENVIRONMENT_CATEGORIES,
  createFullSelection,
  createEmptySelection,
  countSelectedItems,
  isAllSelected,
  type EnvironmentSelection,
} from '../../../utils/environmentUtils';
import { EnvironmentContentViewer } from './EnvironmentContentViewer';

interface CreateEnvironmentOptions {
  description?: string;
  author?: string;
  version?: string;
  category?: EnvironmentCategory;
}

interface CreateEnvironmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (
    name: string,
    selection: EnvironmentSelection | null,
    options: CreateEnvironmentOptions
  ) => void;
  currentState: {
    dossiers: Dossier[];
    quickNorms: QuickNorm[];
    customAliases: CustomAlias[];
    annotations: Annotation[];
    highlights: Highlight[];
  };
}

export function CreateEnvironmentModal({
  isOpen,
  onClose,
  onCreate,
  currentState,
}: CreateEnvironmentModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [author, setAuthor] = useState('');
  const [version, setVersion] = useState('');
  const [category, setCategory] = useState<EnvironmentCategory>('other');
  const [includeContent, setIncludeContent] = useState(true);

  // Create environment representation of current state
  const currentAsEnv = {
    dossiers: currentState.dossiers,
    quickNorms: currentState.quickNorms,
    customAliases: currentState.customAliases,
    annotations: currentState.annotations,
    highlights: currentState.highlights,
  };

  const [selection, setSelection] = useState<EnvironmentSelection>(() => createFullSelection(currentAsEnv));

  // Update selection when includeContent changes
  const toggleIncludeContent = (include: boolean) => {
    setIncludeContent(include);
    if (include) {
      setSelection(createFullSelection(currentAsEnv));
    } else {
      setSelection(createEmptySelection());
    }
  };

  if (!isOpen) return null;

  const selectedCount = countSelectedItems(selection);
  const allSelected = isAllSelected(currentAsEnv, selection);
  const hasContent = currentState.dossiers.length > 0 ||
    currentState.quickNorms.length > 0 ||
    currentState.customAliases.length > 0 ||
    currentState.annotations.length > 0 ||
    currentState.highlights.length > 0;

  const handleSubmit = () => {
    if (!name.trim()) return;
    const selectionToUse = includeContent && selectedCount > 0 ? selection : null;
    onCreate(name.trim(), selectionToUse, {
      description: description.trim() || undefined,
      author: author.trim() || undefined,
      version: version.trim() || undefined,
      category
    });
    setName('');
    setDescription('');
    setAuthor('');
    setVersion('');
    setCategory('other');
    setIncludeContent(true);
    setSelection(createFullSelection(currentAsEnv));
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelection(createEmptySelection());
    } else {
      setSelection(createFullSelection(currentAsEnv));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <h2 className="text-base md:text-lg font-semibold text-slate-900 dark:text-white">Nuovo Ambiente</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-2 -mr-2 min-h-[44px] flex items-center justify-center"
            aria-label="Chiudi"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 md:p-6 space-y-4 overflow-y-auto flex-1">
          {/* Basic Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="es. DPO Compliance"
                className="w-full px-3 py-2.5 md:py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 min-h-[44px]"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Autore</label>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="es. Mario Rossi"
                className="w-full px-3 py-2.5 md:py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 min-h-[44px]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Versione</label>
              <input
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="es. 1.0"
                className="w-full px-3 py-2.5 md:py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 min-h-[44px]"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrizione</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descrizione opzionale..."
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

          {/* Content Selection */}
          {hasContent && (
            <>
              <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                <label className="flex items-center gap-2 cursor-pointer mb-3">
                  <input
                    type="checkbox"
                    checked={includeContent}
                    onChange={(e) => toggleIncludeContent(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Includi contenuto dallo stato corrente
                  </span>
                </label>

                {includeContent && (
                  <>
                    <label className="flex items-center gap-2 cursor-pointer mb-3 ml-6">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-600 dark:text-slate-400">
                        Seleziona tutto
                      </span>
                    </label>

                    <EnvironmentContentViewer
                      environment={currentAsEnv}
                      selectable
                      selection={selection}
                      onSelectionChange={setSelection}
                      maxHeight="200px"
                      compact
                    />
                  </>
                )}
              </div>
            </>
          )}

          {!hasContent && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                Non hai ancora dossier, QuickNorms o annotazioni. L'ambiente verra' creato vuoto.
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-3 px-4 md:px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 md:py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors min-h-[44px]"
          >
            Annulla
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="flex-1 py-2.5 md:py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 text-white rounded-lg transition-colors disabled:cursor-not-allowed min-h-[44px]"
          >
            Crea {includeContent && selectedCount > 0 && `(${selectedCount} elementi)`}
          </button>
        </div>
      </div>
    </div>
  );
}
