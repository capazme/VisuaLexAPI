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
