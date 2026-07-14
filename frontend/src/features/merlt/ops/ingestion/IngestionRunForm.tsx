import { useState } from 'react';
import { PlayCircle } from 'lucide-react';
import { Button } from '../../../../components/ui/Button';
import { cn } from '../../../../lib/utils';
import { runIngestion } from './opsIngestionApi';
import type { IngestionSource, RunIngestionResponse } from './types';

type FormState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'error'; message: string };

const SOURCE_HINTS: Record<IngestionSource, string> = {
  visualex_tree:
    'JSON con i parametri dell\'albero VisuaLex, es. {"act_type":"codice civile","articles":"2043-2059"}. "articles" è opzionale (omesso = intero atto).',
  italia_corpus: 'Percorso o URN del documento nel corpus italia-corpus da ingerire.',
};

export interface IngestionRunFormProps {
  /** Called after a successful 202 — the caller starts polling the new batch and/or refetches the queue. */
  onStarted: (response: RunIngestionResponse) => void;
}

/**
 * Trigger form for POST /ops/ingestion/run. Stateful submit button follows
 * the OpsTrainingButton pattern (idle/submitting/error), but success doesn't
 * render an inline message here — the caller reacts to `onStarted` (starts
 * polling + refetches the queue), so the new batch itself is the confirmation.
 */
export function IngestionRunForm({ onStarted }: IngestionRunFormProps) {
  const [source, setSource] = useState<IngestionSource>('visualex_tree');
  const [sourceRef, setSourceRef] = useState('');
  const [scopeLabel, setScopeLabel] = useState('');
  const [state, setState] = useState<FormState>({ status: 'idle' });

  const submitting = state.status === 'submitting';
  const canSubmit = sourceRef.trim().length > 0 && scopeLabel.trim().length > 0 && !submitting;

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!canSubmit) return;
    setState({ status: 'submitting' });
    try {
      const response = await runIngestion({
        source,
        source_ref: sourceRef.trim(),
        scope_label: scopeLabel.trim(),
      });
      setState({ status: 'idle' });
      setSourceRef('');
      setScopeLabel('');
      onStarted(response);
    } catch (err) {
      console.error('IngestionRunForm: run failed:', err);
      setState({ status: 'error', message: 'Avvio del batch non riuscito. MERL-T potrebbe non essere raggiungibile.' });
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ingestion-source" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            Sorgente
          </label>
          <select
            id="ingestion-source"
            value={source}
            onChange={(e) => setSource(e.target.value as IngestionSource)}
            disabled={submitting}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50"
          >
            <option value="visualex_tree">Albero VisuaLex</option>
            <option value="italia_corpus">italia-corpus</option>
          </select>
        </div>
        <div>
          <label htmlFor="ingestion-scope" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            Etichetta ambito
          </label>
          <input
            id="ingestion-scope"
            type="text"
            value={scopeLabel}
            onChange={(e) => setScopeLabel(e.target.value)}
            disabled={submitting}
            maxLength={300}
            placeholder='es. "Codice civile — Libro IV"'
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50"
            required
          />
        </div>
      </div>
      <div>
        <label htmlFor="ingestion-source-ref" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
          Riferimento sorgente
        </label>
        <textarea
          id="ingestion-source-ref"
          value={sourceRef}
          onChange={(e) => setSourceRef(e.target.value)}
          disabled={submitting}
          rows={2}
          className={cn(
            'w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-mono',
            'focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50'
          )}
          required
        />
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{SOURCE_HINTS[source]}</p>
      </div>
      {state.status === 'error' && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {state.message}
        </p>
      )}
      <Button type="submit" variant="primary" size="sm" disabled={!canSubmit} icon={<PlayCircle size={16} />}>
        {submitting ? 'Avvio…' : 'Avvia batch'}
      </Button>
    </form>
  );
}
