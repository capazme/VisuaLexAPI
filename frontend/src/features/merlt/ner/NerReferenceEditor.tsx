import { useState } from 'react';

export interface NerReference {
  actType: string;
  article: string;
}

export interface NerReferenceEditorProps {
  initialActType?: string;
  initialArticle?: string;
  onSave: (reference: NerReference) => void;
  onCancel: () => void;
  /** Visible heading and the two inputs' accessible names. */
  heading?: string;
  actTypeLabel?: string;
  articleLabel?: string;
  /** Focus the act-type input on mount (the standalone "missed" editor). */
  autoFocus?: boolean;
}

/**
 * The act type + article mini-editor of the NER feedback (Loop β #2), shared
 * by the "Correggi" path of a detected citation (CitationNerFeedback) and by
 * the "Segnala come citazione" path for a reference the detector missed
 * (MissedCitationReporter). Both fill `correctReference.{actType, article}`,
 * the camelCase keys the MERL-T trainer reads. Keyed upstream, so each opening
 * starts from its own initial values (no set-state-in-effect reset).
 */
export function NerReferenceEditor({
  initialActType = '',
  initialArticle = '',
  onSave,
  onCancel,
  heading = 'Riferimento corretto',
  actTypeLabel = 'Tipo atto corretto',
  articleLabel = 'Articolo corretto',
  autoFocus = false,
}: NerReferenceEditorProps) {
  const [actType, setActType] = useState(initialActType);
  const [article, setArticle] = useState(initialArticle);
  const canSave = actType.trim().length > 0 && article.trim().length > 0;

  const save = (): void => {
    if (!canSave) return;
    onSave({ actType: actType.trim(), article: article.trim() });
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-slate-600 dark:text-slate-300">{heading}</p>
      <div className="flex gap-2">
        <input
          value={actType}
          onChange={(e) => setActType(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              save();
            }
          }}
          autoFocus={autoFocus}
          placeholder="Tipo atto (es. codice civile)"
          aria-label={actTypeLabel}
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800"
        />
        <input
          value={article}
          onChange={(e) => setArticle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              save();
            }
          }}
          placeholder="Articolo"
          aria-label={articleLabel}
          className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          Annulla
        </button>
        <button
          type="button"
          disabled={!canSave}
          onClick={save}
          className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700"
        >
          Salva
        </button>
      </div>
    </div>
  );
}
