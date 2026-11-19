/**
 * Runs `run` once the page is idle (`requestIdleCallback`, within 2 s), or after a second where the browser has none
 * (Safari). Returns the way to cancel it, for an effect's cleanup.
 * shortcut: without `requestIdleCallback` a fixed second stands in for idle (200 ms ran during a cold boot's loading,
 * LC135); upgrade if Safari ships it or a page is measured busy past a second.
 */
export function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 1000);
  return () => window.clearTimeout(id);
}
