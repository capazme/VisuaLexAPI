import { useState, useMemo } from 'react';
import { X, Lightbulb, Send, AlertCircle } from 'lucide-react';
import { EnvironmentContentViewer } from '../environments/EnvironmentContentViewer';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import { useAppStore } from '../../../store/useAppStore';
import type { SharedEnvironment, Environment } from '../../../types';
import type { EnvironmentSelection } from '../../../utils/environmentUtils';

interface SuggestContentModalProps {
  environment: SharedEnvironment;
  onClose: () => void;
  onSuggested: () => void;
}

const emptySelection: EnvironmentSelection = {
  dossierIds: [],
  quickNormIds: [],
  aliasIds: [],
  annotationIds: [],
  highlightIds: [],
};

export function SuggestContentModal({
  environment,
  onClose,
  onSuggested,
}: SuggestContentModalProps) {
  const { dossiers, quickNorms, customAliases } = useAppStore();

  const [selection, setSelection] = useState<EnvironmentSelection>(emptySelection);
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create a pseudo-environment from current user state (only content, no annotations/highlights)
  const currentStateEnv = useMemo<Partial<Environment>>(() => ({
    id: 'current-state',
    name: 'Il tuo stato corrente',
    dossiers,
    quickNorms,
    customAliases,
    annotations: [], // Empty - we don't suggest annotations
    highlights: [],  // Empty - we don't suggest highlights
    createdAt: new Date().toISOString(),
  }), [dossiers, quickNorms, customAliases]);

  const hasSelection = useMemo(() => {
    return (
      selection.dossierIds.length > 0 ||
      selection.quickNormIds.length > 0 ||
      selection.aliasIds.length > 0
    );
  }, [selection]);

  const selectedCount = useMemo(() => ({
    dossiers: selection.dossierIds.length,
    quickNorms: selection.quickNormIds.length,
    aliases: selection.aliasIds.length,
  }), [selection]);

  const handleSubmit = async () => {
    if (!hasSelection) return;

    setIsSubmitting(true);
    setError(null);

    try {
      // Build the content to suggest
      const content = {
        dossiers: dossiers.filter(d => selection.dossierIds.includes(d.id)),
        quickNorms: quickNorms.filter(qn => selection.quickNormIds.includes(qn.id)),
        customAliases: customAliases.filter(a => selection.aliasIds.includes(a.id)),
      };

      await sharedEnvironmentService.createSuggestion(environment.id, {
        content,
        message: message.trim() || undefined,
      });

      onSuggested();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Errore nell\'invio del suggerimento';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-xl flex items-center justify-center">
              <Lightbulb className="text-amber-600 dark:text-amber-400" size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Suggerisci contenuto
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                a "{environment.title}" di @{environment.user.username}
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
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Instructions */}
          <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3 text-sm text-slate-600 dark:text-slate-400">
            Seleziona gli elementi dal tuo stato corrente che vuoi suggerire. L'autore potrà
            approvare o rifiutare il suggerimento.
          </div>

          {/* Content Viewer with Selection */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Seleziona contenuti
            </label>
            <EnvironmentContentViewer
              environment={currentStateEnv}
              selectable={true}
              selection={selection}
              onSelectionChange={setSelection}
              maxHeight="250px"
            />
          </div>

          {/* Selection Summary */}
          {hasSelection && (
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="text-slate-500 dark:text-slate-400">Selezionati:</span>
              {selectedCount.dossiers > 0 && (
                <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-full">
                  {selectedCount.dossiers} dossier
                </span>
              )}
              {selectedCount.quickNorms > 0 && (
                <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full">
                  {selectedCount.quickNorms} QuickNorm
                </span>
              )}
              {selectedCount.aliases > 0 && (
                <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full">
                  {selectedCount.aliases} alias
                </span>
              )}
            </div>
          )}

          {/* Message */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Messaggio (opzionale)
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Scrivi un messaggio per l'autore..."
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
              <AlertCircle size={16} />
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
            disabled={!hasSelection || isSubmitting}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Invio...
              </>
            ) : (
              <>
                <Send size={16} />
                Invia suggerimento
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
