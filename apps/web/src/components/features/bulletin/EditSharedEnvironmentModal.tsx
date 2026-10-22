import { useState } from 'react';
import { Save } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import { FORUM_CATEGORIES } from '../../../utils/forumCategories';
import { findPersonalData, PERSONAL_DATA_LABELS } from '../../../utils/personalDataPatterns';
import { getErrorMessage } from '../../../utils/errors';
import type { SharedEnvironment, EnvironmentCategory } from '../../../types';

interface EditSharedEnvironmentModalProps {
  environment: SharedEnvironment;
  onClose: () => void;
  onUpdated: (updated: SharedEnvironment) => void;
}

const TITLE_MIN = 3;
const TITLE_MAX = 100;
const DESCRIPTION_MAX = 500;
const TAGS_MAX = 10;
const TAG_MAX = 30;
const INPUT = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

function flag(text: string): string | null {
  const kinds = [...new Set(findPersonalData(text).map((s) => PERSONAL_DATA_LABELS[s.kind]))];
  return kinds.length ? `Possibile dato personale: ${kinds.join(', ')}` : null;
}

/**
 * «Modifica» on a published dossier in the Forum: its name, description, category and tags. What it holds changes
 * from the dossier («Aggiorna la versione pubblicata», spec 2026-10-13-environments-into-forum, D3–D4), never from
 * here: the old version of this dialog republished the user's whole workspace.
 */
export function EditSharedEnvironmentModal({ environment, onClose, onUpdated }: EditSharedEnvironmentModalProps) {
  const [title, setTitle] = useState(environment.title);
  const [description, setDescription] = useState(environment.description ?? '');
  const [category, setCategory] = useState<EnvironmentCategory>(environment.category);
  const [tagsInput, setTagsInput] = useState(environment.tags.join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
  const titleError = title.trim().length < TITLE_MIN ? `Il titolo deve avere almeno ${TITLE_MIN} caratteri.` : null;
  const tagsError = tags.length > TAGS_MAX || tags.some((t) => t.length > TAG_MAX) ? `Al massimo ${TAGS_MAX} tag, di ${TAG_MAX} caratteri.` : null;

  const save = async () => {
    if (titleError || tagsError) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await sharedEnvironmentService.updateWithVersion(environment.id, {
        title: title.trim(),
        // Emptied is cleared, never left as it was.
        description: description.trim() || null,
        category,
        tags,
      });
      onUpdated(updated);
    } catch (err) {
      setError(getErrorMessage(err) || 'Modifica non riuscita. Riprova.');
      setBusy(false);
    }
  };

  const titleFlag = flag(title);
  const descriptionFlag = flag(description);

  return (
    <Modal
      isOpen
      onClose={() => { if (!busy) onClose(); }}
      title="Modifica il dossier pubblicato"
      icon={<Save size={20} />}
      size="md"
      footer={(
        <>
          <Button variant="secondary" size="sm" className={TOUCH_TARGET_RESPONSIVE} disabled={busy} onClick={onClose}>Annulla</Button>
          <Button size="sm" className={TOUCH_TARGET_RESPONSIVE} loading={busy} disabled={!!titleError || !!tagsError} onClick={() => void save()}>Salva</Button>
        </>
      )}
    >
      <div className="grid gap-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Il contenuto si aggiorna dal tuo dossier, con «Aggiorna la versione pubblicata».
        </p>
        <div>
          <label htmlFor="edit-shared-title" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Titolo</label>
          <input id="edit-shared-title" value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} className={INPUT} />
          {titleError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{titleError}</p>}
          {titleFlag && <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">{titleFlag}</p>}
        </div>
        <div>
          <label htmlFor="edit-shared-description" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Descrizione</label>
          <textarea id="edit-shared-description" value={description} maxLength={DESCRIPTION_MAX} rows={3} onChange={(e) => setDescription(e.target.value)} className={`${INPUT} resize-none`} />
          {descriptionFlag && <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">{descriptionFlag}</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="edit-shared-category" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Categoria</label>
            <select id="edit-shared-category" value={category} onChange={(e) => setCategory(e.target.value as EnvironmentCategory)} className={`${INPUT} min-h-[44px] md:min-h-0`}>
              {FORUM_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="edit-shared-tags" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Tag (separati da virgola)</label>
            <input id="edit-shared-tags" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} className={INPUT} />
            {tagsError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{tagsError}</p>}
          </div>
        </div>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </Modal>
  );
}
