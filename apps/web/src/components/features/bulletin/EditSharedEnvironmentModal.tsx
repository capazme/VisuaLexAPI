import { useState, useMemo } from 'react';
import { X, Save, History, AlertTriangle } from 'lucide-react';
import { EnvironmentContentViewer } from '../environments/EnvironmentContentViewer';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import { useAppStore } from '../../../store/useAppStore';
import type { SharedEnvironment, EnvironmentCategory, Environment } from '../../../types';
import type { EnvironmentSelection } from '../../../utils/environmentUtils';

interface EditSharedEnvironmentModalProps {
  environment: SharedEnvironment;
  onClose: () => void;
  onUpdated: (updated: SharedEnvironment) => void;
}

const CATEGORY_OPTIONS: { value: EnvironmentCategory; label: string }[] = [
  { value: 'compliance', label: 'Compliance' },
  { value: 'civil', label: 'Civile' },
  { value: 'penal', label: 'Penale' },
  { value: 'administrative', label: 'Amministrativo' },
  { value: 'eu', label: 'Europeo' },
  { value: 'other', label: 'Altro' },
];

export function EditSharedEnvironmentModal({
  environment,
  onClose,
  onUpdated,
}: EditSharedEnvironmentModalProps) {
  const { dossiers, quickNorms, customAliases, annotations, highlights } = useAppStore();

  // Form state
  const [title, setTitle] = useState(environment.title);
  const [description, setDescription] = useState(environment.description || '');
  const [category, setCategory] = useState<EnvironmentCategory>(environment.category);
  const [tags, setTags] = useState<string[]>(environment.tags);
  const [tagInput, setTagInput] = useState('');

  // Content selection - start with all selected from current state
  const [selection, setSelection] = useState<EnvironmentSelection>(() => ({
    dossierIds: dossiers.map(d => d.id),
    quickNormIds: quickNorms.map(qn => qn.id),
    aliasIds: customAliases.map(a => a.id),
    annotationIds: environment.includeNotes ? annotations.map(a => a.id) : [],
    highlightIds: environment.includeHighlights ? highlights.map(h => h.id) : [],
  }));

  // Versioning options
  const [changelog, setChangelog] = useState('');
  const [versionMode, setVersionMode] = useState<'replace' | 'coexist'>('replace');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create a pseudo-environment from current user state
  const currentStateEnv = useMemo<Partial<Environment>>(() => ({
    id: 'current-state',
    name: 'Il tuo stato corrente',
    dossiers,
    quickNorms,
    customAliases,
    annotations,
    highlights,
    createdAt: new Date().toISOString(),
  }), [dossiers, quickNorms, customAliases, annotations, highlights]);

  const hasContent = useMemo(() => {
    return (
      selection.dossierIds.length > 0 ||
      selection.quickNormIds.length > 0 ||
      selection.aliasIds.length > 0
    );
  }, [selection]);

  const handleAddTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !tags.includes(tag) && tags.length < 5) {
      setTags([...tags, tag]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  const handleSubmit = async () => {
    if (!title.trim() || !hasContent) return;

    setIsSubmitting(true);
    setError(null);

    try {
      // Build the new content
      const content = {
        dossiers: dossiers.filter(d => selection.dossierIds.includes(d.id)),
        quickNorms: quickNorms.filter(qn => selection.quickNormIds.includes(qn.id)),
        customAliases: customAliases.filter(a => selection.aliasIds.includes(a.id)),
        annotations: annotations.filter(a => selection.annotationIds.includes(a.id)),
        highlights: highlights.filter(h => selection.highlightIds.includes(h.id)),
      };

      const updated = await sharedEnvironmentService.updateWithVersion(environment.id, {
        title: title.trim(),
        description: description.trim() || null,
        content,
        category,
        tags,
        changelog: changelog.trim() || undefined,
        versionMode,
      });

      onUpdated(updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Errore nell\'aggiornamento';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-100 dark:bg-primary-900/30 rounded-xl flex items-center justify-center">
              <Save className="text-primary-600 dark:text-primary-400" size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Modifica ambiente
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Versione attuale: v{environment.currentVersion}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Titolo *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nome dell'ambiente"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Descrizione
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descrizione dell'ambiente..."
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Categoria
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as EnvironmentCategory)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Tag (max 5)
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-full text-sm"
                >
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    <X size={14} />
                  </button>
                </span>
              ))}
            </div>
            {tags.length < 5 && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                  placeholder="Aggiungi tag..."
                  className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={handleAddTag}
                  className="px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-sm"
                >
                  Aggiungi
                </button>
              </div>
            )}
          </div>

          {/* Content Selection */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Contenuto (dal tuo stato corrente)
            </label>
            <EnvironmentContentViewer
              environment={currentStateEnv}
              selectable={true}
              selection={selection}
              onSelectionChange={setSelection}
              maxHeight="200px"
            />
          </div>

          {/* Versioning Section */}
          <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
            <div className="flex items-center gap-2 mb-3">
              <History size={16} className="text-slate-500" />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Versioning
              </span>
            </div>

            {/* Changelog */}
            <div className="mb-3">
              <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">
                Changelog (opzionale)
              </label>
              <input
                type="text"
                value={changelog}
                onChange={(e) => setChangelog(e.target.value)}
                placeholder="Es: Aggiunto dossier GDPR, corretti alias..."
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            {/* Version Mode */}
            <div className="space-y-2">
              <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                <input
                  type="radio"
                  name="versionMode"
                  value="replace"
                  checked={versionMode === 'replace'}
                  onChange={() => setVersionMode('replace')}
                  className="mt-0.5"
                />
                <div>
                  <span className="text-sm font-medium text-slate-900 dark:text-white">
                    Sostituisci versione precedente
                  </span>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    La v{environment.currentVersion + 1} diventerà la nuova versione attiva
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                <input
                  type="radio"
                  name="versionMode"
                  value="coexist"
                  checked={versionMode === 'coexist'}
                  onChange={() => setVersionMode('coexist')}
                  className="mt-0.5"
                />
                <div>
                  <span className="text-sm font-medium text-slate-900 dark:text-white">
                    Affianca versione precedente
                  </span>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Entrambe le versioni rimarranno disponibili
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
              <AlertTriangle size={16} />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            Annulla
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || !hasContent || isSubmitting}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Salvataggio...
              </>
            ) : (
              <>
                <Save size={16} />
                Pubblica v{environment.currentVersion + 1}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
