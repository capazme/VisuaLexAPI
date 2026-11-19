import { useEffect, useId, useRef, useState } from 'react';
import { Bug, Lightbulb, HelpCircle, Send } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { submitFeedback, type FeedbackType } from '../../../services/feedbackService';
import { getErrorMessage } from '../../../utils/errors';
import { Button } from '../../ui/Button';
import { Textarea } from '../../ui/Textarea';
import { CARD_RADIUS, CONTROL_BORDER } from '../../ui/controlStyles';

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
      <div ref={confirmation} tabIndex={-1} role="status" className={cn('flex items-start gap-3 p-4 focus:outline-none', CARD_RADIUS, CONTROL_BORDER)}>
        <Send size={18} className="mt-0.5 shrink-0 text-green-600" aria-hidden />
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-medium text-slate-900 dark:text-white">Grazie, la segnalazione è arrivata.</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">La esamineremo al più presto.</p>
          <Button type="button" variant="link" onClick={reset}>
            Scrivi un'altra segnalazione
          </Button>
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
              // A choice of three that wraps at 390 px, so `Button`s pressed or not rather than a segmented row.
              <Button
                key={ft.value}
                type="button"
                variant="secondary"
                aria-pressed={isSelected}
                onClick={() => setType(ft.value)}
                icon={<Icon size={16} aria-hidden className={isSelected ? ft.color : 'text-slate-400'} />}
                className={cn('flex-auto', isSelected ? 'border-ink-900 text-ink-950 dark:border-ink-100 dark:text-ink-50' : 'text-slate-500 dark:text-slate-400')}
              >
                {ft.label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Message */}
      <div>
        <Textarea
          id={messageId}
          label="Descrizione"
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
          className="resize-none"
        />
        <p className="mt-1 text-xs text-slate-400">
          Minimo 10 caratteri ({message.length}/10)
        </p>
      </div>

      {/* Error */}
      {error && (
        <div role="alert" className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end">
        <Button type="submit" icon={<Send size={16} aria-hidden />} loading={isSubmitting} disabled={message.trim().length < 10}>
          {isSubmitting ? 'Invio…' : 'Invia'}
        </Button>
      </div>
    </form>
  );
}
