import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import { publishMerltEvent, MERLT_EVENT_TYPES } from '../../../features/merlt/merltEventBus';
import { StudyImportDialog } from './StudyImportDialog';
import { becomesStudyDossiers } from '../../../utils/studyImportReport';
import type { SharedEnvironment, StudyImportReport } from '../../../types';

interface Props {
  sharedEnvironment: SharedEnvironment;
  onClose: () => void;
  onAdded: (report: StudyImportReport) => void;
}

/**
 * «Aggiungi ai miei dossier» on a Forum item (spec 2026-10-13-environments-into-forum, D8): its dossiers become the
 * user's dossiers di studio in one server request, with the notes and highlights unless switched off. The download
 * is counted and `forum_download` sent once the server has done it.
 */
export function AddToMyDossiersDialog({ sharedEnvironment, onClose, onAdded }: Props) {
  const content = sharedEnvironment.content;
  return (
    <StudyImportDialog
      title="Aggiungi ai miei dossier"
      intro={`«${sharedEnvironment.title}» di @${sharedEnvironment.user?.username ?? 'utente'} ${becomesStudyDossiers(content.dossiers.length)}`}
      dossiers={content.dossiers}
      notes={sharedEnvironment.includeNotes ? content.annotations.length : 0}
      highlights={sharedEnvironment.includeHighlights ? content.highlights.length : 0}
      shortcuts={content.quickNorms.length + (content.customAliases?.length ?? 0)}
      fromAuthor
      confirmLabel="Aggiungi"
      failure="Non è stato possibile aggiungere i dossier. Riprova."
      run={async (switches) => {
        const report = await sharedEnvironmentService.addToMyDossiers(sharedEnvironment.id, switches);
        // MERLT-1.10: forum_download, once the server has counted the download (never one's own item, D15).
        if (!sharedEnvironment.isOwner) publishMerltEvent({
          interaction_type: MERLT_EVENT_TYPES.forumDownload,
          metadata: { shared_env_id: sharedEnvironment.id },
        });
        return report;
      }}
      onClose={onClose}
      onAdded={onAdded}
    />
  );
}
