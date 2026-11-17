import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../../../lib/utils';
import { FOCUS_RING, TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import { useAppStore } from '../../../store/useAppStore';
import { notify } from '../../ui/notifications/notifications';
import { AddToDossierPopover } from '../dossier/AddToDossierPopover';
import { passageNote } from './passageNote';
import type { RassegnePasso } from './types';

/**
 * «Aggiungi alla pratica» on a passage of the reviews (U3, D6): the reader's pratica picker, then the passage saved as
 * a note (`passageNote`). The picker is given neither a norm nor a decision, so it adds nothing itself and only reports
 * the pratica chosen (or made there); the note is this component's.
 */
export function AddPassageToPratica({ passo, className }: { passo: RassegnePasso; className?: string }) {
  const navigate = useNavigate();
  const addNoteToDossier = useAppStore((s) => s.addNoteToDossier);
  const [anchor, setAnchor] = useState<HTMLElement | null | undefined>(undefined);

  const added = (id: string, title: string) => {
    void addNoteToDossier(id, passageNote(passo)).then((saved) => {
      // A failure is the store's to say (`pushSyncError`).
      if (!saved) return;
      notify({
        type: 'success',
        message: `Passo aggiunto come nota a «${title}»`,
        duration: 5000,
        action: { label: 'Apri la pratica', onClick: () => navigate(`/pratiche?dossier=${id}`) },
      });
    });
  };

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={(e) => setAnchor(e.currentTarget)}
        className={cn('text-xs font-medium text-primary-600 hover:underline dark:text-primary-400', FOCUS_RING, TOUCH_TARGET_RESPONSIVE, className)}
      >
        Aggiungi alla pratica
      </button>
      <AddToDossierPopover isOpen={anchor !== undefined} anchorEl={anchor ?? null} onClose={() => setAnchor(undefined)} onAdded={added} />
    </>
  );
}
