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

/**
 * Before a row leaves (ticked, moved to the trash), the focus goes to the next row's tick, else the previous one's,
 * else the view's heading: left where it was it would fall to the page's body, and the arrows and Space would stop.
 * Only when the focus is in that row (or nowhere): a click elsewhere keeps its own.
 */
export function focusAwayFrom(taskId: string) {
  const row = [...document.querySelectorAll<HTMLElement>('[data-task-row]')].find((el) => el.dataset.taskId === taskId);
  if (!row) return;
  const active = document.activeElement;
  if (active && active !== document.body && !row.contains(active)) return;
  const scope = row.closest('[data-task-lists]') ?? row.closest('ul') ?? document.body;
  const ticks = [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((tick) => !row.contains(tick));
  const after = ticks.find((tick) => row.compareDocumentPosition(tick) & Node.DOCUMENT_POSITION_FOLLOWING);
  let target: HTMLElement | null = after ?? ticks[ticks.length - 1] ?? null;
  // The nearest heading marked for it, outside the lists: the view's, the dossier panel's.
  for (let el = row.parentElement; !target && el; el = el.parentElement) target = el.querySelector<HTMLElement>('[data-focus-fallback]');
  target?.focus();
}
