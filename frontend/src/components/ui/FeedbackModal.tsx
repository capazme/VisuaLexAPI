import { useState } from 'react';
import { Modal } from './Modal';
import { Bug, Lightbulb, HelpCircle, Send, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { submitFeedback, type FeedbackType } from '../../services/feedbackService';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const feedbackTypes: { value: FeedbackType; label: string; icon: React.ElementType; color: string }[] = [
  { value: 'bug', label: 'Bug', icon: Bug, color: 'text-red-500' },
  { value: 'suggestion', label: 'Suggerimento', icon: Lightbulb, color: 'text-amber-500' },
  { value: 'other', label: 'Altro', icon: HelpCircle, color: 'text-blue-500' },
];

export function FeedbackModal({ isOpen, onClose, onSuccess }: FeedbackModalProps) {
  const [type, setType] = useState<FeedbackType>('suggestion');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
      setTimeout(() => {
        onSuccess?.();
        handleClose();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Errore nell\'invio del feedback');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setType('suggestion');
    setMessage('');
    setError(null);
    setSuccess(false);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Invia Feedback" size="md">
      {success ? (
        <div className="text-center py-8">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <Send size={28} />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
            Grazie per il tuo feedback!
          </h3>
          <p className="text-slate-500 dark:text-slate-400">
            Lo esamineremo al più presto.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Type Selection */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Tipo di feedback
            </label>
            <div className="flex gap-2">
              {feedbackTypes.map((ft) => {
                const Icon = ft.icon;
                const isSelected = type === ft.value;
                return (
                  <button
                    key={ft.value}
                    type="button"
                    onClick={() => setType(ft.value)}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 transition-all',
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
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Descrizione
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                type === 'bug'
                  ? 'Descrivi il problema riscontrato...'
                  : type === 'suggestion'
                  ? 'Descrivi la tua idea o suggerimento...'
                  : 'Scrivi il tuo messaggio...'
              }
              rows={5}
              className={cn(
                'w-full px-4 py-3 rounded-xl border transition-all resize-none',
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
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2.5 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={isSubmitting || message.trim().length < 10}
              className={cn(
                'flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-all',
                'bg-primary-600 hover:bg-primary-700 text-white',
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
      )}
    </Modal>
  );
}
