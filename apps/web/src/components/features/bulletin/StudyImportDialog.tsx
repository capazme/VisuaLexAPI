import { useState, type ReactNode } from 'react';
import { FolderPlus } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import { getErrorMessage } from '../../../utils/errors';
import type { StudyImportReport } from '../../../types';

export interface StudyImportSwitches {
  addNotes: boolean;
  addHighlights: boolean;
}

export interface StudyImportDialogProps {
  title: string;
  /** The sentence that says what becomes of what. */
  intro: ReactNode;
  dossiers: ReadonlyArray<{ id: string; title: string; items: readonly unknown[] }>;
  notes: number;
  highlights: number;
  /** Quick norms and aliases that come along (a legacy Forum item's only); 0 says nothing. */
  shortcuts?: number;
  /** Someone else's notes: they keep their author's name. */
  fromAuthor?: boolean;
  confirmLabel: string;
  failure: string;
  run: (switches: StudyImportSwitches) => Promise<StudyImportReport>;
  onClose: () => void;
  onAdded: (report: StudyImportReport) => void;
}

const CHECKBOX = 'mt-0.5 h-4 w-4 shrink-0 accent-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

/**
 * Content that becomes the user's dossiers di studio (spec 2026-10-13-environments-into-forum, D8–D11): a Forum
 * item, an environment of the archive, an old environment link. The dossiers listed, the notes and highlights as
 * switches, one server request; never an existing dossier changed.
 */
export function StudyImportDialog({
  title, intro, dossiers, notes, highlights, shortcuts = 0, fromAuthor = false, confirmLabel, failure, run, onClose, onAdded,
}: StudyImportDialogProps) {
  const [addNotes, setAddNotes] = useState(notes > 0);
  const [addHighlights, setAddHighlights] = useState(highlights > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      onAdded(await run({ addNotes, addHighlights }));
    } catch (err) {
      setError(getErrorMessage(err) || failure);
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={() => { if (!busy) onClose(); }}
      title={title}
      icon={<FolderPlus size={20} />}
      size="md"
      footer={(
        <>
          <Button variant="secondary" size="sm" className={TOUCH_TARGET_RESPONSIVE} disabled={busy} onClick={onClose}>Annulla</Button>
          <Button size="sm" className={TOUCH_TARGET_RESPONSIVE} loading={busy} onClick={() => void add()}>{confirmLabel}</Button>
        </>
      )}
    >
      <div className="space-y-4 text-sm text-slate-700 dark:text-slate-300">
        <p>
          {intro}
          {' '}I tuoi dossier esistenti restano come sono.
        </p>
        <ul className="space-y-0.5">
          {dossiers.map((d) => (
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
              Note ed evidenziazioni si aggiungono agli articoli: le vedrai ovunque leggi quegli articoli{fromAuthor ? ', con il nome di chi le ha scritte' : ''}.
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

