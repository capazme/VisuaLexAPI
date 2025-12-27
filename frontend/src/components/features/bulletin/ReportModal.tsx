import { useState } from 'react';
import { X, Flag, AlertCircle } from 'lucide-react';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import type { ReportReason } from '../../../types';

interface ReportModalProps {
  environmentId: string;
  onClose: () => void;
  onReported: () => void;
}

const REPORT_REASONS: { value: ReportReason; label: string; description: string }[] = [
  {
    value: 'spam',
    label: 'Spam',
    description: 'Contenuto promozionale o non pertinente',
  },
  {
    value: 'inappropriate',
    label: 'Contenuto inappropriato',
    description: 'Contenuto offensivo, discriminatorio o illegale',
  },
  {
    value: 'copyright',
    label: 'Violazione copyright',
    description: 'Violazione di diritti d\'autore o proprietà intellettuale',
  },
  {
    value: 'other',
    label: 'Altro',
    description: 'Altro motivo non elencato',
  },
];

export function ReportModal({ environmentId, onClose, onReported }: ReportModalProps) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!reason) return;

    setError(null);
    setLoading(true);

    try {
      await sharedEnvironmentService.report(
        environmentId,
        reason,
        details.trim() || undefined
      );
      onReported();
    } catch (err: any) {
      if (err.message?.includes('already reported')) {
        setError('Hai già segnalato questo ambiente');
      } else {
        setError(err.message || 'Errore durante la segnalazione');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Flag size={20} className="text-red-500" />
            Segnala ambiente
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <X size={20} className="text-slate-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Aiutaci a mantenere la community sicura. Seleziona il motivo della segnalazione.
          </p>

          {/* Reason selection */}
          <div className="space-y-2">
            {REPORT_REASONS.map((option) => (
              <label
                key={option.value}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  reason === option.value
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="reason"
                  value={option.value}
                  checked={reason === option.value}
                  onChange={() => setReason(option.value)}
                  className="mt-0.5 w-4 h-4 text-primary-600 focus:ring-primary-500"
                />
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">
                    {option.label}
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {option.description}
                  </p>
                </div>
              </label>
            ))}
          </div>

          {/* Details */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Dettagli aggiuntivi (opzionale)
            </label>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Fornisci ulteriori dettagli sulla segnalazione..."
              maxLength={500}
              rows={3}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500 resize-none"
            />
            <p className="text-xs text-slate-500 mt-1">{details.length}/500</p>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">
              <AlertCircle size={16} />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            Annulla
          </button>
          <button
            onClick={handleSubmit}
            disabled={!reason || loading}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Invio...
              </>
            ) : (
              <>
                <Flag size={16} />
                Segnala
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
