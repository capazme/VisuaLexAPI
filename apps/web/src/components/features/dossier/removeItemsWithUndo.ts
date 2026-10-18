import { showUndoToast } from '../../../hooks/useUndoableAction';
import { trashService } from '../../../services/trashService';
import { appStore } from '../../../store/useAppStore';

/** The confirmation of a multiple removal: where the entries go and what it does not touch (UI conventions). */
export const removeSelectionMessage =
  'Verranno rimossi da questo dossier e andranno nel cestino, dove restano 30 giorni e si possono ripristinare. Gli articoli originali salvati nei segnalibri o in altri dossier non saranno toccati.';

/**
 * Removes entries from a dossier on the web app: the server moves them, as ONE trash entry, to
 * the trash for 30 days (owner, 13 October 2026, question 181), and the toast's «Annulla»
 * restores that entry at once, as «Ripristina» in the Cestino would, with the entries' own ids
 * (a note stays about its article, Claude's mark stays), and puts them back where they were: the
 * server appends a restored entry after the dossier's last, which would send a whole act to the
 * bottom, so the order the page had before the removal is saved again. When the server refuses,
 * the store puts the entries back where they were and says so: no toast then, nothing went to the trash.
 */
export function removeItemsWithUndo(
  dossierId: string,
  itemIds: string[],
  /** What the toast says: «Elemento rimosso», «3 articoli rimossi». */
  message: string,
  /** The page's trash, read again after the move and after «Annulla» (its counts). */
  onTrashChanged?: () => void,
): void {
  // The page's order before the removal, for «Annulla».
  const orderBefore = appStore.getState().dossiers.find((d) => d.id === dossierId)?.items.map((i) => i.id) ?? [];
  showUndoToast({
    action: async () => {
      const trashId = await appStore.getState().trashDossierItems(dossierId, itemIds);
      if (!trashId) throw new Error('The entries were not removed');
      onTrashChanged?.();
      return trashId;
    },
    undo: async (trashId) => {
      try {
        await trashService.restore(trashId);
        onTrashChanged?.();
        await appStore.getState().refreshDossier(dossierId);
        // Every id still in the dossier, in the order it had before; what came in since goes after.
        const now = new Set(appStore.getState().dossiers.find((d) => d.id === dossierId)?.items.map((i) => i.id) ?? []);
        appStore.getState().setDossierItemOrder(dossierId, orderBefore.filter((id) => now.has(id)));
      } catch (err) {
        console.error('Failed to restore removed dossier entries:', dossierId, err);
        appStore.getState().pushSyncError('Impossibile ripristinare ora: gli elementi sono nel Cestino, ripristinali da lì.');
      }
    },
    message,
  }).catch(() => {
    // Refused: the store already put the entries back, logged it and told the user.
  });
}
