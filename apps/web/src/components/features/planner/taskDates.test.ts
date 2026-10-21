import { describe, expect, it } from 'vitest';
import { countdown, dayHeading, daysBetween, dayTone, groupUpcoming, rowDay, shortDay, splitToday, todayCountLabel } from './taskDates';
import { nestTasks } from './taskTree';
import type { Task } from '../../../types/tasks';

const TODAY = '2026-10-20';

function task(id: string, fields: Partial<Task> = {}): Task {
  return {
    id, title: `Compito ${id}`, description: null, priority: 4, labels: [], position: 0, parentId: null,
    dossierId: null, dossierItemId: null, plannedDate: null, plannedTime: null, dueDate: null, dueTime: null,
    recurrence: null, recurrenceFrom: 'pianificata', origin: 'lavoro', completedAt: null, deletedAt: null,
    createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z', ...fields,
  };
}

describe('the deadline countdown', () => {
  it.each([
    ['2026-10-18', 'scaduto da 2 giorni', 'overdue'],
    ['2026-10-19', 'scaduto da 1 giorno', 'overdue'],
    ['2026-10-20', 'scade oggi', 'today'],
    ['2026-10-21', 'manca 1 giorno', 'soon'],
    ['2026-10-23', 'mancano 3 giorni', 'soon'],
    ['2026-10-24', 'mancano 4 giorni', 'later'],
  ])('%s from 20 October is «%s»', (due, text, tone) => {
    expect(countdown(due, TODAY)).toEqual({ text, tone });
  });

  it('counts civil days across a clock change and a year', () => {
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(countdown('2027-01-02', '2026-12-30').text).toBe('mancano 3 giorni');
  });

  it('never says the deadline was computed', () => {
    for (const day of ['2026-10-01', TODAY, '2026-12-01']) expect(countdown(day, TODAY).text).not.toMatch(/calcol/i);
  });
});

describe('days in words', () => {
  it('names the near days and writes the others short, in Italian', () => {
    expect(shortDay(TODAY, TODAY)).toBe('Oggi');
    expect(shortDay('2026-10-21', TODAY)).toBe('Domani');
    expect(shortDay('2026-10-19', TODAY)).toBe('Ieri');
    expect(shortDay('2026-10-23', TODAY)).toBe('ven 23 ott');
    expect(shortDay('2027-01-05', TODAY)).toBe('5 gen 2027');
  });

  it('heads the coming days', () => {
    expect(dayHeading(TODAY, TODAY)).toBe('Oggi · martedì 20 ottobre');
    expect(dayHeading('2026-10-21', TODAY)).toBe('Domani · mercoledì 21 ottobre');
    expect(dayHeading('2026-10-22', TODAY)).toBe('Giovedì 22 ottobre');
  });

  it("writes a row's planned day, a late one with how late in words", () => {
    expect(rowDay('2026-10-18', TODAY)).toBe('dom 18 ott · in ritardo di 2 giorni');
    expect(rowDay('2026-10-19', TODAY)).toBe('Ieri · in ritardo di 1 giorno');
    expect(rowDay(TODAY, TODAY)).toBe('Oggi');
    expect(rowDay('2026-10-21', TODAY)).toBe('Domani');
    expect(rowDay('2026-10-23', TODAY)).toBe('venerdì');
    expect(rowDay('2026-10-27', TODAY)).toBe('mar 27 ott');
    expect(['2026-10-19', TODAY, '2026-10-21', '2026-10-26', '2026-10-27'].map((day) => dayTone(day, TODAY))).toEqual(['late', 'today', 'tomorrow', 'week', 'later']);
  });

  it('counts the bar in words', () => {
    expect(todayCountLabel(1)).toBe('1 compito per oggi o scaduto');
    expect(todayCountLabel(4)).toBe('4 compiti per oggi o scaduti');
  });
});

describe('«Oggi» and «Prossimi giorni»', () => {
  it('puts the missed deadlines first, then the tasks late on their planned day, then today\'s', () => {
    const late = task('a', { plannedDate: '2026-10-19' });
    const lateBeforeItsDeadline = task('e', { plannedDate: '2026-10-19', dueDate: '2026-10-23' });
    const lateWithDeadlineToday = task('f', { plannedDate: '2026-10-18', dueDate: TODAY });
    const missed = task('b', { plannedDate: TODAY, dueDate: '2026-10-18' });
    // A past deadline is always in the first group, whatever the planned date.
    const missedAndLate = task('g', { plannedDate: '2026-10-15', dueDate: '2026-10-19' });
    const now = task('c', { plannedDate: TODAY });
    const due = task('d', { dueDate: TODAY });
    expect(splitToday([now, late, due, missed, lateBeforeItsDeadline, missedAndLate, lateWithDeadlineToday], TODAY)).toEqual({
      missedDeadline: [missed, missedAndLate],
      late: [late, lateBeforeItsDeadline, lateWithDeadlineToday],
      today: [now, due],
    });
  });

  it('files a task once, under its planned date in the seven days, else its deadline', () => {
    const planned = task('a', { plannedDate: '2026-10-22', dueDate: '2026-10-24' });
    const dueOnly = task('b', { dueDate: '2026-10-24' });
    const plannedLate = task('c', { plannedDate: '2026-10-15', dueDate: '2026-10-21' });
    const outside = task('d', { plannedDate: '2026-10-27' });
    expect(groupUpcoming([planned, dueOnly, plannedLate, outside], TODAY)).toEqual([
      { day: '2026-10-21', tasks: [plannedLate] },
      { day: '2026-10-22', tasks: [planned] },
      { day: '2026-10-24', tasks: [dueOnly] },
    ]);
  });
});

describe('subtasks, one level', () => {
  it('nests a subtask under its parent when both are listed, keeping the order', () => {
    const parent = task('p');
    const other = task('o');
    const child = task('c', { parentId: 'p' });
    const grandchild = task('g', { parentId: 'c' });
    const orphan = task('x', { parentId: 'missing' });
    const nodes = nestTasks([parent, other, child, orphan, grandchild]);
    expect(nodes.map((n) => [n.task.id, n.children.map((c) => c.id)])).toEqual([
      ['p', ['c', 'g']],
      ['o', []],
      ['x', []],
    ]);
  });

  it('survives a loop in the data', () => {
    const a = task('a', { parentId: 'b' });
    const b = task('b', { parentId: 'a' });
    expect(nestTasks([a, b]).length).toBeGreaterThan(0);
  });
});
