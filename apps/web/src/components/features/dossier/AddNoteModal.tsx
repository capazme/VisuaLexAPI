import { useId, useState, type KeyboardEvent } from 'react';
import { StickyNote } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Button } from '../../ui/Button';
import { Expand } from '../../ui/Expand';
import { Textarea } from '../../ui/Textarea';
import { CARD_RADIUS, CONTROL_BORDER } from '../../ui/controlStyles';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Resolves true once the note is saved: only then the space closes, so a refused note keeps its text. */
  onSave: (text: string) => void | boolean | Promise<boolean>;
  /** What the note is about, as the space's title; the dossier itself by default. */
  heading?: string;
  confirmLabel?: string;
  className?: string;
}

// The cap the MCP round sets for Claude's notes too (S11): one cap for every note of a dossier.
const MAX_NOTE_LENGTH = 4000;

/**
 * «Aggiungi una nota alla pratica» in the page (LC125, L-73): a space under the header's «Aggiungi» (`Expand`), never
 * over the content. The focus lands on the space, never in the field (a phone's keyboard); Esc closes it and the focus
 * goes back to the command.
 */
export function AddNoteModal({ open, className, ...form }: Props) {
  const headingId = useId();
  return (
    <Expand open={open} onClose={form.onClose} role="region" aria-labelledby={headingId} className={cn('bg-card', CARD_RADIUS, CONTROL_BORDER, className)}>
      {/* Closed, `Expand` draws nothing: opened again, the field starts empty. */}
      <NoteForm {...form} headingId={headingId} />
    </Expand>
  );
}

function NoteForm({ onClose, onSave, heading = 'Aggiungi una nota alla pratica', confirmLabel = 'Aggiungi alla pratica', headingId }: Omit<Props, 'open' | 'className'> & { headingId: string }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = text.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    const saved = await onSave(trimmed);
    setSaving(false);
    if (saved !== false) onClose();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleSave();
    }
  };

  const isEmpty = text.trim().length === 0;
  const remaining = MAX_NOTE_LENGTH - text.length;

  return (
    <div className="space-y-3 p-4 md:p-5">
      <h2 id={headingId} className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-50">
        <StickyNote size={18} aria-hidden className="flex-shrink-0 text-yellow-500" />
        {heading}
      </h2>
      <div className="space-y-2">
        <Textarea
          aria-label="Testo della nota"
          id="dossier-note-text"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_NOTE_LENGTH))}
          onKeyDown={handleKeyDown}
          rows={6}
          placeholder="Scrivi un appunto, una riflessione o un promemoria da allegare alla pratica…"
          className="min-h-32"
        />
        <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>⌘/Ctrl + Invio per salvare</span>
          <span className={remaining < 100 ? 'text-amber-600' : undefined}>
            {remaining} caratteri rimanenti
          </span>
        </div>
      </div>
      <div className="flex justify-end gap-3">
        <Button type="button" variant="quiet" onClick={onClose}>
          Annulla
        </Button>
        <Button type="button" onClick={() => void handleSave()} disabled={isEmpty || saving}>
          {saving ? 'Salvo…' : confirmLabel}
        </Button>
      </div>
    </div>
  );
}
