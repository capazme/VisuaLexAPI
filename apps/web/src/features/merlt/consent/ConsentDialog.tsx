import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { cn } from '../../../lib/utils';
import { useConsent } from './useConsent';
import type { MerltConsentLevel } from '../merltConsent';

/**
 * Consent management dialog (Slice 2b, reframed as the ladder in Slice 3 §3.2).
 * Explains the three levels as a progression — read → ask → teach — in plain,
 * privacy-first Italian, and writes the choice via the consent context (which
 * round-trips POST /api/merlt/consent — the server is the source of truth).
 *
 * The ladder (D2): "Leggere è libero. Con il consenso base fai domande.
 * Con quello completo insegni al sistema."
 */

interface LevelMeta {
  level: MerltConsentLevel;
  title: string;
  description: string;
}

const LEVELS: LevelMeta[] = [
  {
    level: 'none',
    title: 'Nessun consenso — solo lettura',
    description:
      'Leggere è sempre libero: consulti le norme e il grafo giuridico senza dare alcun consenso. MERL-T non raccoglie nulla dalla tua attività e non impara dai tuoi utilizzi.',
  },
  {
    level: 'basic',
    title: 'Base — fai domande all’assistente',
    description:
      'Puoi porre domande all’assistente MERL-T e ricevere risposte con le fonti. MERL-T raccoglie segnali d’uso (articoli letti, evidenziazioni, note) per migliorare i suggerimenti. Nessun tuo contenuto viene pubblicato o condiviso.',
  },
  {
    level: 'full',
    title: 'Completo — insegni al sistema',
    description:
      'Oltre a leggere e fare domande, insegni a MERL-T: invii riscontri, contribuisci nodi al grafo giuridico e voti le proposte della community (RLCF). I tuoi contributi sono attribuiti a te e passano dalla validazione della community prima di entrare nel grafo condiviso.',
  },
];

function capabilitiesFor(level: MerltConsentLevel): {
  read: boolean;
  ask: boolean;
  teach: boolean;
} {
  switch (level) {
    case 'none':
      return { read: true, ask: false, teach: false };
    case 'basic':
      return { read: true, ask: true, teach: false };
    case 'full':
      return { read: true, ask: true, teach: true };
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
          <span className="font-medium text-slate-700 dark:text-slate-200">
            Leggere è libero. Con il consenso base fai domande. Con quello completo insegni al
            sistema.
          </span>{' '}
          Scegli fino a che punto vuoi far crescere MERL-T con il tuo utilizzo di VisuaLex. Puoi
          cambiare o revocare questa scelta in qualsiasi momento; i tuoi contenuti non vengono mai
          condivisi senza una tua azione esplicita.
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
            Con questo livello potrai:
          </p>
          <ul className="space-y-1">
            <CapabilityRow on={caps.read} label="Leggere le norme e consultare il grafo giuridico" />
            <CapabilityRow on={caps.ask} label="Fare domande all’assistente MERL-T" />
            <CapabilityRow
              on={caps.teach}
              label="Insegnare al sistema: riscontri, contribuzione di nodi e validazione (voti) delle proposte"
            />
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
