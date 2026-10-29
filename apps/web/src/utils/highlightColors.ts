import type { CSSProperties } from 'react';

export type HighlightColor = 'yellow' | 'green' | 'red' | 'blue';

export const HIGHLIGHT_COLORS: readonly HighlightColor[] = ['yellow', 'green', 'red', 'blue'] as const;

/** A colour as the reader is told it («Testo evidenziato in giallo»); an unknown value is shown as is. */
const HIGHLIGHT_COLOR_NAMES: Record<HighlightColor, string> = { yellow: 'giallo', green: 'verde', red: 'rosso', blue: 'blu' };

/** A colour this app knows: what a saved setting is checked against, since storage may hold anything. */
export function isHighlightColor(color: unknown): color is HighlightColor {
  return (HIGHLIGHT_COLORS as readonly unknown[]).includes(color);
}

export function highlightColorName(color: string): string {
  return (HIGHLIGHT_COLOR_NAMES as Record<string, string>)[color] ?? color;
}

/**
 * What each colour is suggested for (D7b): the reader's convention, offered as a hint in the menu where the colour of
 * new highlights is chosen (H1), never a rule. The same meanings the MCP tool gives an application; red stands for
 * «Da rivedere», the mark of review, and an application never proposes in red. The default: each user may give a
 * colour a meaning of their own (`settings.highlightColorMeanings`), which only this device knows.
 */
export const HIGHLIGHT_COLOR_MEANINGS: Record<HighlightColor, string> = {
  yellow: 'Punto centrale',
  green: 'Condizione o presupposto',
  blue: 'Definizione o eccezione',
  red: 'Da rivedere',
};

/** The longest meaning a user may give a colour, in characters: it is read on one line of a menu. */
export const HIGHLIGHT_MEANING_MAX = 40;

/** A meaning as it is kept: trimmed, 1 to `HIGHLIGHT_MEANING_MAX` characters; anything else is no meaning (null). */
export function normalizeHighlightMeaning(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const meaning = value.trim();
  const length = Array.from(meaning).length;
  return length >= 1 && length <= HIGHLIGHT_MEANING_MAX ? meaning : null;
}

/**
 * The meanings a user gave, as a save is read back (storage may hold anything): only a known colour with a valid
 * meaning that differs from its default is kept, so a colour never changed follows the default if it ever moves.
 */
export function sanitizeHighlightMeanings(value: unknown): Partial<Record<HighlightColor, string>> {
  const kept: Partial<Record<HighlightColor, string>> = {};
  if (!value || typeof value !== 'object') return kept;
  for (const color of HIGHLIGHT_COLORS) {
    const meaning = normalizeHighlightMeaning((value as Record<string, unknown>)[color]);
    if (meaning && meaning !== HIGHLIGHT_COLOR_MEANINGS[color]) kept[color] = meaning;
  }
  return kept;
}

/** Each colour's meaning for this user: their own where they gave one, the default elsewhere. */
export function resolveHighlightMeanings(own: Partial<Record<HighlightColor, string>> | undefined): Record<HighlightColor, string> {
  const valid = sanitizeHighlightMeanings(own);
  return { ...HIGHLIGHT_COLOR_MEANINGS, ...valid };
}

/**
 * Each colour as an icon on the selection popup's dark surface (`slate-900`/`slate-800` in both themes): bright
 * enough to keep 3:1, and never the highlight's background, which is a dark tint in the dark theme and transparent
 * while highlights are hidden (`.highlights-hidden`).
 */
export const HIGHLIGHT_ICON_ON_DARK: Record<HighlightColor, string> = {
  yellow: 'text-yellow-300',
  green: 'text-green-300',
  red: 'text-red-300',
  blue: 'text-blue-300',
};

/**
 * CSS declaration strings ready to inject into `style="..."` attributes
 * when generating HTML from backend/parser output.
 *
 * Resolves against CSS custom properties defined in index.css, so light/dark
 * theme switching and contrast tuning happen in one place.
 */
export const HIGHLIGHT_STYLES: Record<HighlightColor, string> = {
  yellow: 'background-color:hsl(var(--hl-yellow-bg));color:hsl(var(--hl-yellow-fg));',
  green: 'background-color:hsl(var(--hl-green-bg));color:hsl(var(--hl-green-fg));',
  red: 'background-color:hsl(var(--hl-red-bg));color:hsl(var(--hl-red-fg));',
  blue: 'background-color:hsl(var(--hl-blue-bg));color:hsl(var(--hl-blue-fg));',
};

/**
 * Returns the background color string for a highlight — suitable for React `style` props.
 * Used for swatch indicators (small colored squares next to highlight list items).
 */
export function getHighlightSwatch(color: string): string {
  const safe = (HIGHLIGHT_COLORS as readonly string[]).includes(color)
    ? (color as HighlightColor)
    : 'yellow';
  return `hsl(var(--hl-${safe}-bg))`;
}

/**
 * Parse an inline CSS declaration string (e.g. "background-color:red;color:white;")
 * into a React-compatible CSSProperties object. Property names are converted to camelCase.
 */
export function parseInlineStyle(style: string): CSSProperties {
  const entries = style
    .split(';')
    .filter(Boolean)
    .map(rule => {
      const [prop, value] = rule.split(':');
      const camelProp = prop.trim().replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      return [camelProp, value.trim()];
    });
  return Object.fromEntries(entries) as CSSProperties;
}
