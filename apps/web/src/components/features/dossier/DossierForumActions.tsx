import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EyeOff, Globe, RefreshCw, Trash2, Upload, Users } from 'lucide-react';
import type { Dossier } from '../../../types';
import { MenuButton } from '../../ui/MenuButton';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { useAppStore } from '../../../store/useAppStore';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import { getErrorMessage } from '../../../utils/errors';
import { cn } from '../../../lib/utils';
import { PublishDossierDialog } from './PublishDossierDialog';

type ToastType = 'success' | 'error' | 'info';

interface Props {
  dossier: Dossier;
  showToast: (message: string, type?: ToastType) => void;
  /** The header's look for a secondary action. */
  buttonClassName: string;
}

/**
 * The dossier's way into the Forum, in its header (spec 2026-10-13-environments-into-forum, D3, D4, D7):
 * «Pubblica nel Forum» for a dossier never published; once published, a «Forum» menu that says its state
 * («Nel Forum · v N», «Ritirato dal Forum») and offers «Aggiorna la versione pubblicata», «Ritira» or
 * «Ripubblica», «Apri il Forum» and «Elimina dal Forum». A dossier whose copy the admin withdrew cannot be
 * published or republished (question 190): the button says so.
 */
export function DossierForumActions({ dossier, showToast, buttonClassName }: Props) {
  const dossiers = useAppStore((s) => s.dossiers);
  const refreshDossier = useAppStore((s) => s.refreshDossier);
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const published = dossier.published ?? null;
  const blocked = dossier.forumBlocked === true;

  const act = async (run: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await run();
      showToast(done, 'success');
    } catch (err) {
      showToast(getErrorMessage(err) || 'Operazione non riuscita. Riprova.', 'error');
    } finally {
      setBusy(false);
      await refreshDossier(dossier.id);
    }
  };

  const dialog = dialogOpen && (
    <PublishDossierDialog
      dossier={dossier}
      otherDossiers={dossiers}
      onClose={() => setDialogOpen(false)}
      onPublished={(message) => {
        setDialogOpen(false);
        showToast(message, 'success');
        void refreshDossier(dossier.id);
      }}
      onAlreadyPublished={() => void refreshDossier(dossier.id)}
    />
  );

  if (!published) {
    return (
      <>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          disabled={blocked || dossier.items.length === 0}
          title={blocked ? "L'amministrazione ha ritirato questo dossier dal Forum: non puoi ripubblicarlo." : undefined}
          aria-label={blocked ? 'Ritirato dal Forum' : 'Pubblica nel Forum'}
          // The look `MenuButton` gives the header's other triggers.
          className={cn(
            'inline-flex items-center gap-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
            buttonClassName,
            'disabled:cursor-not-allowed disabled:opacity-40',
          )}
        >
          <Upload size={16} aria-hidden />
          <span className="hidden sm:inline" aria-hidden>{blocked ? 'Ritirato dal Forum' : 'Pubblica nel Forum'}</span>
        </button>
        {dialog}
      </>
    );
  }

  const state = published.isActive
    ? `Nel Forum · v${published.version}`
    : blocked ? "Ritirato dall'amministrazione" : 'Ritirato dal Forum';

  return (
    <>
      <MenuButton
        label={`Forum: ${state}`}
        align="left"
        triggerClassName={buttonClassName}
        items={[
          { label: 'Aggiorna la versione pubblicata', icon: RefreshCw, onSelect: () => setDialogOpen(true), disabled: busy },
          published.isActive
            ? {
                label: 'Ritira dal Forum', icon: EyeOff, disabled: busy,
                onSelect: () => void act(() => sharedEnvironmentService.withdraw(published.sharedEnvironmentId), 'Dossier ritirato dal Forum'),
              }
            : {
                label: 'Ripubblica nel Forum', icon: Globe, disabled: busy || blocked,
                onSelect: () => void act(() => sharedEnvironmentService.republish(published.sharedEnvironmentId), 'Dossier di nuovo nel Forum'),
              },
          { label: 'Apri il Forum', icon: Users, onSelect: () => navigate('/forum') },
          { label: 'Elimina dal Forum', icon: Trash2, danger: true, separatorBefore: true, disabled: busy, onSelect: () => setConfirmDelete(true) },
        ]}
      >
        {published.isActive ? <Globe size={16} aria-hidden /> : <EyeOff size={16} aria-hidden />}
        <span className="hidden sm:inline">{state}</span>
      </MenuButton>
      {dialog}
      <ConfirmDialog
        open={confirmDelete}
        variant="danger"
        title="Eliminare il dossier dal Forum?"
        message="La copia pubblicata, i suoi «Mi piace» e le proposte ricevute vengono eliminati. Il tuo dossier resta com'è; chi l'ha già scaricato ne conserva la copia."
        confirmLabel="Elimina dal Forum"
        onConfirm={() => {
          setConfirmDelete(false);
          void act(() => sharedEnvironmentService.delete(published.sharedEnvironmentId), 'Dossier eliminato dal Forum');
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
