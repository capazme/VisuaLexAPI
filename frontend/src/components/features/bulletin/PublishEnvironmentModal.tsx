import { useState } from 'react';
import { X, Share2, FileText, Tag, Folder, Check, AlertCircle } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import type { EnvironmentCategory, SharedEnvironment } from '../../../types';
import { getEnvironmentStats } from '../../../utils/environmentUtils';

interface PublishEnvironmentModalProps {
  onClose: () => void;
  onPublished: (env: SharedEnvironment) => void;
}

const CATEGORY_OPTIONS: { value: EnvironmentCategory; label: string }[] = [
  { value: 'compliance', label: 'Compliance' },
  { value: 'civil', label: 'Civile' },
  { value: 'penal', label: 'Penale' },
  { value: 'administrative', label: 'Amministrativo' },
  { value: 'eu', label: 'Europeo' },
  { value: 'other', label: 'Altro' },
];

export function PublishEnvironmentModal({ onClose, onPublished }: PublishEnvironmentModalProps) {
  const { environments } = useAppStore();

  // Form state
  const [selectedEnvId, setSelectedEnvId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<EnvironmentCategory>('other');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [includeNotes, setIncludeNotes] = useState(true);
  const [includeHighlights, setIncludeHighlights] = useState(true);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selected environment
  const selectedEnv = environments.find(e => e.id === selectedEnvId);

  // Handle environment selection
  const handleEnvSelect = (envId: string) => {
    setSelectedEnvId(envId);
    const env = environments.find(e => e.id === envId);
    if (env) {
      setTitle(env.name);
      setDescription(env.description || '');
      if (env.category) {
        setCategory(env.category);
      }
      if (env.tags) {
        setTags(env.tags);
      }
    }
  };

  // Handle tag add
  const handleAddTag = () => {
    const trimmed = tagInput.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed) && tags.length < 10) {
      setTags([...tags, trimmed]);
      setTagInput('');
    }
  };

  // Handle tag remove
  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag));
  };

  // Handle tag input keydown
  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  // Handle publish
  const handlePublish = async () => {
    if (!selectedEnv) return;

    setError(null);
    setLoading(true);

    try {
      const published = await sharedEnvironmentService.publish({
        title: title.trim(),
        description: description.trim() || undefined,
        content: {
          dossiers: selectedEnv.dossiers,
          quickNorms: selectedEnv.quickNorms,
          customAliases: selectedEnv.customAliases || [],
          annotations: includeNotes ? selectedEnv.annotations : [],
          highlights: includeHighlights ? selectedEnv.highlights : [],
        },
        category,
        tags,
        includeNotes,
        includeHighlights,
      });

      onPublished(published);
    } catch (err: any) {
      setError(err.message || 'Errore durante la pubblicazione');
    } finally {
      setLoading(false);
    }
  };

  // Stats for selected environment
  const stats = selectedEnv ? getEnvironmentStats(selectedEnv) : null;

  const isValid = selectedEnvId && title.trim().length >= 3;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Share2 size={20} className="text-primary-600" />
            Condividi ambiente
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <X size={20} className="text-slate-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Environment Selection */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Seleziona ambiente *
            </label>
            {environments.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 italic">
                Non hai ancora creato nessun ambiente. Vai alla pagina Ambienti per crearne uno.
              </p>
            ) : (
              <select
                value={selectedEnvId}
                onChange={(e) => handleEnvSelect(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500"
              >
                <option value="">Seleziona un ambiente...</option>
                {environments.map(env => (
                  <option key={env.id} value={env.id}>
                    {env.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Stats preview */}
          {stats && (
            <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                <span className="font-medium">{stats.dossiers}</span> dossier,{' '}
                <span className="font-medium">{stats.quickNorms}</span> norme rapide,{' '}
                <span className="font-medium">{stats.annotations}</span> annotazioni,{' '}
                <span className="font-medium">{stats.highlights}</span> evidenziazioni
              </p>
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              <FileText size={14} className="inline mr-1" />
              Titolo *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Es. Ambiente Diritto Civile - Obbligazioni"
              maxLength={100}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500"
            />
            <p className="text-xs text-slate-500 mt-1">{title.length}/100</p>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Descrizione
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descrivi brevemente il contenuto dell'ambiente..."
              maxLength={500}
              rows={3}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500 resize-none"
            />
            <p className="text-xs text-slate-500 mt-1">{description.length}/500</p>
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              <Folder size={14} className="inline mr-1" />
              Categoria *
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as EnvironmentCategory)}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500"
            >
              {CATEGORY_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              <Tag size={14} className="inline mr-1" />
              Tag (max 10)
            </label>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                placeholder="Aggiungi un tag..."
                maxLength={30}
                className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500"
              />
              <button
                onClick={handleAddTag}
                disabled={!tagInput.trim() || tags.length >= 10}
                className="px-3 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Aggiungi
              </button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {tags.map(tag => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-1 text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-full"
                  >
                    {tag}
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="hover:text-red-500 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Include options */}
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                includeNotes ? 'bg-primary-600 border-primary-600' : 'border-slate-300 dark:border-slate-600'
              }`}>
                {includeNotes && <Check size={14} className="text-white" />}
              </div>
              <input
                type="checkbox"
                checked={includeNotes}
                onChange={(e) => setIncludeNotes(e.target.checked)}
                className="sr-only"
              />
              <span className="text-sm text-slate-700 dark:text-slate-300">
                Includi annotazioni
              </span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                includeHighlights ? 'bg-primary-600 border-primary-600' : 'border-slate-300 dark:border-slate-600'
              }`}>
                {includeHighlights && <Check size={14} className="text-white" />}
              </div>
              <input
                type="checkbox"
                checked={includeHighlights}
                onChange={(e) => setIncludeHighlights(e.target.checked)}
                className="sr-only"
              />
              <span className="text-sm text-slate-700 dark:text-slate-300">
                Includi evidenziazioni
              </span>
            </label>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">
              <AlertCircle size={16} />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            Annulla
          </button>
          <button
            onClick={handlePublish}
            disabled={!isValid || loading}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Pubblicazione...
              </>
            ) : (
              <>
                <Share2 size={16} />
                Pubblica
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
