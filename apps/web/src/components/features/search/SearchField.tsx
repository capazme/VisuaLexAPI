import { useEffect, useRef, useState, type KeyboardEvent, type ClipboardEvent } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import { ISLAND_FOCUS, ISLAND_HINT, ISLAND_LENS, ISLAND_PLACEHOLDER, ISLAND_SHAPE, ISLAND_SURFACE, ISLAND_TARGET, ISLAND_TEXT, ISLAND_WORDS, PALETTE_SHORTCUT, SEARCH_FIELD_FORM_ID, subscribeSearchField } from '../../../utils/searchFieldControl';

/**
 * The search page's field, always on screen above the practices (spec `2026-10-13-fixed-search-design.md`), and the
 * door to the search menu (R2): a click, Enter, the arrows, a key typed on it (which goes on in the menu's box) or ⌘K
 * grow it into the menu, in the same place, with its words; Tab only brings the focus (a focus changes no context,
 * WCAG 3.2.1 — Bill's choice) — one field: what the menu reads, its first row, Enter, the acts, favourites, aliases,
 * filters and the steps are all the menu's (`CommandPalette`). The menu closing without a choice gives its words back
 * here; a choice empties it.
 */
/** `compact`: the top bar's size from lg (LC21), 32 px and a short hint, where it sits at the right of the path. */
export function SearchField({ compact = false }: { compact?: boolean } = {}) {
  const [value, setValue] = useState('');
  const valueRef = useRef(value);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isOpen = useAppStore((s) => s.commandPaletteOpen);
  const openCommandPaletteWith = useAppStore((s) => s.openCommandPaletteWith);
  const openCommandPalette = useAppStore((s) => s.openCommandPalette);

  useEffect(() => {
    valueRef.current = value;
  });

  /** Grows into the menu with `words` (the field's own, by default). */
  const open = (words = valueRef.current) => {
    if (words.trim()) openCommandPaletteWith(words);
    else openCommandPalette();
  };
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });

  // Requests from elsewhere: the empty page and ⌘K open the menu; the sidebar's «Ricerca» puts only the cursor on
  // the field (`focus`); the menu closing gives its words back (`open: false`).
  useEffect(() => subscribeSearchField(({ text, open: grow = true, focus }) => {
    if (text !== undefined) setValue(text);
    if (focus) {
      buttonRef.current?.focus();
    } else if (grow) openRef.current(text ?? valueRef.current);
  }), []);

  // Pasted on it, the words go on in the menu, after its own (a button takes no paste of its own: Ctrl/⌘+V reaches it as
  // a key with a modifier, which `onKeyDown` leaves alone).
  const onPaste = (event: ClipboardEvent<HTMLButtonElement>) => {
    const pasted = event.clipboardData.getData('text').replace(/\s+/g, ' ').trim();
    if (!pasted) return;
    event.preventDefault();
    open(valueRef.current ? `${valueRef.current} ${pasted}` : pasted);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    // A letter typed on the field goes on in the menu, after its words; Enter, Space and the arrows open it.
    // AltGr (Ctrl and Alt on Windows) writes «@», «#», «[» on an Italian keyboard: a character too.
    const writes = !event.metaKey && (!event.ctrlKey || event.getModifierState('AltGraph'));
    if (event.key.length === 1 && writes && !event.nativeEvent.isComposing) {
      event.preventDefault();
      open(valueRef.current + event.key);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // (Enter and Space press the button: its click opens it.)
      event.preventDefault();
      open();
    } else if (event.key === 'Escape' && valueRef.current) {
      // Esc empties the words, as it did.
      event.preventDefault();
      setValue('');
    }
  };

  return (
    <div className={cn('relative', compact ? 'w-[22rem]' : 'w-full max-w-3xl')}>
      <form id={SEARCH_FIELD_FORM_ID} role="search" aria-label="Ricerca" data-compact={compact ? '' : undefined} onSubmit={(event) => event.preventDefault()} className="flex items-center">
        {/* bare-button: it stands for the search field, the pill the menu of ⌘K opens from (LC81). */}
        <button
          ref={buttonRef}
          type="button"
          id="tour-search-field"
          aria-label={value ? `Apri il menu di ricerca: ${value}` : 'Apri il menu di ricerca'}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={(event) => {
            // Safari and a phone's tap do not focus a button: focused, it is where the menu gives the focus back.
            event.currentTarget.focus();
            open();
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          // It stands for a field: «?», ⌘Z and the other shortcuts of a page leave it alone.
          data-text-field=""
          className={cn(
            // LC81: the panel's field's shape and type (`ISLAND_SHAPE`, `ISLAND_TEXT`): 40 px and 16 px on a phone, 32 px
            // and 13 px in the top bar (`compact`, from lg). Below lg 44 px to the finger (LC69).
            'w-full text-left', ISLAND_SHAPE, ISLAND_TEXT, ISLAND_SURFACE, !compact && ISLAND_TARGET,
            'cursor-text', ISLAND_FOCUS,
          )}
        >
          <Search aria-hidden className={ISLAND_LENS} />
          {/* The examples are the panel's, on the line under its field: the pill and the field say the same words (LC81). */}
          <span className={cn('min-w-0 flex-1 truncate', value ? ISLAND_WORDS : ISLAND_HINT)}>{value || ISLAND_PLACEHOLDER}</span>
          {/* ⌘K (Ctrl K) opens it from anywhere on the page; said where a keyboard is likely: never on a phone, nor on a
              touch screen wider than md (M1), which has no such shortcut. */}
          <kbd aria-hidden className="ml-2 hidden shrink-0 rounded border border-slate-200 px-1 text-[11px] font-semibold text-slate-500 md:inline [@media(pointer:coarse)]:hidden dark:border-slate-700 dark:text-slate-400">
            {PALETTE_SHORTCUT}
          </kbd>
        </button>
      </form>
    </div>
  );
}
