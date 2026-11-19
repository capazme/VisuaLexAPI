import { useId, useState, useMemo } from 'react';
import { X, Lightbulb, Send, AlertCircle } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Expand } from '../../ui/Expand';
import { IconButton } from '../../ui/IconButton';
import { Textarea } from '../../ui/Textarea';
import { CARD_RADIUS, CONTROL_BORDER } from '../../ui/controlStyles';
import { cn } from '../../../lib/utils';
import { EnvironmentContentViewer } from './EnvironmentContentViewer';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import { useAppStore } from '../../../store/useAppStore';
import type { SharedEnvironment, Environment } from '../../../types';
import type { EnvironmentSelection } from '../../../utils/environmentUtils';
import { useLeftOutNotice } from './useLeftOutNotice';
import { travellingSelection } from '../../../utils/decisionAnchorsTravel';
import { dossierSuggestionPayload } from '../dossier/dossierUtils';

interface SuggestContentPanelProps {
  /** The dossier the suggestion goes to; null, closed. */
  environment: SharedEnvironment | null;
  onClose: () => void;
  onSuggested: () => void;
}

interface SuggestFormProps {
  environment: SharedEnvironment;
  headingId: string;
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

/**
 * «Suggerisci contenuto» in the page (LC114, L-73; it was a window over the content, with a veil): a space that opens
 * at the top of Explore (`Expand`), never over the content. The focus lands on the space, Esc closes it and the focus
 * goes back to the card's menu.
 */
export function SuggestContentPanel({ environment, onClose, onSuggested }: SuggestContentPanelProps) {
  // The dossier stays drawn while the space closes: the closing shows the form, not an empty box.
  const [shown, setShown] = useState(environment);
  if (environment && environment !== shown) setShown(environment);
  const headingId = useId();
  return (
    <Expand
      open={environment !== null}
      onClose={onClose}
      role="region"
      aria-labelledby={headingId}
      className={cn('bg-card', CARD_RADIUS, CONTROL_BORDER)}
    >
      {/* Closed, `Expand` draws nothing: opened again, the choice starts empty. */}
      {shown && <SuggestForm key={shown.id} environment={shown} headingId={headingId} onClose={onClose} onSuggested={onSuggested} />}
    </Expand>
  );
}

function SuggestForm({ environment, headingId, onClose, onSuggested }: SuggestFormProps) {
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

  const chosenAnnotations = useMemo(() => annotations.filter(a => selection.annotationIds.includes(a.id)), [annotations, selection.annotationIds]);
  const chosenHighlights = useMemo(() => highlights.filter(h => selection.highlightIds.includes(h.id)), [highlights, selection.highlightIds]);
  const leftOutNotice = useLeftOutNotice(chosenAnnotations, chosenHighlights);

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
      // Words a court withdrew are not suggested (spec §8.6).
      const travelling = await travellingSelection(chosenAnnotations, chosenHighlights);
      const items: Array<{ itemType: 'annotation' | 'highlight' | 'dossier' | 'quickNorm' | 'alias'; payload: unknown }> = [];

      for (const id of selection.annotationIds.filter(i => travelling.annotationIds.has(i))) {
        const a = annotations.find(x => x.id === id);
        if (a) items.push({ itemType: 'annotation', payload: {
          normaKey: a.normaKey,
          articleId: a.articleId,
          anchorText: a.anchorText,
          startOffset: a.startOffset,
          text: a.text,
        }});
      }
      for (const id of selection.highlightIds.filter(i => travelling.highlightIds.has(i))) {
        const h = highlights.find(x => x.id === id);
        if (h) items.push({ itemType: 'highlight', payload: {
          normaKey: h.normaKey,
          articleId: h.articleId,
          anchorText: h.text,
          startOffset: h.startOffset ?? 0,
          endOffset: (h.startOffset ?? 0) + h.text.length,
          colorVar: h.color,
        }});
      }
      for (const id of selection.dossierIds) {
        const d = dossiers.find(x => x.id === id);
        if (d) items.push({ itemType: 'dossier', payload: dossierSuggestionPayload(d) });
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

      if (items.length === 0) { setError('Nessun elemento da inviare.'); return; }
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
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 md:px-5 dark:border-slate-700">
        <div className="flex min-w-0 items-center gap-3">
          <Lightbulb className="shrink-0 text-amber-600 dark:text-amber-400" size={20} aria-hidden />
          <div className="min-w-0">
            <h2 id={headingId} className="text-base font-semibold text-slate-900 dark:text-white">
              Suggerisci contenuto
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              a «{environment.title}» di @{environment.user.username}
            </p>
          </div>
        </div>
        <IconButton onClick={onClose} aria-label="Chiudi" icon={<X aria-hidden />} className="shrink-0" />
      </div>

      <div className="space-y-4 px-4 py-4 md:px-5">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Seleziona gli elementi dal tuo stato corrente (note, evidenze, dossier, norme veloci e alias) da suggerire all'autore.
          L'autore potrà prendere o rifiutare ogni item singolarmente.
        </p>

        <div>
          <p className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Seleziona contenuti
          </p>
          <EnvironmentContentViewer
            environment={currentStateEnv}
            selectable={true}
            selection={selection}
            onSelectionChange={setSelection}
            maxHeight="250px"
          />
        </div>

        {hasSelection && (
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="text-slate-500 dark:text-slate-400">Selezionati:</span>
            {selectedCount.dossiers > 0 && (
              <span className="px-2 py-0.5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full">
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

        <Textarea
          label="Messaggio (opzionale)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Scrivi un messaggio per l'autore…"
          rows={3}
          maxLength={1000}
          className="resize-none"
        />

        {leftOutNotice && (
          <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{leftOutNotice}</p>
        )}

        {error && (
          <div role="alert" className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            <AlertCircle size={16} aria-hidden />
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="quiet" onClick={onClose}>
            Annulla
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={!hasSelection} loading={isSubmitting} icon={<Send size={16} aria-hidden />}>
            {isSubmitting ? 'Invio…' : 'Invia suggerimento'}
          </Button>
        </div>
      </div>
    </div>
  );
}
