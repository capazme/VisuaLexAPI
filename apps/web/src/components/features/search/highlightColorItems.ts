import { Circle, Settings } from 'lucide-react';
import type { MenuItem } from '../../ui/MenuButton';
import { HIGHLIGHT_COLORS, highlightColorName, type HighlightColor } from '../../../utils/highlightColors';

/** Each colour's own dot in a menu: its highlight's background, its ink around it. */
const DOT: Record<HighlightColor, string> = {
  yellow: 'fill-[hsl(var(--hl-yellow-bg))] text-[hsl(var(--hl-yellow-fg))]',
  green: 'fill-[hsl(var(--hl-green-bg))] text-[hsl(var(--hl-green-fg))]',
  red: 'fill-[hsl(var(--hl-red-bg))] text-[hsl(var(--hl-red-fg))]',
  blue: 'fill-[hsl(var(--hl-blue-bg))] text-[hsl(var(--hl-blue-fg))]',
};

/** The title over the four: their own menu's, and in a menu of actions. Each colour's meaning is a suggestion. */
export const SECTION_HEADING = 'Colore delle nuove evidenziazioni — uso suggerito';

/** The way to Impostazioni › «Significato dei colori» (D8 §3): the gear's name and title, and the phone's menu entry. */
export const CHANGE_MEANINGS_LABEL = 'Cambia il significato dei colori';

const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** A meaning inside a sentence: its first letter lowered, unless it opens an acronym («GDPR», «IVA») the user wrote. */
const inSentence = (s: string) => (/^\p{Lu}\p{Lu}/u.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));

/**
 * The four colours as a menu's choices (H1): the one chosen ticked (`menuitemradio`), each with what it is suggested
 * for under it (`meanings`, the user's own or the default: a hint, any colour is free for anything), and named
 * «Giallo, uso suggerito: punto centrale». `section`, for a menu that holds actions too (a phone's «⋯»): a separator
 * and a title over the four, so they read as a setting and not as «highlight now», and each one's name says what it
 * sets. `onChangeMeanings` adds, after the four, the entry that opens Impostazioni where the meanings are changed —
 * the phone's form of the gear beside the colour.
 */
export function highlightColorItems(
  current: HighlightColor,
  meanings: Record<HighlightColor, string>,
  choose: (color: HighlightColor) => void,
  { section = false, onChangeMeanings }: { section?: boolean; onChangeMeanings?: () => void } = {},
): MenuItem[] {
  const colours: MenuItem[] = HIGHLIGHT_COLORS.map((color, i) => {
    const name = highlightColorName(color);
    const meaning = inSentence(meanings[color]);
    return {
      label: capitalised(name),
      ariaLabel: section ? `Nuove evidenziazioni in ${name}, uso suggerito: ${meaning}` : `${capitalised(name)}, uso suggerito: ${meaning}`,
      description: meanings[color],
      icon: Circle,
      iconClassName: DOT[color],
      checked: color === current,
      separatorBefore: section && i === 0,
      sectionHeading: section && i === 0 ? SECTION_HEADING : undefined,
      onSelect: () => choose(color),
    };
  });
  return onChangeMeanings ? [...colours, { label: CHANGE_MEANINGS_LABEL, icon: Settings, onSelect: onChangeMeanings }] : colours;
}
