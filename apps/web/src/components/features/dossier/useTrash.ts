import { useCallback, useEffect, useState } from 'react';
import { trashService, type TrashEntry } from '../../../services/trashService';
import { appStore, useAppStore } from '../../../store/useAppStore';

/** What a restore came to: back, a dossier to choose (its own is gone), or refused, in Italian. */
export type RestoreOutcome =
  | { kind: 'restored' }
  | { kind: 'needs-target'; message: string }
  | { kind: 'failed'; message: string };

const statusOf = (err: unknown) => (err as { status?: number } | null)?.status;
const messageOf = (err: unknown) => (err as { message?: string } | null)?.message;

export const GONE_FROM_TRASH = 'Non è più nel cestino: forse è già stato ripristinato o è scaduto.';

/**
 * The trash for the dossier screens: one instance per page (`DossierPage`), read
 * on mount, again whenever the tab comes back into view (Claude may have deleted
 * from another window meanwhile) and when the «Cestino» opens. A restore reloads
 * the dossier it went back to, so the page shows what the server has (gotcha 17).
 */
export function useTrash() {
  const [entries, setEntries] = useState<TrashEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshDossier = useAppStore((s) => s.refreshDossier);

  const reload = useCallback(async () => {
    try {
      setEntries(await trashService.list());
      setError(null);
    } catch (err) {
      // Logged, never swallowed (gotcha 18); the screens say the trash is out of reach.
      console.error('Failed to load the trash:', err);
      setError('Il cestino non è raggiungibile in questo momento.');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    trashService.list()
      .then((list) => { if (!cancelled) { setEntries(list); setError(null); } })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('Failed to load the trash:', err);
        setError('Il cestino non è raggiungibile in questo momento.');
      });
    const onVisibility = () => { if (document.visibilityState === 'visible') void reload(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reload]);

  const drop = (id: string) => setEntries((prev) => prev?.filter((e) => e.id !== id) ?? prev);

  const restore = useCallback(async (entry: TrashEntry, targetDossierId?: string): Promise<RestoreOutcome> => {
    try {
      const { dossierId } = await trashService.restore(entry.id, targetDossierId);
      drop(entry.id);
      if (dossierId) await refreshDossier(dossierId);
      return { kind: 'restored' };
    } catch (err) {
      const status = statusOf(err);
      if (status === 404 && !targetDossierId) {
        drop(entry.id);
        return { kind: 'failed', message: GONE_FROM_TRASH };
      }
      // Only when the entry's own dossier is really gone: the server answers 409
      // for an entry restored meanwhile too, and that is no reason to ask.
      const ownGone = entry.kind === 'DOSSIER_ITEMS' && !appStore.getState().dossiers.some((d) => d.id === entry.dossierId);
      if (status === 409 && !targetDossierId && ownGone) {
        return { kind: 'needs-target', message: messageOf(err) || 'Il dossier non esiste più: scegli dove ripristinare.' };
      }
      console.error('Failed to restore a trash entry:', entry.id, err);
      // The server's 409s are Italian by contract; anything else gets ours.
      return { kind: 'failed', message: status === 409 && messageOf(err) ? messageOf(err)! : 'Impossibile ripristinare. Riprova.' };
    }
  }, [refreshDossier]);

  const purge = useCallback(async (entry: TrashEntry): Promise<boolean> => {
    try {
      await trashService.purge(entry.id);
      drop(entry.id);
      return true;
    } catch (err) {
      if (statusOf(err) === 404) {
        // Gone already: what the user wanted.
        drop(entry.id);
        return true;
      }
      console.error('Failed to empty a trash entry:', entry.id, err);
      return false;
    }
  }, []);

  return { entries, error, reload, restore, purge };
}
