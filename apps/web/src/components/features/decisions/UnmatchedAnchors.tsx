import { X } from 'lucide-react';
import type { Annotation, Highlight } from '../../../types';
import { getHighlightSwatch } from '../../../utils/highlightColors';

export interface UnmatchedAnchorsProps {
  highlights: readonly Highlight[];
  annotations: readonly Annotation[];
  /** `changed`: the source's text is no longer what the anchors were made on. `no_text`: there is none. */
  reason: 'changed' | 'no_text';
  onRemoveHighlight: (id: string) => void;
  onRemoveAnnotation: (id: string) => void;
}

const EXPLANATION = {
  changed: 'Il testo della fonte è cambiato dopo che le hai create.',
  no_text: 'La fonte non mostra più il testo di questa decisione: le tue note ed evidenziazioni restano qui.',
} as const;

const removeButton =
  'inline-flex shrink-0 items-center justify-center rounded p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-900/20 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0';

/**
 * The notes and highlights on a decision that do not land in its text, listed and never dropped
 * (spec §8.4): the quote they were made on, the note's words, and a way to remove each. Absent
 * when there are none.
 */
export function UnmatchedAnchors({ highlights, annotations, reason, onRemoveHighlight, onRemoveAnnotation }: UnmatchedAnchorsProps) {
  const total = highlights.length + annotations.length;
  if (total === 0) return null;
  return (
    <section
      aria-label={`Non ritrovate nel testo attuale (${total})`}
      className="mt-6 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm dark:border-amber-900/40 dark:bg-amber-950/20"
    >
      <h5 className="font-semibold text-slate-700 dark:text-slate-200">Non ritrovate nel testo attuale</h5>
      <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{EXPLANATION[reason]}</p>
      <ul className="mt-2 space-y-2">
        {highlights.map((h) => (
          <li key={`h-${h.id}`} className="relative flex items-start gap-2 overflow-hidden rounded border border-slate-100 bg-white py-1.5 pl-3 pr-1.5 dark:border-slate-700 dark:bg-slate-900">
            <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: getHighlightSwatch(h.color) }} />
            <p className="min-w-0 flex-1 text-xs text-slate-700 dark:text-slate-300">«{h.text}»</p>
            <button type="button" className={removeButton} aria-label={`Rimuovi evidenziazione «${h.text}»`} title="Rimuovi evidenziazione" onClick={() => onRemoveHighlight(h.id)}>
              <X size={14} aria-hidden />
            </button>
          </li>
        ))}
        {annotations.map((a) => (
          <li key={`n-${a.id}`} className="flex items-start gap-2 rounded border border-slate-100 bg-white py-1.5 pl-3 pr-1.5 dark:border-slate-700 dark:bg-slate-900">
            <div className="min-w-0 flex-1 text-xs text-slate-700 dark:text-slate-300">
              {a.anchorText && <p className="italic text-slate-500 dark:text-slate-400">«{a.anchorText}»</p>}
              <p className="whitespace-pre-wrap">{a.text}</p>
            </div>
            <button type="button" className={removeButton} aria-label={`Rimuovi nota «${a.text.length > 40 ? `${a.text.slice(0, 40)}…` : a.text}»`} title="Rimuovi nota" onClick={() => onRemoveAnnotation(a.id)}>
              <X size={14} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
