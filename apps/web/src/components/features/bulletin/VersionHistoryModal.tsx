import { useEffect, useId, useState } from 'react';
import { History, RotateCcw, AlertTriangle } from 'lucide-react';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { CARD_RADIUS, CONTROL_BORDER } from '../../ui/controlStyles';
import { ForumSpace } from './ForumSpace';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import type { SharedEnvironment, SharedEnvironmentVersion } from '../../../types';

interface VersionHistoryModalProps {
  /** The published dossier; null, closed. */
  environment: SharedEnvironment | null;
  onClose: () => void;
  onRestored: (updated: SharedEnvironment) => void;
}

/**
 * «Cronologia versioni» of a published dossier, in the page at the top of «I miei pubblicati» (LC138, L-73; it was a
 * window). «Ripristina» keeps its confirmation, grown from the button (`ConfirmDialog`, L-74).
 */
export function VersionHistoryModal({ environment, onClose, onRestored }: VersionHistoryModalProps) {
  const spaceId = useId();
  return (
    <ForumSpace
      id={spaceId}
      value={environment}
      onClose={onClose}
      icon={<History size={20} aria-hidden className="shrink-0" />}
      title="Cronologia versioni"
      line={(env) => `«${env.title}» · versione attuale v${env.currentVersion}`}
    >
      {(env) => <VersionList environment={env} spaceId={spaceId} onRestored={onRestored} />}
    </ForumSpace>
  );
}

function VersionList({ environment, spaceId, onRestored }: { environment: SharedEnvironment; spaceId: string; onRestored: (updated: SharedEnvironment) => void }) {
  const [versions, setVersions] = useState<SharedEnvironmentVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [confirmVersion, setConfirmVersion] = useState<SharedEnvironmentVersion | null>(null);
  const [confirmFrom, setConfirmFrom] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    sharedEnvironmentService
      .getVersions(environment.id)
      .then((data) => {
        if (!cancelled) setVersions(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.error('VersionHistoryModal: failed to load versions:', err);
          setError(err instanceof Error ? err.message : 'Errore nel caricamento delle versioni');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [environment.id]);

  const handleRestore = async (version: SharedEnvironmentVersion) => {
    setConfirmVersion(null);
    setRestoringId(version.id);
    setError(null);
    try {
      const updated = await sharedEnvironmentService.restoreVersion(environment.id, version.id);
      onRestored(updated);
    } catch (err: unknown) {
      console.error('VersionHistoryModal: failed to restore version:', err);
      setError(err instanceof Error ? err.message : 'Errore nel ripristino della versione');
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <>
      {error && (
        <div role="alert" className="mb-4 flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md text-red-700 dark:text-red-300 text-sm">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center text-slate-500 dark:text-slate-400 text-sm">
          Caricamento versioni...
        </div>
      ) : versions.length === 0 ? (
        <div className="py-8 text-center text-slate-500 dark:text-slate-400 text-sm">
          Nessuna versione precedente. Una versione nuova nasce a ogni «Aggiorna la versione pubblicata» dal dossier.
        </div>
      ) : (
        <ul className="space-y-2">
          {versions.map((version) => (
            <li
              key={version.id}
              className={`flex items-start justify-between gap-4 px-4 py-3 ${CARD_RADIUS} ${CONTROL_BORDER} bg-white dark:bg-slate-800`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">
                    v{version.version}
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    {new Date(version.createdAt).toLocaleString('it-IT', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                </div>
                {version.changelog && (
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 line-clamp-2">
                    {version.changelog}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={(event) => { setConfirmFrom(event.currentTarget); setConfirmVersion(version); }}
                disabled={restoringId !== null}
                aria-label={`Ripristina v${version.version}`}
                className="shrink-0"
              >
                <RotateCcw size={14} />
                {restoringId === version.id ? 'Ripristino…' : 'Ripristina'}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirmVersion !== null}
        origin={confirmFrom}
        variant="danger"
        title={confirmVersion ? `Ripristinare la v${confirmVersion.version}?` : 'Ripristinare versione?'}
        message="Il contenuto attuale verrà sostituito con quello di questa versione. Lo stato attuale viene salvato come nuova versione, quindi l'operazione è reversibile."
        confirmLabel="Ripristina versione"
        onConfirm={() => confirmVersion && handleRestore(confirmVersion)}
        onCancel={() => setConfirmVersion(null)}
        // Confirmed, every «Ripristina» waits: the focus goes to the space, where Esc still closes it.
        focusBack={() => document.getElementById(spaceId)}
      />
    </>
  );
}
