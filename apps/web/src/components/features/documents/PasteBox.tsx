import { useId, useState, type FormEvent } from 'react';
import { Button } from '../../ui/Button';
import { FIELD_TEXT, FOCUS_RING } from '../../../constants/interactions';
import { cn } from '../../../lib/utils';

/** The longest text the box takes (spec 2026-10-31-document-hyperlinks §5.1): two million characters. */
export const MAX_PASTE_CHARS = 2_000_000;

/**
 * «Oppure incolla il testo» (spec #391 §5.1, Q5): plain text in — the words and the paragraphs, not the styles —
 * read as a TXT file would be (a paragraph is a line). Never sent: it goes through the same reading as a file.
 */
export function PasteBox({ busy, onAnalyse }: { busy: boolean; onAnalyse: (text: string) => void }) {
  const [value, setValue] = useState('');
  const id = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim() && !busy) onAnalyse(value);
  };
  return (
    <form onSubmit={submit} className="flex min-w-0 flex-col gap-2 rounded-[10px] border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <label htmlFor={id} className="font-serif text-lg text-slate-900 dark:text-slate-50">Oppure incolla il testo</label>
      <p id={`${id}-hint`} className="text-sm text-slate-600 dark:text-slate-400">
        Restano le parole e i paragrafi, non la formattazione: per un atto intero è meglio il file.
      </p>
      <textarea
        id={id}
        aria-describedby={`${id}-hint`}
        value={value}
        maxLength={MAX_PASTE_CHARS}
        onChange={(event) => setValue(event.target.value)}
        rows={5}
        spellCheck={false}
        placeholder="Incolla qui il testo dell’atto…"
        className={cn(
          'min-h-28 w-full flex-1 resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 font-serif leading-relaxed text-slate-900 placeholder:text-slate-500 dark:placeholder:text-slate-400',
          'dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100',
          FIELD_TEXT, FOCUS_RING,
        )}
      />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="sm" disabled={!value.trim() || busy}>
          Analizza il testo
        </Button>
      </div>
    </form>
  );
}
