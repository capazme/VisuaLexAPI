import { useState } from 'react';
import { Archive, Download, FolderPlus, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { useAppStore } from '../../../store/useAppStore';
import { environmentService } from '../../../services/environmentService';
import { exportEnvironmentToFile } from '../../../utils/environmentUtils';
import { TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import { StudyImportDialog } from './StudyImportDialog';
import { becomesStudyDossiers } from '../../../utils/studyImportReport';
import type { Environment, StudyImportReport } from '../../../types';

interface Props {
  onRecovered: (report: StudyImportReport) => void;
  onMessage: (message: string, type: 'success' | 'error' | 'info') => void;
}

const ACTION = `inline-flex items-center gap-1 rounded-lg px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${TOUCH_TARGET_RESPONSIVE}`;

/**
 * «Ambienti salvati (archivio)» (spec 2026-10-13-environments-into-forum, D11b; the owner's answer 184): the private
 * environments saved before «Ambienti» went, read-only. «Recupera i dossier» makes their dossiers dossiers di studio on
 * the server, from the stored row; «Esporta JSON» and «Elimina» as before. No environment is created any more; the
 * section is absent for a user with none.
 */
export function ArchivedEnvironmentsSection({ onRecovered, onMessage }: Props) {
  const environments = useAppStore((s) => s.environments);
  const deleteEnvironment = useAppStore((s) => s.deleteEnvironment);
  const [recovering, setRecovering] = useState<Environment | null>(null);
  const [deleting, setDeleting] = useState<Environment | null>(null);
  if (environments.length === 0) return null;

  const exportOne = async (env: Environment) => {
    try {
      const leftOut = await exportEnvironmentToFile(env);
      onMessage(leftOut ? `File esportato. ${leftOut}` : 'File esportato', 'success');
    } catch (err) {
      console.error('ArchivedEnvironmentsSection: export failed:', err);
      onMessage("Esportazione non riuscita. Riprova.", 'error');
    }
  };

  return (
    <section aria-labelledby="archived-environments" className="space-y-3">
      <div>
        <h2 id="archived-environments" className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
          <Archive size={16} aria-hidden /> Ambienti salvati (archivio)
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Gli ambienti che avevi salvato. Non se ne creano più: recuperane i dossier come dossier di studio.
        </p>
      </div>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
        {environments.map((env) => (
          <li key={env.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-slate-900 dark:text-white">{env.name}</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                {env.dossiers.length} {env.dossiers.length === 1 ? 'dossier' : 'dossier'} · {env.annotations.length} {env.annotations.length === 1 ? 'nota' : 'note'} · {env.highlights.length} {env.highlights.length === 1 ? 'evidenziazione' : 'evidenziazioni'}
              </span>
            </span>
            <span className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setRecovering(env)}
                disabled={env.dossiers.length === 0}
                aria-label={`Recupera i dossier di «${env.name}»`}
                className={`${ACTION} text-primary-700 hover:bg-primary-50 disabled:opacity-50 dark:text-primary-300 dark:hover:bg-slate-700`}
              >
                <FolderPlus size={14} aria-hidden /> Recupera i dossier
              </button>
              <button
                type="button"
                onClick={() => void exportOne(env)}
                aria-label={`Esporta «${env.name}» in JSON`}
                className={`${ACTION} text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700`}
              >
                <Download size={14} aria-hidden /> Esporta JSON
              </button>
              <button
                type="button"
                onClick={() => setDeleting(env)}
                aria-label={`Elimina «${env.name}»`}
                className={`${ACTION} text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20`}
              >
                <Trash2 size={14} aria-hidden /> Elimina
              </button>
            </span>
          </li>
        ))}
      </ul>

      {recovering && (
        <StudyImportDialog
          title="Recupera i dossier"
          intro={`Ciò che «${recovering.name}» conteneva ${becomesStudyDossiers(recovering.dossiers.length)}`}
          dossiers={recovering.dossiers}
          notes={recovering.annotations.length}
          highlights={recovering.highlights.length}
          confirmLabel="Recupera i dossier"
          failure="Non è stato possibile recuperare i dossier. Riprova."
          run={(switches) => environmentService.recover(recovering.id, switches)}
          onClose={() => setRecovering(null)}
          onAdded={(report) => {
            setRecovering(null);
            onRecovered(report);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void deleteEnvironment(deleting.id);
          setDeleting(null);
        }}
        title={deleting ? `Eliminare l'ambiente «${deleting.name}»?` : "Eliminare l'ambiente?"}
        message="L'ambiente salvato viene eliminato per sempre. I tuoi dossier, le note e le evidenziazioni non vengono toccati, nemmeno quelli recuperati da qui."
        confirmLabel="Elimina"
        variant="danger"
      />
    </section>
  );
}
