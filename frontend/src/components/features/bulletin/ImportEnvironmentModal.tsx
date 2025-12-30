import { useState } from 'react';
import { X, Download, FileText, Check, AlertCircle, Layers, StickyNote, Highlighter } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import type { SharedEnvironment, Environment } from '../../../types';

interface ImportEnvironmentModalProps {
  sharedEnvironment: SharedEnvironment;
  onClose: () => void;
  onImported: () => void;
}

export function ImportEnvironmentModal({
  sharedEnvironment,
  onClose,
  onImported,
}: ImportEnvironmentModalProps) {
  const { importEnvironment } = useAppStore();

  // Options
  const [importNotes, setImportNotes] = useState(true);
  const [importHighlights, setImportHighlights] = useState(true);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Content stats
  const stats = {
    dossiers: sharedEnvironment.content.dossiers.length,
    quickNorms: sharedEnvironment.content.quickNorms.length,
    annotations: sharedEnvironment.content.annotations.length,
    highlights: sharedEnvironment.content.highlights.length,
  };

  const hasNotes = stats.annotations > 0 && sharedEnvironment.includeNotes;
  const hasHighlights = stats.highlights > 0 && sharedEnvironment.includeHighlights;

  // Handle import
  const handleImport = async () => {
    setError(null);
    setLoading(true);

    try {
      // Download the content (records the download on the server)
      const response = await sharedEnvironmentService.download(sharedEnvironment.id);

      // Filter content based on user choices
      const content = response.content;
      const filteredAnnotations = importNotes ? content.annotations : [];
      const filteredHighlights = importHighlights ? content.highlights : [];

      // Create local environment from shared content
      const newEnvironment: Environment = {
        id: crypto.randomUUID(),
        name: sharedEnvironment.title,
        description: sharedEnvironment.description,
        author: sharedEnvironment.user.username,
        version: '1.0',
        createdAt: new Date().toISOString(),
        dossiers: content.dossiers,
        quickNorms: content.quickNorms,
        customAliases: content.customAliases || [],
        annotations: filteredAnnotations,
        highlights: filteredHighlights,
        tags: sharedEnvironment.tags,
        category: sharedEnvironment.category,
      };

      // Import to local store
      importEnvironment(newEnvironment);

      onImported();
    } catch (err: any) {
      setError(err.message || 'Errore durante l\'importazione');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Download size={20} className="text-primary-600" />
            Importa ambiente
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <X size={20} className="text-slate-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Environment info */}
          <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
            <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
              {sharedEnvironment.title}
            </h3>
            {sharedEnvironment.description && (
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                {sharedEnvironment.description}
              </p>
            )}
            <p className="text-xs text-slate-500">
              Di <span className="font-medium">{sharedEnvironment.user.username}</span>
            </p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <Layers size={16} className="text-blue-600" />
              <span className="text-sm text-slate-700 dark:text-slate-300">
                <span className="font-medium">{stats.dossiers}</span> dossier
              </span>
            </div>
            <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
              <FileText size={16} className="text-green-600" />
              <span className="text-sm text-slate-700 dark:text-slate-300">
                <span className="font-medium">{stats.quickNorms}</span> norme
              </span>
            </div>
            {hasNotes && (
              <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                <StickyNote size={16} className="text-amber-600" />
                <span className="text-sm text-slate-700 dark:text-slate-300">
                  <span className="font-medium">{stats.annotations}</span> note
                </span>
              </div>
            )}
            {hasHighlights && (
              <div className="flex items-center gap-2 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                <Highlighter size={16} className="text-purple-600" />
                <span className="text-sm text-slate-700 dark:text-slate-300">
                  <span className="font-medium">{stats.highlights}</span> evidenziazioni
                </span>
              </div>
            )}
          </div>

          {/* Import options */}
          {(hasNotes || hasHighlights) && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Cosa vuoi importare?
              </p>

              {hasNotes && (
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                    importNotes ? 'bg-primary-600 border-primary-600' : 'border-slate-300 dark:border-slate-600'
                  }`}>
                    {importNotes && <Check size={14} className="text-white" />}
                  </div>
                  <input
                    type="checkbox"
                    checked={importNotes}
                    onChange={(e) => setImportNotes(e.target.checked)}
                    className="sr-only"
                  />
                  <span className="text-sm text-slate-700 dark:text-slate-300">
                    Importa annotazioni ({stats.annotations})
                  </span>
                </label>
              )}

              {hasHighlights && (
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                    importHighlights ? 'bg-primary-600 border-primary-600' : 'border-slate-300 dark:border-slate-600'
                  }`}>
                    {importHighlights && <Check size={14} className="text-white" />}
                  </div>
                  <input
                    type="checkbox"
                    checked={importHighlights}
                    onChange={(e) => setImportHighlights(e.target.checked)}
                    className="sr-only"
                  />
                  <span className="text-sm text-slate-700 dark:text-slate-300">
                    Importa evidenziazioni ({stats.highlights})
                  </span>
                </label>
              )}
            </div>
          )}

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
            onClick={handleImport}
            disabled={loading}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Importazione...
              </>
            ) : (
              <>
                <Download size={16} />
                Importa
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
