export interface AnnotationTarget {
  kind: 'note' | 'highlight' | 'thread';
  id: string;
}

const FLASH_MS = 1600;

/** An attribute value, safe inside a double-quoted selector. */
const quoted = (value: string): string => `"${value.replace(/["\\]/g, '\\$&')}"`;

/**
 * Takes the reader to an annotation in the article text: scrolls it to the
 * middle of the view and lets it glow for 1.6 s (`.vlx-flash`, index.css).
 * Every piece of the mark glows — a highlight across two commi is two
 * elements, one saved before offsets existed is one per occurrence — and the
 * scroll goes to the first piece inside `near` (the block the reader came
 * from) when there is one. False when the annotation is not in the text.
 */
export function revealAnnotation(root: ParentNode, target: AnnotationTarget, near?: Element | null): boolean {
  const attribute =
    target.kind === 'note'
      ? 'data-note-id'
      : target.kind === 'thread'
        ? 'data-thread-focus'
        : 'data-highlight';
  const pieces = [...root.querySelectorAll<HTMLElement>(`[${attribute}=${quoted(target.id)}]`)];
  if (pieces.length === 0) return false;
  const first = (near && pieces.find((piece) => near.contains(piece))) || pieces[0];
  first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  for (const piece of pieces) piece.classList.add('vlx-flash');
  window.setTimeout(() => {
    for (const piece of pieces) piece.classList.remove('vlx-flash');
  }, FLASH_MS);
  return true;
}
