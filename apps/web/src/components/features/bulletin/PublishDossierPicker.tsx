import { useState } from 'react';
import { Upload } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { useAppStore } from '../../../store/useAppStore';
import { TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import { kindLabel } from '../dossier/dossierKinds';
import { PublishDossierDialog } from '../dossier/PublishDossierDialog';
import type { Dossier } from '../../../types';

interface Props {
  onClose: () => void;
  onPublished: (message: string) => void;
}

/**
 * «Pubblica un dossier» from the Forum (spec 2026-10-13-environments-into-forum, D13): the user's dossiers not yet in
 * the Forum, then the dossier's own «Pubblica nel Forum» dialog. A dossier the admin withdrew is listed, not offered.
 */
export function PublishDossierPicker({ onClose, onPublished }: Props) {
  const dossiers = useAppStore((s) => s.dossiers);
  const refreshDossier = useAppStore((s) => s.refreshDossier);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const chosen = chosenId ? dossiers.find((d) => d.id === chosenId) ?? null : null;
  const candidates = dossiers.filter((d) => !d.published && d.items.length > 0);

  if (chosen) {
    return (
      <PublishDossierDialog
        dossier={chosen}
        otherDossiers={dossiers}
        onClose={onClose}
        onPublished={(message) => {
          void refreshDossier(chosen.id);
          onPublished(message);
        }}
        onAlreadyPublished={() => void refreshDossier(chosen.id)}
      />
    );
  }

  return (
    <Modal isOpen onClose={onClose} title="Pubblica un dossier" icon={<Upload size={20} />} size="md">
      {candidates.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Non hai dossier da pubblicare: quelli già nel Forum si aggiornano dal dossier, e un dossier vuoto non si pubblica.
        </p>
      ) : (
        <ul className="space-y-1">
          {candidates.map((d: Dossier) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => setChosenId(d.id)}
                disabled={d.forumBlocked}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${TOUCH_TARGET_RESPONSIVE} md:py-2`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900 dark:text-white">{d.title}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {kindLabel(d.kind)} · {d.items.length} {d.items.length === 1 ? 'voce' : 'voci'}
                    {d.forumBlocked ? " · ritirato dall'amministrazione" : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
