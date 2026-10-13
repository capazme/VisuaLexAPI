import { showUndoToast } from '../../../hooks/useUndoableAction';
import { trashService } from '../../../services/trashService';
import { appStore } from '../../../store/useAppStore';

/** The confirmation: where the dossier goes and what it does not touch (UI conventions). */
export const deleteDossierMessage = (title: string) =>
  `«${title}» andrà nel cestino, dove resta 30 giorni e si può ripristinare. Gli articoli salvati nei segnalibri o in altri dossier non saranno toccati.`;

/** The toast after a dossier is deleted: where it went, and «Annulla». */
export const deletedDossierMessage = (title: string) => `Dossier «${title}» spostato nel cestino`;

/**
 * Deletes a dossier from the web app: the server moves it to the trash for 30 days
 * (owner, 13 October 2026, question 160) and the toast's «Annulla» restores it at
 * once, as «Ripristina» in the Cestino would. When the server refuses, the store
 * puts the dossier back and says so: no toast then, nothing went to the trash.
 */
export function deleteDossierWithUndo(dossier: { id: string; title: string }): void {
  showUndoToast({
    action: async () => {
      const trashId = await appStore.getState().deleteDossier(dossier.id);
      if (!trashId) throw new Error('The dossier was not deleted');
      return trashId;
    },
    undo: async (trashId) => {
      try {
        await trashService.restore(trashId);
        await appStore.getState().refreshDossier(dossier.id);
      } catch (err) {
        console.error('Failed to restore a deleted dossier:', dossier.id, err);
        appStore.getState().pushSyncError(`Impossibile ripristinare «${dossier.title}» ora: è nel Cestino, ripristinalo da lì.`);
      }
    },
    message: deletedDossierMessage(dossier.title),
  }).catch(() => {
    // Refused: the store already put the dossier back, logged it and told the user.
  });
}

/**
 * Removes a dossier the app made and could not fill («Salva come dossier» that saved nothing):
 * the user deleted nothing, so it does not stay in their trash. Logged when the purge fails;
 * the empty dossier then waits in the trash for its 30 days.
 */
export async function discardEmptyDossier(dossierId: string): Promise<void> {
  const trashId = await appStore.getState().deleteDossier(dossierId);
  if (!trashId) return;
  try {
    await trashService.purge(trashId);
  } catch (err) {
    console.error('Failed to purge a discarded empty dossier from the trash:', dossierId, err);
  }
}
