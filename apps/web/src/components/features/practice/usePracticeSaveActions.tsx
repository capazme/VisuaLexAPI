import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FolderInput, FolderPlus } from 'lucide-react';
import { Toast } from '../../ui/Toast';
import type { MenuItem } from '../../ui/MenuButton';
import { Z_INDEX } from '../../../constants/zIndex';
import { PracticeDossierPicker } from './PracticeDossierPicker';
import { usePracticeSaving, useSavePracticeAsDossier } from './useSavePracticeAsDossier';

export interface PracticeSaveActions {
  /** «Salva come dossier» and «Aggiungi a un dossier…», for a «⋯» menu. */
  items: MenuItem[];
  /** «Salva come dossier» alone, for the header's button. */
  saveAsNew: () => void;
  /** A save of this practice is running, started here or anywhere else: every way in is disabled. */
  busy: boolean;
  /** The picker and the outcome's toast, to be rendered next to the menu. */
  overlay: ReactNode;
}

/**
 * The two actions of spec §7 for one practice, shared by the header and the chip's «⋯»: the menu
 * items, the header's button, and the dialog and toast they need. One save at a time per practice,
 * wherever it starts (`usePracticeSaving`). The toast is portalled to the document in the toast
 * band: inside the bar (`fixed`, transformed, blurred) a `fixed` child is placed against the bar and
 * stacked in it (gotchas 22, 26), and at the header's top right it would cover Focus Mode's button.
 */
export function usePracticeSaveActions(practiceId: string): PracticeSaveActions {
  const { notice, dismissNotice, saveAsNew, addToExisting } = useSavePracticeAsDossier();
  const [picking, setPicking] = useState(false);
  const busy = usePracticeSaving(practiceId);

  const saveNew = () => { void saveAsNew(practiceId); };
  const items: MenuItem[] = [
    { label: 'Salva come dossier', icon: FolderPlus, disabled: busy, onSelect: saveNew },
    { label: 'Aggiungi a un dossier…', icon: FolderInput, disabled: busy, onSelect: () => setPicking(true) },
  ];
  const overlay = (
    <>
      <PracticeDossierPicker
        isOpen={picking}
        onClose={() => setPicking(false)}
        onPick={(dossierId) => {
          setPicking(false);
          void addToExisting(practiceId, dossierId);
        }}
      />
      {createPortal(
        <Toast
          message={notice?.message ?? ''}
          type={notice?.type ?? 'success'}
          isVisible={notice !== null}
          onClose={dismissNotice}
          duration={6000}
          className={Z_INDEX.toast}
        />,
        document.body,
      )}
    </>
  );
  return { items, saveAsNew: saveNew, busy, overlay };
}
