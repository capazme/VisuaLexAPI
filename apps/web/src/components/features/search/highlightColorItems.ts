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

export const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The four colours as a menu's choices (H1): the one chosen ticked (`menuitemradio`), each with what it is suggested
 * for under it (`HIGHLIGHT_COLOR_MEANINGS`, a hint: any colour is free for anything). `separatorBefore` on the first,
 * for a menu that holds other actions (a phone's «⋯»).
 */
export function highlightColorItems(
  current: HighlightColor,
  choose: (color: HighlightColor) => void,
  { separatorBefore = false, prefix = '' }: { separatorBefore?: boolean; prefix?: string } = {},
): MenuItem[] {
  return HIGHLIGHT_COLORS.map((color, i) => ({
    label: `${prefix}${prefix ? highlightColorName(color) : capitalised(highlightColorName(color))}`,
    description: HIGHLIGHT_COLOR_MEANINGS[color],
    icon: Circle,
    iconClassName: DOT[color],
    checked: color === current,
    separatorBefore: separatorBefore && i === 0,
    onSelect: () => choose(color),
  }));
}
