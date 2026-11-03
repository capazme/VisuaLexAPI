import { useCallback, useEffect, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronDown, Highlighter, Settings } from 'lucide-react';
import { appStore, useAppStore } from '../../../store/useAppStore';
import { highlightColorName } from '../../../utils/highlightColors';
import type { Ink } from '../../../utils/highlighterRules';
import { readInkSelection, type InkSelection } from '../../../utils/inkTargets';
import { useHighlightColorMeanings } from '../../../hooks/useHighlightColorMeanings';
import { useHighlighterInk } from '../../../hooks/useHighlighterInk';
import { cn } from '../../../lib/utils';
import { MenuButton } from '../../ui/MenuButton';
import { CHANGE_MEANINGS_LABEL, highlightColorItems, SECTION_HEADING } from './highlightColorItems';

export interface HighlighterButtonProps {
  /** The look of the bar's buttons, given to each half (and the gear). */
  triggerClassName?: string;
  /** Classes for the wrapper, the row's flex item (`ml-auto`). */
  className?: string;
  /** Where the menu opens (`MenuButton`). */
  placement?: 'below' | 'above' | 'auto';
  /**
   * The gear beside it (default). Study Mode's header leaves it out: it has a gear already, its own settings, which
   * hold the same way to the colours' meanings — two identical gears side by side would lead to two places.
   */
  meaningsGear?: boolean;
  /** The toggle alone: a phone's reading row, whose «⋯» holds the inks. */
  toggleOnly?: boolean;
}

/** The tool's pressed look: the bars' toggles' (`toolbarToggleClass`), over whatever look the bar gives. */
const PRESSED = 'bg-primary-50 text-primary-700 hover:bg-primary-100 dark:bg-primary-900/30 dark:text-primary-300 dark:hover:bg-primary-900/40';

/** Bars holding a highlighter now: when the last leaves the screen nobody is left to see the tool on. */
let mountedButtons = 0;

/**
 * The words selected as a press on a highlighter starts (a press may take the selection away before its click), and the
 * words its menu's ink goes to, read as the menu opens. One gesture at a time, whichever bar it is in.
 */
let selectionAtPress: InkSelection | null = null;
let selectionForMenu: InkSelection | null = null;
const readAtPress = () => { selectionAtPress = readInkSelection(); };
const takeAtPress = () => {
  const selected = selectionAtPress ?? readInkSelection();
  selectionAtPress = null;
  return selected;
};
const keepForMenu = () => { selectionForMenu = takeAtPress(); };
const takeForMenu = () => {
  const selected = selectionForMenu;
  selectionForMenu = null;
  return selected;
};

/**
 * The tool's life (A4): Esc turns it off — unless the key belongs to what has the focus (a field, a menu, a dialog, a
 * popover) or a modal dialog is open — before anything else hears it (Study Mode's Esc, the lesson's); and it goes off
 * when the last bar that holds a highlighter leaves the screen.
 */
function useHighlighterLife(on: boolean, turnOff: () => void) {
  useEffect(() => {
    mountedButtons += 1;
    return () => {
      mountedButtons -= 1;
      // A microtask: the bar mounted again at once (StrictMode, a bar redrawn in the same commit) keeps it on.
      queueMicrotask(() => {
        if (mountedButtons === 0 && appStore.getState().readingTool === 'highlight') appStore.getState().setReadingTool(null);
      });
    };
  }, []);
  useEffect(() => {
    if (!on) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="menu"], [role="dialog"], [role="listbox"], [role="combobox"]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      turnOff();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [on, turnOff]);
}

/** The ink under the highlighter's icon: the colour's tint inside its ink, as the menu's dots; dashed and empty for none. */
function InkBar({ ink }: { ink: Ink }) {
  return (
    <span
      aria-hidden
      className={cn('block h-[5px] w-4 rounded-[2px]', ink === 'none' && 'border border-dashed border-current')}
      style={ink === 'none' ? undefined : { backgroundColor: `hsl(var(--hl-${ink}-bg))`, boxShadow: `inset 0 0 0 1px hsl(var(--hl-${ink}-fg))` }}
    />
  );
}

/**
 * The highlighter (A4, spec `2026-11-03-a4-highlighter-and-notes-design` §1), as a word processor's split button.
 * The left half is the tool: with words selected in a reading text it applies the ink to them at once; with nothing
 * selected it turns the tool on (`aria-pressed`), and every selection then takes the ink as it is released, until it is
 * pressed again or Esc. The right half opens the inks — the four colours with their meanings (the user's own, else the
 * default: a hint, no rule) and «Nessun colore», which takes highlights away —; as in the word processor, a colour chosen
 * applies to the words selected, or turns the tool on with it. Its press keeps the selection: it is read as the press
 * starts. The colour is saved as the colour of new highlights (H1, `settings.highlightColor`); «Nessun colore» and the
 * tool on are the session's. Beside it one gear opens Impostazioni at «Significato dei colori».
 */
export function HighlighterButton({ triggerClassName, className, placement, meaningsGear = true, toggleOnly = false }: HighlighterButtonProps) {
  const ink = useHighlighterInk();
  const on = useAppStore((s) => s.readingTool === 'highlight');
  const setReadingTool = useAppStore((s) => s.setReadingTool);
  const setHighlighterInk = useAppStore((s) => s.setHighlighterInk);
  const openSettings = useAppStore((s) => s.openSettings);
  const meanings = useHighlightColorMeanings();
  const turnOff = useCallback(() => setReadingTool(null), [setReadingTool]);
  useHighlighterLife(on, turnOff);

  const press = () => {
    const selected = takeAtPress();
    if (on) setReadingTool(null);
    else if (selected) selected.apply(ink);
    else setReadingTool('highlight');
  };
  const choose = (next: Ink) => {
    const selected = takeForMenu();
    setHighlighterInk(next);
    if (selected) selected.apply(next);
    else setReadingTool('highlight');
  };

  const inkName = ink === 'none' ? 'nessun colore' : highlightColorName(ink);
  const name = `Evidenziatore (${inkName})`;
  const hint = on
    ? `${name}: acceso. Premi per spegnerlo, o Esc`
    : `${name}: con del testo selezionato ${ink === 'none' ? 'ne toglie l’evidenziazione' : 'lo evidenzia'}; senza, si accende`;
  return (
    <div role="group" aria-label="Evidenziatore" className={cn('flex items-center', className)}>
      <button
        type="button"
        aria-pressed={on}
        aria-label={name}
        title={hint}
        onPointerDown={readAtPress}
        // The selection stays where it is: the button never takes it (nor the focus) from the text.
        onMouseDown={(event) => event.preventDefault()}
        // As the menu's clicks, it never reaches the card it sits in (a dossier's row).
        onClick={(event) => { event.stopPropagation(); press(); }}
        // 44 px wide on a phone whatever the bar's padding; a bar that keeps 44 px at every width says so in its classes.
        className={cn(
          'inline-flex min-w-[44px] items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-w-0',
          triggerClassName,
          on && PRESSED,
        )}
      >
        <span className="flex flex-col items-center gap-[3px]">
          <Highlighter size={16} aria-hidden />
          <InkBar ink={ink} />
        </span>
      </button>
      {!toggleOnly && (
        <div
          className="contents"
          onPointerDownCapture={(event: ReactPointerEvent) => {
            if ((event.target as Element | null)?.closest('[aria-haspopup="menu"]')) readAtPress();
          }}
        >
          <MenuButton
            label="Colore dell’evidenziatore"
            heading={SECTION_HEADING}
            items={highlightColorItems(ink, meanings, choose)}
            triggerClassName={cn('min-w-[44px] md:min-w-0', triggerClassName, 'px-1')}
            placement={placement}
            menuClassName="w-64"
            onOpen={keepForMenu}
          >
            <ChevronDown size={14} aria-hidden />
          </MenuButton>
        </div>
      )}
      {/* The trigger's own look, as an icon: 44 px wide on a phone whatever the trigger's padding. */}
      {meaningsGear && !toggleOnly && (
        <button
          type="button"
          // As the menu's clicks, it never reaches the card it sits in (a dossier's row).
          onClick={(event) => { event.stopPropagation(); openSettings('highlightColors'); }}
          aria-label={CHANGE_MEANINGS_LABEL}
          title={CHANGE_MEANINGS_LABEL}
          className={cn(
            'inline-flex min-w-[44px] items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-w-0',
            triggerClassName,
          )}
        >
          <Settings size={16} aria-hidden />
        </button>
      )}
    </div>
  );
}
