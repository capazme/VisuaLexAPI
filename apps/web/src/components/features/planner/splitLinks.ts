/** An address in a description: http or https only, up to the next space, a final stop or bracket left out. */
const URL_PATTERN = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]}'»]/g;

/** Splits a description into text and links, as plain strings: nothing is rendered as HTML. */
export function splitLinks(text: string): { text: string; href?: string }[] {
  const parts: { text: string; href?: string }[] = [];
  let at = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    if (start > at) parts.push({ text: text.slice(at, start) });
    parts.push({ text: match[0], href: match[0] });
    at = start + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}
