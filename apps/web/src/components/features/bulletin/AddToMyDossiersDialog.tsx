import { useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import { publishMerltEvent, MERLT_EVENT_TYPES } from '../../../features/merlt/merltEventBus';
import { getErrorMessage } from '../../../utils/errors';
import type { SharedEnvironment, StudyImportReport } from '../../../types';

interface Props {
  sharedEnvironment: SharedEnvironment;
  onClose: () => void;
  onAdded: (report: StudyImportReport) => void;
}

const CHECKBOX = 'mt-0.5 h-4 w-4 shrink-0 accent-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

/**
 * «Aggiungi ai miei dossier» on a Forum item (spec 2026-10-13-environments-into-forum, D8): its dossiers become the
 * user's dossiers di studio in one server request, with the notes and highlights unless switched off. Never an
 * existing dossier changed. The download is counted and `forum_download` sent once the server has done it.
 */
export function AddToMyDossiersDialog({ sharedEnvironment, onClose, onAdded }: Props) {
  const content = sharedEnvironment.content;
  const notes = sharedEnvironment.includeNotes ? content.annotations.length : 0;
  const highlights = sharedEnvironment.includeHighlights ? content.highlights.length : 0;
  const shortcuts = content.quickNorms.length + (content.customAliases?.length ?? 0);
  const [addNotes, setAddNotes] = useState(notes > 0);
  const [addHighlights, setAddHighlights] = useState(highlights > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const report = await sharedEnvironmentService.addToMyDossiers(sharedEnvironment.id, { addNotes, addHighlights });
      // MERLT-1.10: forum_download, once the server has the download.
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.forumDownload,
        metadata: { shared_env_id: sharedEnvironment.id },
      });
      onAdded(report);
    } catch (err) {
      setError(getErrorMessage(err) || 'Non è stato possibile aggiungere i dossier. Riprova.');
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={() => { if (!busy) onClose(); }}
      title="Aggiungi ai miei dossier"
      icon={<FolderPlus size={20} />}
      size="md"
      footer={(
        <>
          <Button variant="secondary" size="sm" className={TOUCH_TARGET_RESPONSIVE} disabled={busy} onClick={onClose}>Annulla</Button>
          <Button size="sm" className={TOUCH_TARGET_RESPONSIVE} loading={busy} onClick={() => void add()}>Aggiungi</Button>
        </>
      )}
    >
      <div className="space-y-4 text-sm text-slate-700 dark:text-slate-300">
        <p>
          «{sharedEnvironment.title}» di @{sharedEnvironment.user?.username ?? 'utente'} diventa {content.dossiers.length === 1 ? 'un tuo dossier' : `${content.dossiers.length} tuoi dossier`} di studio.
          I tuoi dossier esistenti restano come sono.
        </p>
        <ul className="space-y-0.5">
          {content.dossiers.map((d) => (
            <li key={d.id}>
              <span className="font-medium text-slate-900 dark:text-white">{d.title}</span>
              <span className="text-slate-500"> · {d.items.length} {d.items.length === 1 ? 'voce' : 'voci'}</span>
            </li>
          ))}
        </ul>
        {(notes > 0 || highlights > 0) && (
          <fieldset className="space-y-1">
            <legend className="sr-only">Cosa aggiungere</legend>
            {notes > 0 && (
              <label className={`flex items-start gap-2 ${TOUCH_TARGET_RESPONSIVE}`}>
                <input type="checkbox" checked={addNotes} onChange={(e) => setAddNotes(e.target.checked)} className={CHECKBOX} />
                Le note ({notes})
              </label>
            )}
            {highlights > 0 && (
              <label className={`flex items-start gap-2 ${TOUCH_TARGET_RESPONSIVE}`}>
                <input type="checkbox" checked={addHighlights} onChange={(e) => setAddHighlights(e.target.checked)} className={CHECKBOX} />
                Le evidenziazioni ({highlights})
              </label>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Note ed evidenziazioni si aggiungono agli articoli: le vedrai ovunque leggi quegli articoli, con il nome di chi le ha scritte.
              Quelle che hai già non si ripetono.
            </p>
          </fieldset>
        )}
        {shortcuts > 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Contiene anche {shortcuts} tra norme rapide e alias: si aggiungono ai tuoi, saltando quelli con lo stesso nome.
          </p>
        )}
        {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </Modal>
  );
}
