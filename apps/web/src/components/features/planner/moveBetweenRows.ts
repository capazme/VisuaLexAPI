import type { KeyboardEvent } from 'react';

const FOCUSABLE = '[data-task-focus]';

/**
 * Moves between the rows with the arrows, Home and End, from anywhere in a row (its tick, its title, its «⋯»), to
 * the next row's tick; the rows of every list on the page are one sequence. Not while a menu is open or a field
 * has the keys.
 */
export function moveBetweenRows(event: KeyboardEvent<HTMLElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.defaultPrevented) return;
  const target = event.target as HTMLElement;
  if (target.closest('[role="menu"]') || ['TEXTAREA', 'SELECT'].includes(target.tagName)) return;
  if (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'checkbox') return;
  const row = target.closest('[data-task-row]');
  if (!row) return;
  const scope = target.closest('[data-task-lists]') ?? event.currentTarget;
  const ticks = [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const current = ticks.indexOf(row.querySelector<HTMLElement>(FOCUSABLE)!);
  const next =
    event.key === 'Home' ? 0 : event.key === 'End' ? ticks.length - 1 : event.key === 'ArrowDown' ? Math.min(current + 1, ticks.length - 1) : Math.max(current - 1, 0);
  event.preventDefault();
  ticks[next]?.focus();
}

const rowOf = (taskId: string) =>
  [...document.querySelectorAll<HTMLElement>('[data-task-row]')].find((el) => el.dataset.taskId === taskId) ?? null;

/** Where the focus goes when `row` leaves: the next row's tick, else the previous one's, else the view's heading. */
function neighbourOf(row: HTMLElement): HTMLElement | null {
  const scope = row.closest('[data-task-lists]') ?? row.closest('ul') ?? document.body;
  const ticks = [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((tick) => !row.contains(tick));
  const after = ticks.find((tick) => row.compareDocumentPosition(tick) & Node.DOCUMENT_POSITION_FOLLOWING);
  return after ?? ticks[ticks.length - 1] ?? null;
}

/** The nearest heading marked for it, outside the lists: the view's, the dossier panel's. */
function fallbackOf(row: HTMLElement): HTMLElement | null {
  for (let el = row.parentElement; el; el = el.parentElement) {
    const heading = el.querySelector<HTMLElement>('[data-focus-fallback]');
    if (heading) return heading;
  }
  return null;
}

/**
 * Before a row leaves (ticked, moved to the trash), the focus goes to the next row's tick, else the previous one's,
 * else the view's heading: left where it was it would fall to the page's body, and the arrows and Space would stop.
 * Only when the focus is in that row (or nowhere): a click elsewhere keeps its own.
 */
export function focusAwayFrom(taskId: string) {
  const row = rowOf(taskId);
  if (!row) return;
  const active = document.activeElement;
  if (active && active !== document.body && !row.contains(active)) return;
  (neighbourOf(row) ?? fallbackOf(row))?.focus();
}

/**
 * After the task's dialog closes, its row may leave later — moved to the trash from the dialog, or saved out of the
 * view (another day, another dossier) and gone at the next read — and the focus the dialog gave back to it with it.
 * Watches for a few seconds: when no row of the task is left and the focus has fallen to the body, it goes to the
 * neighbour the row had when the dialog closed (or the heading). A row that moved to another list of the page is
 * still a row: nothing moves.
 */
export function focusWhenRowLeaves(taskId: string, waitMs = 5000) {
  const row = rowOf(taskId);
  if (!row) return;
  const neighbour = neighbourOf(row);
  const fallback = fallbackOf(row);
  const observer = new MutationObserver(() => {
    if (rowOf(taskId)) return;
    stop();
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    (neighbour?.isConnected ? neighbour : fallback?.isConnected ? fallback : null)?.focus();
  });
  const timer = setTimeout(() => stop(), waitMs);
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
  };
  observer.observe(document.body, { childList: true, subtree: true });
}
