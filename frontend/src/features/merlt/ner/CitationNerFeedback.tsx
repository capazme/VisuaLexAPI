import { useState } from 'react';
import { Check, Ban, Pencil } from 'lucide-react';
import type { ParsedCitationData } from '../../../utils/citationMatcher';
import { formatCitationLabel } from '../../../utils/citationMatcher';
import type { NerFeedbackType, NerCorrectReference } from '../../../services/merltService';

export interface CitationNerFeedbackProps {
  citation: ParsedCitationData;
  onSubmit: (feedbackType: NerFeedbackType, correctReference?: NerCorrectReference) => void;
}

/**
 * Inline NER feedback for one detected legal citation (Loop β #2). Confirm (✓) /
 * reject (✗) / correct (mini-editor) feeds the authority-weighted RLCF training
 * store. Shared by the article cross-reference popup (surface=article_xref) and
 * the Q&A in-prose citations (surface=qa_chip). Keyed by citation upstream so
 * each gets fresh state (no set-state-in-effect reset). Legal lexicon — no
 * scores, bars, or gamification.
 */
export function CitationNerFeedback({ citation, onSubmit }: CitationNerFeedbackProps) {
  const [done, setDone] = useState<NerFeedbackType | null>(null);
  const [editing, setEditing] = useState(false);
  const [actType, setActType] = useState(citation.act_type ?? '');
  const [article, setArticle] = useState(citation.article ?? '');

  const submit = (type: NerFeedbackType, correctReference?: NerCorrectReference) => {
    onSubmit(type, correctReference);
    setEditing(false);
    setDone(type);
  };

  if (done) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400" role="status">
        <Check size={13} className="text-emerald-500" />
        {done === 'correction' ? 'Correzione registrata. Grazie.' : 'Grazie per il riscontro.'}
      </p>
    );
  }

  if (editing) {
    const canSave = actType.trim().length > 0 && article.trim().length > 0;
    return (
      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-600 dark:text-slate-300">Riferimento corretto</p>
        <div className="flex gap-2">
          <input
            value={actType}
            onChange={(e) => setActType(e.target.value)}
            placeholder="Tipo atto (es. codice civile)"
            aria-label="Tipo atto corretto"
            className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800"
          />
          <input
            value={article}
            onChange={(e) => setArticle(e.target.value)}
            placeholder="Articolo"
            aria-label="Articolo corretto"
            className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-md px-2 py-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            Annulla
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() =>
              submit('correction', {
                actType: actType.trim(),
                article: article.trim(),
                displayText: formatCitationLabel(citation),
              })
            }
            className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700"
          >
            Salva
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-slate-500 dark:text-slate-400">Citazione corretta?</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Conferma la citazione"
          onClick={() => submit('confirmation')}
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-emerald-50 hover:text-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:bg-emerald-950/40"
        >
          <Check size={14} />
        </button>
        <button
          type="button"
          aria-label="Segnala citazione errata"
          onClick={() => submit('false_positive')}
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-950/40"
        >
          <Ban size={14} />
        </button>
        <button
          type="button"
          aria-label="Correggi la citazione"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        >
          <Pencil size={13} /> Correggi
        </button>
      </div>
    </div>
  );
}
