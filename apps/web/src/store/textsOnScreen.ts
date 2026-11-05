/**
 * The texts on screen now, by the key their highlights are stored under (A4): a gesture on a highlight is undone by the
 * shortcut only while its text is drawn, so the key never changes words nobody sees. A reader counts its text while it
 * is mounted (`useHighlightInk`), a list of anchors whose words no longer land (`DecisionAnchorsWithoutText`) its own.
 */
const shown = new Map<string, number>();

/** Counts `key` as on screen until the returned function is called. */
export function showText(key: string): () => void {
  shown.set(key, (shown.get(key) ?? 0) + 1);
  return () => {
    const left = (shown.get(key) ?? 1) - 1;
    if (left > 0) shown.set(key, left);
    else shown.delete(key);
  };
}

export function isTextShown(key: string): boolean {
  return shown.has(key);
}
