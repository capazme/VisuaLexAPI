import { FolderPlus } from 'lucide-react';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import { publishMerltEvent, MERLT_EVENT_TYPES } from '../../../features/merlt/merltEventBus';
import { StudyImportDialog } from './StudyImportDialog';
import { ForumSpace } from './ForumSpace';
import { becomesStudyDossiers } from '../../../utils/studyImportReport';
import type { SharedEnvironment, StudyImportReport } from '../../../types';

interface Props {
  /** The Forum item; null, closed. */
  sharedEnvironment: SharedEnvironment | null;
  onClose: () => void;
  onAdded: (report: StudyImportReport) => void;
}

/**
 * «Aggiungi ai miei dossier» on a Forum item (spec 2026-10-13-environments-into-forum, D8): its dossiers become the
 * user's dossiers di studio in one server request, with the notes and highlights unless switched off. The download
 * is counted and `forum_download` sent once the server has done it. In the page at the top of the tab (LC138, L-73).
 */
export function AddToMyDossiersDialog({ sharedEnvironment, onClose, onAdded }: Props) {
  return (
    <ForumSpace value={sharedEnvironment} onClose={onClose} icon={<FolderPlus size={20} aria-hidden className="shrink-0" />} title="Aggiungi ai miei dossier">
      {(env, setBusy) => (
        <StudyImportDialog
          intro={`«${env.title}» di @${env.user?.username ?? 'utente'} ${becomesStudyDossiers(env.content.dossiers.length)}`}
          dossiers={env.content.dossiers}
          notes={env.includeNotes ? env.content.annotations.length : 0}
          highlights={env.includeHighlights ? env.content.highlights.length : 0}
          shortcuts={env.content.quickNorms.length + (env.content.customAliases?.length ?? 0)}
          fromAuthor
          confirmLabel="Aggiungi"
          failure="Non è stato possibile aggiungere i dossier. Riprova."
          run={async (switches) => {
            const report = await sharedEnvironmentService.addToMyDossiers(env.id, switches);
            // MERLT-1.10: forum_download, once the server has counted the download (never one's own item, D15).
            if (!env.isOwner) publishMerltEvent({
              interaction_type: MERLT_EVENT_TYPES.forumDownload,
              metadata: { shared_env_id: env.id },
            });
            return report;
          }}
          onClose={onClose}
          onAdded={onAdded}
          setBusy={setBusy}
        />
      )}
    </ForumSpace>
  );
}
