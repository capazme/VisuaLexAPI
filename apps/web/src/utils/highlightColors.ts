import type { CSSProperties } from 'react';

export type HighlightColor = 'yellow' | 'green' | 'red' | 'blue';

export const HIGHLIGHT_COLORS: readonly HighlightColor[] = ['yellow', 'green', 'red', 'blue'] as const;

/** A colour as the reader is told it («Testo evidenziato in giallo»); an unknown value is shown as is. */
const HIGHLIGHT_COLOR_NAMES: Record<HighlightColor, string> = { yellow: 'giallo', green: 'verde', red: 'rosso', blue: 'blu' };

export function highlightColorName(color: string): string {
  return (HIGHLIGHT_COLOR_NAMES as Record<string, string>)[color] ?? color;
}

/**
 * What each colour is suggested for (D7b): the reader's convention, offered as a hint in the colour picker, never a
 * rule. The same meanings the MCP tool gives an application; red stands for «Da rivedere», the mark of review, and an
 * application never proposes in red.
 */
export const HIGHLIGHT_COLOR_MEANINGS: Record<HighlightColor, string> = {
  yellow: 'Punto centrale',
  green: 'Condizione o presupposto',
  blue: 'Definizione o eccezione',
  red: 'Da rivedere',
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
