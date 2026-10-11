import { useState, type ReactNode } from 'react';
import { FolderInput, FolderPlus } from 'lucide-react';
import { Toast } from '../../ui/Toast';
import type { MenuItem } from '../../ui/MenuButton';
import { PracticeDossierPicker } from './PracticeDossierPicker';
import { useSavePracticeAsDossier } from './useSavePracticeAsDossier';

/**
 * The two actions of spec §7 for one practice, shared by the header's «⋯» and the chip's «⋯»:
 * the menu items, and the dialog and toast they need (to be rendered next to the menu).
 */
export function usePracticeSaveActions(practiceId: string): { items: MenuItem[]; overlay: ReactNode } {
  const { notice, dismissNotice, saveAsNew, addToExisting } = useSavePracticeAsDossier();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = (job: Promise<void>) => {
    setBusy(true);
    void job.finally(() => setBusy(false));
  };

  const items: MenuItem[] = [
    { label: 'Salva come dossier', icon: FolderPlus, disabled: busy, onSelect: () => run(saveAsNew(practiceId)) },
    { label: 'Aggiungi a un dossier…', icon: FolderInput, disabled: busy, onSelect: () => setPicking(true) },
  ];
  const overlay = (
    <>
      {picking && (
        <PracticeDossierPicker
          onClose={() => setPicking(false)}
          onPick={(dossierId) => {
            setPicking(false);
            run(addToExisting(practiceId, dossierId));
          }}
        />
      )}
      <Toast
        message={notice?.message ?? ''}
        type={notice?.type ?? 'success'}
        isVisible={notice !== null}
        onClose={dismissNotice}
        duration={6000}
        position="top"
      />
    </>
  );
  return { items, overlay };
}
