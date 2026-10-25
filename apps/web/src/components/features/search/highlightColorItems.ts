import { Circle } from 'lucide-react';
import type { MenuItem } from '../../ui/MenuButton';
import { HIGHLIGHT_COLORS, HIGHLIGHT_COLOR_MEANINGS, highlightColorName, type HighlightColor } from '../../../utils/highlightColors';

/** Each colour's own dot in a menu: its highlight's background, its ink around it. */
const DOT: Record<HighlightColor, string> = {
  yellow: 'fill-[hsl(var(--hl-yellow-bg))] text-[hsl(var(--hl-yellow-fg))]',
  green: 'fill-[hsl(var(--hl-green-bg))] text-[hsl(var(--hl-green-fg))]',
  red: 'fill-[hsl(var(--hl-red-bg))] text-[hsl(var(--hl-red-fg))]',
  blue: 'fill-[hsl(var(--hl-blue-bg))] text-[hsl(var(--hl-blue-fg))]',
};

/** The title over the four in a menu of actions. */
export const SECTION_HEADING = 'Colore delle nuove evidenziazioni';

const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The four colours as a menu's choices (H1): the one chosen ticked (`menuitemradio`), each with what it is suggested
 * for under it (`HIGHLIGHT_COLOR_MEANINGS`, a hint: any colour is free for anything), and named «Giallo, punto
 * centrale». `section`, for a menu that holds actions too (a phone's «⋯»): a separator and a title over the four, so
 * they read as a setting and not as «highlight now», and each one's name says what it sets.
 */
export function highlightColorItems(
  current: HighlightColor,
  choose: (color: HighlightColor) => void,
  { section = false }: { section?: boolean } = {},
): MenuItem[] {
  return HIGHLIGHT_COLORS.map((color, i) => {
    const name = highlightColorName(color);
    const meaning = HIGHLIGHT_COLOR_MEANINGS[color].toLowerCase();
    return {
      label: capitalised(name),
      ariaLabel: section ? `Nuove evidenziazioni in ${name}, ${meaning}` : `${capitalised(name)}, ${meaning}`,
      description: HIGHLIGHT_COLOR_MEANINGS[color],
      icon: Circle,
      iconClassName: DOT[color],
      checked: color === current,
      separatorBefore: section && i === 0,
      sectionHeading: section && i === 0 ? SECTION_HEADING : undefined,
      onSelect: () => choose(color),
    };
  });
}
