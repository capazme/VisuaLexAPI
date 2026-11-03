import { Circle, Eraser, Settings } from 'lucide-react';
import type { MenuItem } from '../../ui/MenuButton';
import { HIGHLIGHT_COLORS, highlightColorName, type HighlightColor } from '../../../utils/highlightColors';
import type { Ink } from '../../../utils/highlighterRules';

/** Each colour's own dot in a menu: its highlight's background, its ink around it. */
const DOT: Record<HighlightColor, string> = {
  yellow: 'fill-[hsl(var(--hl-yellow-bg))] text-[hsl(var(--hl-yellow-fg))]',
  green: 'fill-[hsl(var(--hl-green-bg))] text-[hsl(var(--hl-green-fg))]',
  red: 'fill-[hsl(var(--hl-red-bg))] text-[hsl(var(--hl-red-fg))]',
  blue: 'fill-[hsl(var(--hl-blue-bg))] text-[hsl(var(--hl-blue-fg))]',
};

/** The title over the four: their own menu's, and in a menu of actions. Each colour's meaning is a suggestion. */
export const SECTION_HEADING = 'Colore dell’evidenziatore — uso suggerito';

/** «Nessun colore» (A4): the highlighter's ink that takes highlights away. */
export const NO_COLOUR_LABEL = 'Nessun colore';

/** The way to Impostazioni › «Significato dei colori»: the gear's name and title, and the phone's menu entry. */
export const CHANGE_MEANINGS_LABEL = 'Cambia il significato dei colori';

const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** A meaning inside a sentence: its first letter lowered, unless it opens an acronym («GDPR», «IVA») the user wrote. */
const inSentence = (s: string) => (/^\p{Lu}\p{Lu}/u.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));

/**
 * The highlighter's inks as a menu's choices (H1, A4): the one chosen ticked (`menuitemradio`), each colour with what
 * it is suggested for under it (`meanings`, the user's own or the default: a hint, any colour is free for anything),
 * named «Giallo, uso suggerito: punto centrale», then «Nessun colore», which takes highlights away. `section`, for a
 * menu that holds actions too (a phone's «⋯»): a separator and a title over them, so they read as a setting and not as
 * «highlight now», and each one's name says what it sets. `onChangeMeanings` adds, after them, the entry that opens
 * Impostazioni where the meanings are changed — the phone's form of the gear beside the highlighter.
 */
export function highlightColorItems(
  current: Ink,
  meanings: Record<HighlightColor, string>,
  choose: (ink: Ink) => void,
  { section = false, onChangeMeanings }: { section?: boolean; onChangeMeanings?: () => void } = {},
): MenuItem[] {
  const colours: MenuItem[] = HIGHLIGHT_COLORS.map((color, i) => {
    const name = highlightColorName(color);
    const meaning = inSentence(meanings[color]);
    return {
      label: capitalised(name),
      ariaLabel: section ? `Evidenziatore in ${name}, uso suggerito: ${meaning}` : `${capitalised(name)}, uso suggerito: ${meaning}`,
      description: meanings[color],
      icon: Circle,
      iconClassName: DOT[color],
      checked: color === current,
      separatorBefore: section && i === 0,
      sectionHeading: section && i === 0 ? SECTION_HEADING : undefined,
      onSelect: () => choose(color),
    };
  });
  const none: MenuItem = {
    label: NO_COLOUR_LABEL,
    ariaLabel: section ? 'Evidenziatore senza colore: toglie le evidenziazioni' : 'Nessun colore: toglie le evidenziazioni',
    description: 'Toglie le evidenziazioni',
    icon: Eraser,
    checked: current === 'none',
    separatorBefore: true,
    onSelect: () => choose('none'),
  };
  const inks = [...colours, none];
  return onChangeMeanings ? [...inks, { label: CHANGE_MEANINGS_LABEL, icon: Settings, onSelect: onChangeMeanings }] : inks;
}
