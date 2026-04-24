import { useMemo, useState } from 'react';
import { X, Send } from 'lucide-react';
import { EnvironmentContentViewer } from '../environments/EnvironmentContentViewer';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import { useAppStore } from '../../../store/useAppStore';
import type { Environment, SuggestionItemType } from '../../../types';
import type { EnvironmentSelection } from '../../../utils/environmentUtils';

interface AddItemsDialogProps {
  suggestionId: string;
  onAdded: () => void;
  onClose: () => void;
}

const emptySelection: EnvironmentSelection = {
  dossierIds: [], quickNormIds: [], aliasIds: [], annotationIds: [], highlightIds: [],
};

export function AddItemsDialog({ suggestionId, onAdded, onClose }: AddItemsDialogProps) {
  const { dossiers, quickNorms, customAliases, annotations, highlights } = useAppStore();
  const [selection, setSelection] = useState<EnvironmentSelection>(emptySelection);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pseudoEnv = useMemo<Partial<Environment>>(() => ({
    id: 'current-state',
    name: 'Il tuo stato',
    dossiers, quickNorms, customAliases, annotations, highlights,
    createdAt: new Date().toISOString(),
  }), [dossiers, quickNorms, customAliases, annotations, highlights]);

  const hasSelection =
    selection.dossierIds.length + selection.quickNormIds.length + selection.aliasIds.length +
    selection.annotationIds.length + selection.highlightIds.length > 0;

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const items: Array<{ itemType: SuggestionItemType; payload: unknown }> = [];
      // (same per-type builder as SuggestContentModal — extract to a util
      //  when the third caller appears, not earlier.)
      for (const id of selection.annotationIds) {
        const a = annotations.find(x => x.id === id);
        if (a) items.push({ itemType: 'annotation', payload: {
          articleId: a.articleId, anchorText: a.anchorText, startOffset: a.startOffset, text: a.text,
        }});
      }
      for (const id of selection.highlightIds) {
        const h = highlights.find(x => x.id === id);
        if (h) items.push({ itemType: 'highlight', payload: {
          articleId: h.articleId, anchorText: h.text, startOffset: h.startOffset ?? 0,
          endOffset: (h.startOffset ?? 0) + h.text.length, colorVar: h.color,
        }});
      }
      for (const id of selection.dossierIds) {
        const d = dossiers.find(x => x.id === id);
        if (d) items.push({ itemType: 'dossier', payload: {
          title: d.title, description: d.description, tags: d.tags ?? [],
          entries: d.items.map(it => ({
            articleRef: it.type === 'norma' ? it.data : undefined,
            note: it.type === 'note' ? it.data : undefined, status: it.status,
          })),
        }});
      }
      for (const id of selection.quickNormIds) {
        const qn = quickNorms.find(x => x.id === id);
        if (qn) items.push({ itemType: 'quickNorm', payload: {
          label: qn.label, searchParams: qn.searchParams, sourceUrl: qn.sourceUrl,
        }});
      }
      for (const id of selection.aliasIds) {
        const a = customAliases.find(x => x.id === id);
        if (a) items.push({ itemType: 'alias', payload: {
          trigger: a.trigger, aliasType: a.type, expandTo: a.expandTo,
          searchParams: a.searchParams, description: a.description,
        }});
      }
      await sharedEnvironmentService.addSuggestionItems(suggestionId, { items });
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Aggiungi item al suggerimento</h2>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <EnvironmentContentViewer
            environment={pseudoEnv}
            selectable
            selection={selection}
            onSelectionChange={setSelection}
            maxHeight="250px"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg"
          >
            Annulla
          </button>
          <button
            onClick={submit}
            disabled={!hasSelection || busy}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
          >
            <Send size={16} /> {busy ? 'Invio...' : 'Aggiungi'}
          </button>
        </div>
      </div>
    </div>
  );
}
