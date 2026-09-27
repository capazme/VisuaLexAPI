import { useState } from 'react';
import { Check, Ban, Loader2, Pencil } from 'lucide-react';
import type { ParsedCitationData } from '../../../utils/citationMatcher';
import { formatCitationLabel } from '../../../utils/citationMatcher';
import type { NerFeedbackType, NerCorrectReference } from '../../../services/merltService';
import { NerReferenceEditor } from './NerReferenceEditor';

export interface CitationNerFeedbackProps {
  citation: ParsedCitationData;
  /**
   * Forward one feedback. When it returns a Promise the confirmation waits for
   * it: resolved → the thank-you line; rejected → the choice row comes back
   * with a "non registrato" note, so a failed request never reads as saved. A
   * void return keeps the immediate (optimistic) confirmation.
   */
  onSubmit: (feedbackType: NerFeedbackType, correctReference?: NerCorrectReference) => void | Promise<unknown>;
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
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);

  const submit = (type: NerFeedbackType, correctReference?: NerCorrectReference) => {
    if (pending) return;
    const result = onSubmit(type, correctReference);
    setEditing(false);
    if (!result) {
      setDone(type);
      return;
    }
    setPending(true);
    setFailed(false);
    result.then(
      () => {
        setPending(false);
        setDone(type);
      },
      (err: unknown) => {
        console.error('NER feedback failed:', err);
        setPending(false);
        setFailed(true);
      },
    );
  };

  if (pending) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400" role="status">
        <Loader2 size={13} className="animate-spin" aria-hidden="true" />
        Invio del riscontro…
      </p>
    );
  }

  if (done) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400" role="status">
        <Check size={13} className="text-emerald-500" />
        {done === 'correction' ? 'Correzione registrata. Grazie.' : 'Grazie per il riscontro.'}
      </p>
    );
  }

  if (editing) {
    return (
      <NerReferenceEditor
        initialActType={citation.act_type ?? ''}
        initialArticle={citation.article ?? ''}
        onCancel={() => setEditing(false)}
        onSave={({ actType, article }) =>
          submit('correction', { actType, article, displayText: formatCitationLabel(citation) })
        }
      />
    );
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-slate-500 dark:text-slate-400">
        {failed ? (
          <span role="alert" className="text-amber-700 dark:text-amber-400">Riscontro non registrato. Riprova.</span>
        ) : (
          'Citazione corretta?'
        )}
      </span>
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
