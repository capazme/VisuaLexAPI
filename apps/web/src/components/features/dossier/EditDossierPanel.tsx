import { useId, useState, type FormEvent } from 'react';
import type { Dossier, DossierKind } from '../../../types';
import { DossierKindChoice } from './DossierKindChoice';
import { Button } from '../../ui/Button';
import { Expand } from '../../ui/Expand';
import { Input } from '../../ui/Input';
import { Textarea } from '../../ui/Textarea';
import { CARD_RADIUS, CONTROL_BORDER } from '../../ui/controlStyles';
import { cn } from '../../../lib/utils';

interface Props {
  /** The dossier being edited; null, closed. */
  dossier: Dossier | null;
  onClose: () => void;
  onSave: (title: string, description: string, tags: string[], kind: DossierKind) => void;
  className?: string;
}

/**
 * «Modifica pratica» in the page (LC107, L-73): a space that opens under what asked for it (`Expand`), never over the
 * content. The focus lands on the space, Esc closes it and the focus goes back to the command.
 */
export function EditDossierPanel({ dossier, onClose, onSave, className }: Props) {
  // The dossier stays drawn while the space closes: the closing shows the form, not an empty box.
  const [shown, setShown] = useState(dossier);
  if (dossier && dossier !== shown) setShown(dossier);
  const headingId = useId();

  return (
    <Expand
      open={dossier !== null}
      onClose={onClose}
      role="region"
      aria-labelledby={headingId}
      className={cn('bg-card', CARD_RADIUS, CONTROL_BORDER, className)}
    >
      {/* Closed, `Expand` draws nothing: opened again, the fields start from the dossier as it is. */}
      {shown && <EditForm key={shown.id} dossier={shown} headingId={headingId} onClose={onClose} onSave={onSave} />}
    </Expand>
  );
}

function EditForm({ dossier, headingId, onClose, onSave }: Omit<Props, 'dossier' | 'className'> & { dossier: Dossier; headingId: string }) {
  const [title, setTitle] = useState(dossier.title);
  const [description, setDescription] = useState(dossier.description ?? '');
  const [tagsInput, setTagsInput] = useState((dossier.tags ?? []).join(', '));
  const [kind, setKind] = useState<DossierKind>(dossier.kind ?? 'lavoro');

  const handleSave = (event: FormEvent) => {
    event.preventDefault();
    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
    onSave(title, description, tags, kind);
    onClose();
  };

  return (
    <form onSubmit={handleSave} className="space-y-4 p-4 md:p-5">
      <h2 id={headingId} className="text-base font-semibold text-slate-900 dark:text-slate-50">Modifica pratica</h2>
      <Input label="Titolo" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Textarea label="Descrizione" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="resize-none" />
      <Input
        label="Tag (separati da virgola)"
        value={tagsInput}
        onChange={(e) => setTagsInput(e.target.value)}
        placeholder="diritto civile, contratti, obbligazioni"
      />
      <DossierKindChoice value={kind} onChange={setKind} />
      <div className="flex justify-end gap-3">
        <Button type="button" variant="quiet" onClick={onClose}>
          Annulla
        </Button>
        <Button type="submit">
          Salva
        </Button>
      </div>
    </form>
  );
}
