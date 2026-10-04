import { useCallback, useEffect, useState } from 'react';
import { trashService, type TrashEntry } from '../../../services/trashService';
import { useAppStore } from '../../../store/useAppStore';

/** What a restore came to: back, a dossier to choose (its own is gone), or refused with the server's words. */
export type RestoreOutcome =
  | { kind: 'restored' }
  | { kind: 'needs-target'; message: string }
  | { kind: 'failed'; message: string };

const statusOf = (err: unknown) => (err as { status?: number } | null)?.status;
const messageOf = (err: unknown, fallback: string) => (err as { message?: string } | null)?.message || fallback;

/**
 * The trash for the dossier screens: listed once on mount, restored and emptied
 * one entry at a time. A restore reloads the dossier it went back to, so the page
 * shows what the server has (gotcha 17), and never reorders anything itself.
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

  // Once on mount; an answer that arrives after the page is gone is dropped.
  useEffect(() => {
    let cancelled = false;
    trashService.list()
      .then((list) => { if (!cancelled) { setEntries(list); setError(null); } })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('Failed to load the trash:', err);
        setError('Il cestino non è raggiungibile in questo momento.');
      });
    return () => { cancelled = true; };
  }, []);

  const restore = useCallback(async (entry: TrashEntry, targetDossierId?: string): Promise<RestoreOutcome> => {
    try {
      const { dossierId } = await trashService.restore(entry.id, targetDossierId);
      setEntries((prev) => prev?.filter((e) => e.id !== entry.id) ?? prev);
      if (dossierId) await refreshDossier(dossierId);
      return { kind: 'restored' };
    } catch (err) {
      if (statusOf(err) === 409 && !targetDossierId && entry.kind === 'DOSSIER_ITEMS') {
        return { kind: 'needs-target', message: messageOf(err, 'Il dossier non esiste più: scegli dove ripristinare.') };
      }
      console.error('Failed to restore a trash entry:', entry.id, err);
      return { kind: 'failed', message: messageOf(err, 'Impossibile ripristinare. Riprova.') };
    }
  }, [refreshDossier]);

  const purge = useCallback(async (entry: TrashEntry): Promise<boolean> => {
    try {
      await trashService.purge(entry.id);
      setEntries((prev) => prev?.filter((e) => e.id !== entry.id) ?? prev);
      return true;
    } catch (err) {
      console.error('Failed to empty a trash entry:', entry.id, err);
      return false;
    }
  }, []);

  return { entries, error, reload, restore, purge };
}
