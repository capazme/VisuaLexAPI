import { useId, useState, type FormEvent } from 'react';
import { Button } from '../../ui/Button';
import { Expand } from '../../ui/Expand';
import { Input } from '../../ui/Input';
import { Select } from '../../ui/Select';
import { Textarea } from '../../ui/Textarea';
import { CARD_RADIUS, CONTROL_BORDER } from '../../ui/controlStyles';
import { cn } from '../../../lib/utils';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import { FORUM_CATEGORIES } from '../../../utils/forumCategories';
import { findPersonalData, PERSONAL_DATA_LABELS } from '../../../utils/personalDataPatterns';
import { getErrorMessage } from '../../../utils/errors';
import type { SharedEnvironment, EnvironmentCategory } from '../../../types';

interface EditSharedEnvironmentPanelProps {
  /** The published dossier being edited; null, closed. */
  environment: SharedEnvironment | null;
  onClose: () => void;
  onUpdated: (updated: SharedEnvironment) => void;
}

const TITLE_MIN = 3;
const TITLE_MAX = 100;
const DESCRIPTION_MAX = 500;
const TAGS_MAX = 10;
const TAG_MAX = 30;
const FLAG = 'mt-1 text-xs font-medium text-amber-700 dark:text-amber-300';

function flag(text: string): string | null {
  const kinds = [...new Set(findPersonalData(text).map((s) => PERSONAL_DATA_LABELS[s.kind]))];
  return kinds.length ? `Possibile dato personale: ${kinds.join(', ')}` : null;
}

/**
 * «Modifica» on a published dossier in the Forum: its name, description, category and tags. What it holds changes
 * from the dossier («Aggiorna la versione pubblicata», spec 2026-10-13-environments-into-forum, D3–D4), never from
 * here: the old version of this dialog republished the user's whole workspace. In the page since LC114 (L-73): a space
 * at the top of «I miei pubblicati» (`Expand`), as «Modifica pratica» (LC107); Esc closes it, the focus goes back to
 * the card's menu.
 */
export function EditSharedEnvironmentPanel({ environment, onClose, onUpdated }: EditSharedEnvironmentPanelProps) {
  // The dossier stays drawn while the space closes: the closing shows the form, not an empty box.
  const [shown, setShown] = useState(environment);
  if (environment && environment !== shown) setShown(environment);
  const [busy, setBusy] = useState(false);
  const headingId = useId();
  // Not closed while the save travels: its answer has a place to land.
  const close = () => { if (!busy) onClose(); };
  return (
    <Expand
      open={environment !== null}
      onClose={close}
      role="region"
      aria-labelledby={headingId}
      className={cn('bg-card', CARD_RADIUS, CONTROL_BORDER)}
    >
      {/* Closed, `Expand` draws nothing: opened again, the fields start from the dossier as it is. */}
      {shown && <EditForm key={shown.id} environment={shown} headingId={headingId} busy={busy} setBusy={setBusy} onClose={close} onUpdated={onUpdated} />}
    </Expand>
  );
}

function EditForm({ environment, headingId, busy, setBusy, onClose, onUpdated }: {
  environment: SharedEnvironment;
  headingId: string;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onClose: () => void;
  onUpdated: (updated: SharedEnvironment) => void;
}) {
  const [title, setTitle] = useState(environment.title);
  const [description, setDescription] = useState(environment.description ?? '');
  const [category, setCategory] = useState<EnvironmentCategory>(environment.category);
  const [tagsInput, setTagsInput] = useState(environment.tags.join(', '));
  const [error, setError] = useState<string | null>(null);

  const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
  const titleError = title.trim().length < TITLE_MIN ? `Il titolo deve avere almeno ${TITLE_MIN} caratteri.` : null;
  const tagsError = tags.length > TAGS_MAX || tags.some((t) => t.length > TAG_MAX) ? `Al massimo ${TAGS_MAX} tag, di ${TAG_MAX} caratteri.` : null;

  const save = async (event: FormEvent) => {
    event.preventDefault();
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
      setBusy(false);
      onUpdated(updated);
    } catch (err) {
      setError(getErrorMessage(err) || 'Modifica non riuscita. Riprova.');
      setBusy(false);
    }
  };

  const titleFlag = flag(title);
  const descriptionFlag = flag(description);

  return (
    <form onSubmit={(event) => void save(event)} className="grid gap-4 p-4 md:p-5">
      <h2 id={headingId} className="text-base font-semibold text-slate-900 dark:text-slate-50">Modifica il dossier pubblicato</h2>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Il contenuto si aggiorna dal tuo dossier, con «Aggiorna la versione pubblicata».
      </p>
      <div>
        <Input label="Titolo" value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} error={titleError ?? undefined} />
        {titleFlag && <p className={FLAG}>{titleFlag}</p>}
      </div>
      <div>
        <Textarea label="Descrizione" value={description} maxLength={DESCRIPTION_MAX} rows={3} onChange={(e) => setDescription(e.target.value)} className="resize-none" />
        {descriptionFlag && <p className={FLAG}>{descriptionFlag}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Categoria" value={category} onChange={(e) => setCategory(e.target.value as EnvironmentCategory)}>
          {FORUM_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
        <Input label="Tag (separati da virgola)" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} error={tagsError ?? undefined} />
      </div>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="quiet" disabled={busy} onClick={onClose}>Annulla</Button>
        <Button type="submit" loading={busy} disabled={!!titleError || !!tagsError}>Salva</Button>
      </div>
    </form>
  );
}
