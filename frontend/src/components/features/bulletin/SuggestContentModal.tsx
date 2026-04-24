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
  const { dossiers, quickNorms, customAliases, annotations, highlights } = useAppStore();

  const [selection, setSelection] = useState<EnvironmentSelection>(emptySelection);
  const [message, setMessage] = useState('');
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

  const hasSelection = useMemo(() => {
    return (
      selection.dossierIds.length > 0 ||
      selection.quickNormIds.length > 0 ||
      selection.aliasIds.length > 0 ||
      selection.annotationIds.length > 0 ||
      selection.highlightIds.length > 0
    );
  }, [selection]);

  const selectedCount = useMemo(() => ({
    dossiers: selection.dossierIds.length,
    quickNorms: selection.quickNormIds.length,
    aliases: selection.aliasIds.length,
    annotations: selection.annotationIds.length,
    highlights: selection.highlightIds.length,
  }), [selection]);

  const handleSubmit = async () => {
    if (!hasSelection) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const items: Array<{ itemType: 'annotation' | 'highlight' | 'dossier' | 'quickNorm' | 'alias'; payload: unknown }> = [];

      for (const id of selection.annotationIds) {
        const a = annotations.find(x => x.id === id);
        if (a) items.push({ itemType: 'annotation', payload: {
          articleId: a.articleId,
          anchorText: a.anchorText,
          startOffset: a.startOffset,
          text: a.text,
        }});
      }
      for (const id of selection.highlightIds) {
        const h = highlights.find(x => x.id === id);
        if (h) items.push({ itemType: 'highlight', payload: {
          articleId: h.articleId,
          anchorText: h.text,
          startOffset: h.startOffset ?? 0,
          endOffset: (h.startOffset ?? 0) + h.text.length,
          colorVar: h.color,
        }});
      }
      for (const id of selection.dossierIds) {
        const d = dossiers.find(x => x.id === id);
        if (d) items.push({ itemType: 'dossier', payload: {
          title: d.title,
          description: d.description,
          tags: d.tags ?? [],
          entries: d.items.map(it => ({
            articleRef: it.type === 'norma' ? it.data : undefined,
            note: it.type === 'note' ? it.data : undefined,
            status: it.status,
          })),
        }});
      }
      for (const id of selection.quickNormIds) {
        const qn = quickNorms.find(x => x.id === id);
        if (qn) items.push({ itemType: 'quickNorm', payload: {
          label: qn.label,
          searchParams: qn.searchParams,
          sourceUrl: qn.sourceUrl,
        }});
      }
      for (const id of selection.aliasIds) {
        const a = customAliases.find(x => x.id === id);
        if (a) items.push({ itemType: 'alias', payload: {
          trigger: a.trigger,
          aliasType: a.type,
          expandTo: a.expandTo,
          searchParams: a.searchParams,
          description: a.description,
        }});
      }

      await sharedEnvironmentService.createSuggestion(environment.id, {
        items,
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
            Seleziona gli elementi dal tuo stato corrente — note, evidenze, dossier, norme veloci e alias — da suggerire all'autore.
            L'autore potrà prendere o rifiutare ogni item singolarmente.
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
              {selectedCount.annotations > 0 && (
                <span className="px-2 py-0.5 bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 rounded-full">
                  {selectedCount.annotations} note
                </span>
              )}
              {selectedCount.highlights > 0 && (
                <span className="px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 rounded-full">
                  {selectedCount.highlights} evidenze
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
              maxLength={1000}
              aria-label="Messaggio opzionale per l'autore"
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
