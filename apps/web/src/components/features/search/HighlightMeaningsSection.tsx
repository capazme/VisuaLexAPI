import { useId, useState, type KeyboardEvent, type Ref } from 'react';
import { RotateCcw } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { useHighlightColorMeanings } from '../../../hooks/useHighlightColorMeanings';
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_COLOR_MEANINGS,
  HIGHLIGHT_MEANING_MAX,
  highlightColorName,
  normalizeHighlightMeaning,
  type HighlightColor,
} from '../../../utils/highlightColors';
import { cn } from '../../../lib/utils';
import { FIELD_TEXT, FOCUS_RING } from '../../../constants/interactions';

const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Impostazioni › «Significato dei colori» (D8 §3, the owner: «solo etichette»): what each of the four colours means to
 * this user. The colours stay the four they are and no highlight changes (root rule 23: a highlight keeps its colour
 * key, only the words for it change); what is written here is what the colour menu says beside each colour. A field
 * saves when it is left or on Enter, trimmed, 1 to `HIGHLIGHT_MEANING_MAX` characters; an empty one keeps the meaning
 * it had, Esc gives up the change. «Ripristina predefiniti» brings back VisuaLex's four. Kept on this device with the
 * other reading settings (`settings.highlightColorMeanings`), never sent to the server. The heading takes the focus
 * when Impostazioni is opened here (the reader's gear): `headingRef`.
 */
export function HighlightMeaningsSection({ headingRef }: { headingRef?: Ref<HTMLHeadingElement> }) {
  const own = useAppStore((s) => s.settings.highlightColorMeanings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const meanings = useHighlightColorMeanings();
  // What is being typed, per colour, until it is saved or given up.
  const [drafts, setDrafts] = useState<Partial<Record<HighlightColor, string>>>({});
  const [status, setStatus] = useState('');
  const id = useId();
  const headingId = `${id}-heading`;
  const hintId = `${id}-hint`;

  const dropDraft = (color: HighlightColor) =>
    setDrafts((current) => {
      const next = { ...current };
      delete next[color];
      return next;
    });

  const commit = (color: HighlightColor) => {
    const draft = drafts[color];
    if (draft === undefined) return;
    dropDraft(color);
    const meaning = normalizeHighlightMeaning(draft);
    const name = highlightColorName(color);
    if (!meaning) {
      setStatus(`Il significato non può essere vuoto: il ${name} resta «${meanings[color]}».`);
      return;
    }
    if (meaning === meanings[color]) return;
    const next = { ...own };
    // The default again is no meaning of one's own: the colour follows the default from here on.
    if (meaning === HIGHLIGHT_COLOR_MEANINGS[color]) delete next[color];
    else next[color] = meaning;
    updateSettings({ highlightColorMeanings: next });
    setStatus(`Significato del ${name} salvato: «${meaning}».`);
  };

  const onKeyDown = (color: HighlightColor, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit(color);
    } else if (event.key === 'Escape' && drafts[color] !== undefined && drafts[color] !== meanings[color]) {
      // The change is given up and Impostazioni stays open; the next Esc closes it.
      event.preventDefault();
      dropDraft(color);
    }
  };

  const customised = Object.keys(own).length > 0 || Object.keys(drafts).length > 0;
  const reset = () => {
    if (!customised) return;
    setDrafts({});
    updateSettings({ highlightColorMeanings: {} });
    setStatus('Ripristinati i significati predefiniti.');
  };

  return (
    <section aria-labelledby={headingId}>
      <h3
        ref={headingRef}
        id={headingId}
        tabIndex={-1}
        className={cn('mb-1 rounded text-sm font-semibold text-slate-700 dark:text-slate-300', FOCUS_RING)}
      >
        Significato dei colori
      </h3>
      <p id={hintId} className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        Cosa vuol dire per te ogni colore dell’evidenziatore, fino a {HIGHLIGHT_MEANING_MAX} caratteri: lo leggi accanto al
        colore quando lo scegli. Le evidenziazioni non cambiano. Resta su questo dispositivo.
      </p>
      <div className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
        {HIGHLIGHT_COLORS.map((color) => {
          const inputId = `${id}-${color}`;
          return (
            // Under `sm` the colour over its field, as the rows of «Tipografia».
            <div key={color} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <label htmlFor={inputId} className="flex shrink-0 items-center gap-2 text-sm text-slate-700 sm:w-20 dark:text-slate-300">
                {/* The highlight's tint inside its ink, as in the colour menu. */}
                <span
                  aria-hidden
                  className="h-4 w-4 shrink-0 rounded-full border-2"
                  style={{ backgroundColor: `hsl(var(--hl-${color}-bg))`, borderColor: `hsl(var(--hl-${color}-fg))` }}
                />
                {capitalised(highlightColorName(color))}
              </label>
              <input
                id={inputId}
                type="text"
                value={drafts[color] ?? meanings[color]}
                maxLength={HIGHLIGHT_MEANING_MAX}
                placeholder={HIGHLIGHT_COLOR_MEANINGS[color]}
                aria-describedby={hintId}
                autoComplete="off"
                onChange={(event) => {
                  const value = event.target.value;
                  setDrafts((current) => ({ ...current, [color]: value }));
                }}
                onBlur={() => commit(color)}
                onKeyDown={(event) => onKeyDown(color, event)}
                className={cn(
                  'min-h-[44px] w-full min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-800 md:min-h-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100',
                  FIELD_TEXT,
                )}
              />
            </div>
          );
        })}
        <button
          type="button"
          onClick={reset}
          aria-disabled={!customised}
          className={cn(
            'inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors md:min-h-0',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
            customised
              ? 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              : 'cursor-not-allowed text-slate-500 dark:text-slate-400',
          )}
        >
          <RotateCcw size={16} aria-hidden /> Ripristina predefiniti
        </button>
        {/* Always drawn, empty too: a live region that appears with its words is not read. */}
        <p role="status" className="text-xs text-slate-500 dark:text-slate-400">{status}</p>
      </div>
    </section>
  );
}
