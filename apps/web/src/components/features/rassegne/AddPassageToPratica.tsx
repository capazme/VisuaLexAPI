import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../ui/Button';
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
  const [open, setOpen] = useState(false);
  const id = useId();

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
      <Button variant="link" aria-expanded={open} aria-controls={id} onClick={() => setOpen(true)} className={className}>
        Aggiungi alla pratica
      </Button>
      {/* Under the command, in the page (LC125, L-73). */}
      <AddToDossierPopover id={id} isOpen={open} onClose={() => setOpen(false)} onAdded={added} />
    </>
  );
}
