/**
 * Runs `run` once the page is idle (`requestIdleCallback`, within 2 s), or after 200 ms where the browser has none
 * (Safari, jsdom). Returns the way to cancel it, for an effect's cleanup.
 */
export function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 200);
  return () => window.clearTimeout(id);
}
