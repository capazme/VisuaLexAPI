/**
 * The words of the gloss the reader is on (D8: a card hovered or focused), painted with the CSS Custom Highlight API
 * (`::highlight(vlx-gloss)`, index.css): no element is added to the text and none of its nodes changes (root rule 23).
 * One passage on the page at a time — the last reader to show one owns it, and only its owner clears it. Where the
 * API is missing every call is a no-op, as for «Cerca nel testo» (`findHighlights.ts`).
 */

const NAME = 'vlx-gloss';
let owner: string | null = null;

const supported = () => typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight !== 'undefined';

export function showGlossPassage(ownerId: string, range: Range | null): void {
  if (!supported()) return;
  if (!range) {
    clearGlossPassage(ownerId);
    return;
  }
  owner = ownerId;
  CSS.highlights.set(NAME, new Highlight(range));
}

export function clearGlossPassage(ownerId: string): void {
  if (!supported() || owner !== ownerId) return;
  owner = null;
  CSS.highlights.delete(NAME);
}
