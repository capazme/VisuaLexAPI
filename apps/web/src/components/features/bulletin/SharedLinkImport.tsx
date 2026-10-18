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
import type { Dossier, Environment, StudyImportReport } from '../../../types';

/** The link read, and the dossiers it holds that can be listed: anyone can write a link, so its shape is checked. */
function readLink(encoded: string): { ok: true; env: Environment; dossiers: Dossier[] } | { ok: false } {
  const parsed = parseEnvironmentFromBase64(encoded);
  if (!parsed.success) return { ok: false };
  const dossiers = parsed.data.dossiers.filter((d): d is Dossier => typeof d?.title === 'string' && Array.isArray(d.items));
  if (dossiers.length === 0) return { ok: false };
  const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? value : []);
  return { ok: true, env: { ...parsed.data, annotations: list(parsed.data.annotations), highlights: list(parsed.data.highlights) }, dossiers };
}

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
  const parsed = useMemo(() => (encoded ? readLink(encoded) : null), [encoded]);
  if (!parsed) return null;

  const clear = () => setSearchParams((prev) => {
    const next = new URLSearchParams(prev);
    next.delete('import');
    return next;
  }, { replace: true });

  if (!parsed.ok) {
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

  const { env, dossiers } = parsed;
  return (
    <StudyImportDialog
      title="Recupera i dossier"
      intro={`Il link condiviso «${env.name}» ${becomesStudyDossiers(dossiers.length)}`}
      dossiers={dossiers}
      notes={env.annotations.length}
      highlights={env.highlights.length}
      confirmLabel="Recupera i dossier"
      failure="Non è stato possibile recuperare i dossier. Riprova."
      run={(switches) => dossierService.importStudy(
        { dossiers, quickNorms: [], annotations: env.annotations, highlights: env.highlights },
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
