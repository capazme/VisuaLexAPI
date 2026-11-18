import { useEffect, useId, useRef, useState } from 'react';
import { Bug, Lightbulb, HelpCircle, Send, Loader2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { submitFeedback, type FeedbackType } from '../../../services/feedbackService';
import { getErrorMessage } from '../../../utils/errors';

const feedbackTypes: { value: FeedbackType; label: string; icon: React.ElementType; color: string }[] = [
  { value: 'bug', label: 'Bug', icon: Bug, color: 'text-red-500' },
  { value: 'suggestion', label: 'Suggerimento', icon: Lightbulb, color: 'text-amber-500' },
  { value: 'other', label: 'Altro', icon: HelpCircle, color: 'text-primary-500' },
];

/**
 * «Segnala un problema» (LC92): the form that was `FeedbackModal`, now a part of Impostazioni (`#segnala`), reached
 * from the bug beside «Impostazioni» and from the user menu. In the page, never over it (L-73); the confirmation too.
 */
export function ReportProblemSection() {
  const typeLabelId = useId();
  const messageId = useId();
  const [type, setType] = useState<FeedbackType>('bug');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // The focus follows the flow, never left on the body: to the confirmation once sent, back to the text for another.
  const confirmation = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const focusField = useRef(false);
  useEffect(() => {
    if (success) confirmation.current?.focus();
    else if (focusField.current) {
      focusField.current = false;
      field.current?.focus();
    }
  }, [success]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (message.trim().length < 10) {
      setError('Il messaggio deve essere di almeno 10 caratteri');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await submitFeedback({ type, message: message.trim() });
      setSuccess(true);
    } catch (err) {
      setError(getErrorMessage(err) || 'Errore nell\'invio del feedback');
    } finally {
      setIsSubmitting(false);
    }
  };

  const reset = () => {
    setType('bug');
    setMessage('');
    setError(null);
    setSuccess(false);
    focusField.current = true;
  };

  if (success) {
    return (
      <div ref={confirmation} tabIndex={-1} role="status" className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 focus:outline-none dark:border-slate-700">
        <Send size={18} className="mt-0.5 shrink-0 text-green-600" aria-hidden />
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-medium text-slate-900 dark:text-white">Grazie, la segnalazione è arrivata.</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">La esamineremo al più presto.</p>
          <button
            type="button"
            onClick={reset}
            className="min-h-[44px] text-sm font-medium text-primary-600 hover:underline md:min-h-0 dark:text-primary-400"
          >
            Scrivi un'altra segnalazione
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Type Selection */}
      <div>
        <p id={typeLabelId} className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          Tipo di segnalazione
        </p>
        {/* Sized by their content and free to wrap: at 390 px the three did not fit on one row. */}
        <div role="group" aria-labelledby={typeLabelId} className="flex flex-wrap gap-2">
          {feedbackTypes.map((ft) => {
            const Icon = ft.icon;
            const isSelected = type === ft.value;
            return (
              <button
                key={ft.value}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setType(ft.value)}
                className={cn(
                  'flex-auto flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 transition-colors',
                  isSelected
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                )}
              >
                <Icon size={18} className={isSelected ? ft.color : 'text-slate-400'} />
                <span className={cn(
                  'text-sm font-medium',
                  isSelected ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'
                )}>
                  {ft.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Message */}
      <div>
        <label htmlFor={messageId} className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          Descrizione
        </label>
        <textarea
          id={messageId}
          ref={field}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={
            type === 'bug'
              ? 'Descrivi il problema riscontrato…'
              : type === 'suggestion'
              ? 'Descrivi la tua idea o suggerimento…'
              : 'Scrivi il tuo messaggio…'
          }
          rows={5}
          className={cn(
            'w-full px-4 py-3 rounded-xl border transition-colors resize-none',
            'bg-slate-50 dark:bg-slate-800',
            'border-slate-200 dark:border-slate-700',
            'text-slate-900 dark:text-white placeholder-slate-400',
            'focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none'
          )}
        />
        <p className="mt-1 text-xs text-slate-400">
          Minimo 10 caratteri ({message.length}/10)
        </p>
      </div>

      {/* Error */}
      {error && (
        <div role="alert" className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isSubmitting || message.trim().length < 10}
          className={cn(
            'flex min-h-[44px] items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-[color,background-color,border-color,opacity] md:min-h-0',
            'bg-primary-600 dark:bg-toga-400 dark:hover:bg-toga-300 dark:text-ink-950 dark:disabled:bg-slate-700 dark:disabled:text-slate-400 dark:disabled:opacity-100 hover:bg-primary-700 text-white',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
        >
          {isSubmitting ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Invio...
            </>
          ) : (
            <>
              <Send size={18} />
              Invia
            </>
          )}
        </button>
      </div>
    </form>
  );
}
