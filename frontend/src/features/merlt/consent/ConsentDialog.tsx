import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { cn } from '../../../lib/utils';
import { useConsent } from './useConsent';
import type { MerltConsentLevel } from '../merltConsent';

/**
 * Consent management dialog (Slice 2b). Explains the three levels in plain,
 * privacy-first Italian and writes the choice via the consent context (which
 * round-trips POST /api/merlt/consent — the server is the source of truth).
 */

interface LevelMeta {
  level: MerltConsentLevel;
  title: string;
  description: string;
}

const LEVELS: LevelMeta[] = [
  {
    level: 'none',
    title: 'Nessun apprendimento',
    description:
      'MERL-T non raccoglie nulla dalla tua attività. Continui a usare VisuaLex normalmente, ma il sistema non impara dai tuoi utilizzi.',
  },
  {
    level: 'basic',
    title: 'Base',
    description:
      'MERL-T può consultare il grafo giuridico e raccogliere segnali d’uso (articoli letti, evidenziazioni, note) per migliorare i suggerimenti. Nessun tuo contenuto viene pubblicato o condiviso.',
  },
  {
    level: 'full',
    title: 'Completo',
    description:
      'Oltre al livello Base, puoi contribuire e validare nodi del grafo giuridico (RLCF). I tuoi contributi sono attribuiti a te e passano dalla validazione della community prima di entrare nel grafo condiviso.',
  },
];

function capabilitiesFor(level: MerltConsentLevel): {
  contribution: boolean;
  validation: boolean;
  graph: boolean;
} {
  switch (level) {
    case 'none':
      return { contribution: false, validation: false, graph: false };
    case 'basic':
      return { contribution: false, validation: false, graph: true };
    case 'full':
      return { contribution: true, validation: true, graph: true };
  }
}

export interface ConsentDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ConsentDialog({ open, onClose }: ConsentDialogProps) {
  const { level, setConsent } = useConsent();
  const [selected, setSelected] = useState<MerltConsentLevel>(level);
  const [trackedOpen, setTrackedOpen] = useState(open);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the selection to the current server level each time the dialog opens.
  // Derived during render (gotcha #11 — no set-state-in-effect).
  if (open !== trackedOpen) {
    setTrackedOpen(open);
    if (open) {
      setSelected(level);
      setError(null);
    }
  }

  const caps = capabilitiesFor(selected);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await setConsent(selected, 'Aggiornato dall’utente dal pannello consenso');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile salvare la preferenza di consenso');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="Consenso MERL-T" size="lg">
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Scegli quanto MERL-T può imparare dal tuo utilizzo di VisuaLex. Puoi cambiare o revocare
          questa scelta in qualsiasi momento. I dati di tracciamento sono usati per migliorare il
          sistema; i tuoi contenuti non vengono mai condivisi senza una tua azione esplicita.
        </p>

        <div className="space-y-2" role="radiogroup" aria-label="Livello di consenso">
          {LEVELS.map((meta) => {
            const isSelected = selected === meta.level;
            return (
              <button
                key={meta.level}
                type="button"
                role="radio"
                aria-checked={isSelected}
                data-testid={`consent-option-${meta.level}`}
                onClick={() => setSelected(meta.level)}
                className={cn(
                  'w-full rounded-xl border p-4 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
                  isSelected
                    ? 'border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-950/30'
                    : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800',
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900 dark:text-white">{meta.title}</span>
                  {isSelected && <Check size={18} className="text-primary-600 dark:text-primary-400" />}
                </div>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{meta.description}</p>
              </button>
            );
          })}
        </div>

        <div
          data-testid="consent-capabilities"
          className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/50"
        >
          <p className="mb-2 font-medium text-slate-700 dark:text-slate-200">
            Con questo livello MERL-T potrà:
          </p>
          <ul className="space-y-1">
            <CapabilityRow on={caps.graph} label="Consultare il grafo giuridico" />
            <CapabilityRow on={caps.contribution} label="Accettare la tua contribuzione di nodi (RLCF)" />
            <CapabilityRow on={caps.validation} label="Accettare la tua validazione di proposte" />
          </ul>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Annulla
          </Button>
          <Button variant="primary" size="sm" loading={saving} onClick={() => void handleSave()}>
            Salva preferenze
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CapabilityRow({ on, label }: { on: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      {on ? (
        <Check size={16} className="text-emerald-600 dark:text-emerald-400" />
      ) : (
        <X size={16} className="text-slate-400" />
      )}
      <span className={cn(on ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 line-through')}>
        {label}
      </span>
    </li>
  );
}
