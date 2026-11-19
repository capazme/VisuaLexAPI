import { useMemo, useState } from 'react';
import { useLeftOutNotice } from './useLeftOutNotice';
import { travellingSelection } from '../../../utils/decisionAnchorsTravel';
import { Send } from 'lucide-react';
import { Button } from '../../ui/Button';
import { EnvironmentContentViewer } from './EnvironmentContentViewer';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import { useAppStore } from '../../../store/useAppStore';
import type { Environment, SuggestionItemType } from '../../../types';
import type { EnvironmentSelection } from '../../../utils/environmentUtils';
import { dossierSuggestionPayload } from '../dossier/dossierUtils';

interface AddItemsDialogProps {
  suggestionId: string;
  onAdded: () => void;
  onClose: () => void;
  /** While the server works: the space around it waits (Esc, «Chiudi»). */
  setBusy?: (busy: boolean) => void;
}

const emptySelection: EnvironmentSelection = {
  dossierIds: [], quickNormIds: [], aliasIds: [], annotationIds: [], highlightIds: [],
};

/** «Aggiungi item» to a sent suggestion: the user's own content to choose from, one request. The form inside the space
 * that opens under the command in the editing (LC140, L-73; it was a window with a veil). */
export function AddItemsDialog({ suggestionId, onAdded, onClose, setBusy: setOuterBusy }: AddItemsDialogProps) {
  const { dossiers, quickNorms, customAliases, annotations, highlights } = useAppStore();
  const [selection, setSelection] = useState<EnvironmentSelection>(emptySelection);
  const [busy, setOwnBusy] = useState(false);
  const setBusy = (value: boolean) => { setOwnBusy(value); setOuterBusy?.(value); };
  const [error, setError] = useState<string | null>(null);

  const pseudoEnv = useMemo<Partial<Environment>>(() => ({
    id: 'current-state',
    name: 'Il tuo stato',
    dossiers, quickNorms, customAliases, annotations, highlights,
    createdAt: new Date().toISOString(),
  }), [dossiers, quickNorms, customAliases, annotations, highlights]);

  const chosenAnnotations = useMemo(() => annotations.filter(a => selection.annotationIds.includes(a.id)), [annotations, selection.annotationIds]);
  const chosenHighlights = useMemo(() => highlights.filter(h => selection.highlightIds.includes(h.id)), [highlights, selection.highlightIds]);
  const leftOutNotice = useLeftOutNotice(chosenAnnotations, chosenHighlights);

  const hasSelection =
    selection.dossierIds.length + selection.quickNormIds.length + selection.aliasIds.length +
    selection.annotationIds.length + selection.highlightIds.length > 0;

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      // Words a court withdrew are not offered (spec §8.6).
      const travelling = await travellingSelection(chosenAnnotations, chosenHighlights);
      const items: Array<{ itemType: SuggestionItemType; payload: unknown }> = [];
      // (same per-type builder as SuggestContentPanel — extract to a util
      //  when the third caller appears, not earlier.)
      for (const id of selection.annotationIds.filter(i => travelling.annotationIds.has(i))) {
        const a = annotations.find(x => x.id === id);
        if (a) items.push({ itemType: 'annotation', payload: {
          normaKey: a.normaKey, articleId: a.articleId, anchorText: a.anchorText, startOffset: a.startOffset, text: a.text,
        }});
      }
      for (const id of selection.highlightIds.filter(i => travelling.highlightIds.has(i))) {
        const h = highlights.find(x => x.id === id);
        if (h) items.push({ itemType: 'highlight', payload: {
          normaKey: h.normaKey, articleId: h.articleId, anchorText: h.text, startOffset: h.startOffset ?? 0,
          endOffset: (h.startOffset ?? 0) + h.text.length, colorVar: h.color,
        }});
      }
      for (const id of selection.dossierIds) {
        const d = dossiers.find(x => x.id === id);
        if (d) items.push({ itemType: 'dossier', payload: dossierSuggestionPayload(d) });
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
      if (items.length === 0) { setError('Nessun elemento da inviare.'); return; }
      await sharedEnvironmentService.addSuggestionItems(suggestionId, { items });
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <EnvironmentContentViewer
        environment={pseudoEnv}
        selectable
        selection={selection}
        onSelectionChange={setSelection}
        maxHeight="250px"
      />
      {leftOutNotice && (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{leftOutNotice}</p>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center justify-end gap-3">
        <Button variant="quiet" onClick={onClose} disabled={busy}>Annulla</Button>
        <Button onClick={() => void submit()} disabled={!hasSelection} loading={busy} icon={<Send size={16} aria-hidden />}>
          {busy ? 'Invio…' : 'Aggiungi'}
        </Button>
      </div>
    </>
  );
}
