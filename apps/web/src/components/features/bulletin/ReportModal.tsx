import { useState } from 'react';
import { Flag, AlertCircle } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Textarea } from '../../ui/Textarea';
import { useSpaceDraft } from './spaceDrafts';
import { CONTROL_RADIUS } from '../../ui/controlStyles';
import { ForumSpace } from './ForumSpace';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import type { ReportReason } from '../../../types';
import { getErrorMessage } from '../../../utils/errors';

interface ReportModalProps {
  /** The published dossier reported; null, closed. */
  environmentId: string | null;
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

/**
 * «Segnala» on a published dossier, in the page at the top of the tab (LC138, L-73; it was a window with a veil): the
 * reason, the details, one request. The focus lands on the space; Esc and «Chiudi» close it, not while it sends.
 */
export function ReportModal({ environmentId, onClose, onReported }: ReportModalProps) {
  return (
    <ForumSpace value={environmentId} onClose={onClose} icon={<Flag size={20} aria-hidden className="shrink-0 text-red-500" />} title="Segnala il dossier pubblicato">
      {(id, setBusy) => <ReportForm environmentId={id} onClose={onClose} onReported={onReported} setBusy={setBusy} />}
    </ForumSpace>
  );
}

function ReportForm({ environmentId, onClose, onReported, setBusy }: ReportModalProps & { environmentId: string; setBusy: (busy: boolean) => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails, clearDetails] = useSpaceDraft(`report:${environmentId}`);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!reason) return;

    setError(null);
    setLoading(true);
    setBusy(true);

    try {
      await sharedEnvironmentService.report(
        environmentId,
        reason,
        details.trim() || undefined
      );
      clearDetails();
      onReported();
    } catch (err) {
      // The server says why in Italian (a second report: «Hai già segnalato questo elemento.»).
      setError(getErrorMessage(err) || 'Errore durante la segnalazione');
    } finally {
      setLoading(false);
      setBusy(false);
    }
  };

  return (
    <>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm text-slate-600 dark:text-slate-400">Il motivo</legend>
        {REPORT_REASONS.map((option) => (
          <label
            key={option.value}
            className={`flex items-start gap-3 p-3 ${CONTROL_RADIUS} border cursor-pointer ${
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
            <span>
              <span className="block font-medium text-slate-900 dark:text-white">{option.label}</span>
              <span className="block text-sm text-slate-500 dark:text-slate-400">{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div>
        <Textarea
          label="Dettagli (facoltativi)"
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          maxLength={500}
          rows={3}
          className="resize-none"
        />
        <p className="text-xs text-slate-500 mt-1">{details.length}/500</p>
      </div>

      {error && (
        <div role="alert" className={`flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 ${CONTROL_RADIUS} text-sm`}>
          <AlertCircle size={16} aria-hidden />
          {error}
        </div>
      )}

      <div className="flex justify-end gap-3">
        <Button variant="quiet" onClick={onClose} disabled={loading}>Annulla</Button>
        <Button variant="danger" onClick={() => void handleSubmit()} disabled={!reason} loading={loading} icon={<Flag size={16} aria-hidden />}>
          {loading ? 'Invio…' : 'Segnala'}
        </Button>
      </div>
    </>
  );
}
