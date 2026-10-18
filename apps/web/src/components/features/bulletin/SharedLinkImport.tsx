import { useMemo } from 'react';
import { Link2Off } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import { dossierService } from '../../../services/dossierService';
import { parseEnvironmentFromBase64 } from '../../../utils/environmentUtils';
import { StudyImportDialog } from './StudyImportDialog';
import { becomesStudyDossiers } from '../../../utils/studyImportReport';
import type { StudyImportReport } from '../../../types';

interface Props {
  onRecovered: (report: StudyImportReport) => void;
}

/**
 * An old environment link (`/environments?import=…`, redirected to `/forum?import=…`; spec
 * 2026-10-13-environments-into-forum, D11c): its preview, then «Recupera i dossier» through `POST /dossiers/import-study`,
 * which filters it as Forum content. Its quick norms and aliases are not added. The parameter stays in the address
 * until the dialog closes, so a reload shows it again.
 */
export function SharedLinkImport({ onRecovered }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const encoded = searchParams.get('import');
  const parsed = useMemo(() => (encoded ? parseEnvironmentFromBase64(encoded) : null), [encoded]);
  if (!parsed) return null;

  const clear = () => setSearchParams((prev) => {
    const next = new URLSearchParams(prev);
    next.delete('import');
    return next;
  }, { replace: true });

  if (!parsed.success) {
    return (
      <Modal
        isOpen
        onClose={clear}
        title="Link non valido"
        icon={<Link2Off size={20} />}
        size="sm"
        footer={<Button size="sm" className={TOUCH_TARGET_RESPONSIVE} onClick={clear}>Chiudi</Button>}
      >
        <p className="text-sm text-slate-700 dark:text-slate-300">Il link non contiene dossier leggibili: chiedi a chi l'ha condiviso di mandarti il file JSON.</p>
      </Modal>
    );
  }

  const env = parsed.data;
  return (
    <StudyImportDialog
      title="Recupera i dossier"
      intro={`Il link condiviso «${env.name}» ${becomesStudyDossiers(env.dossiers.length)}`}
      dossiers={env.dossiers}
      notes={env.annotations.length}
      highlights={env.highlights.length}
      confirmLabel="Recupera i dossier"
      failure="Non è stato possibile recuperare i dossier. Riprova."
      run={(switches) => dossierService.importStudy(
        { dossiers: env.dossiers, quickNorms: [], annotations: env.annotations, highlights: env.highlights },
        switches,
      )}
      onClose={clear}
      onAdded={(report) => {
        clear();
        onRecovered(report);
      }}
    />
  );
}
