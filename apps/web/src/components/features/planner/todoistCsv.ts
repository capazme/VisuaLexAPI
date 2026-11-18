import type { TaskInput, TaskPriority } from '../../../types/tasks';
import { isRepetitionPhrase, parseDatePhrase, type DatePhrase } from './datePhrase';

/**
 * Todoist's CSV export read into tasks, all in the browser (LC80): the file never leaves it, only the tasks go to
 * the server, as if the user wrote them. Rows: `meta` is skipped, `section` becomes a label with its name, `task`
 * is a task; subtasks come from `INDENT` and the order of the rows. `DATE` and `DEADLINE` are phrases, read by
 * `datePhrase.ts`; a phrase not understood is kept in the description. Assignee, reminders, duration and author are
 * not imported.
 */

/** The server's caps (`apps/server/src/routes/tasks.ts`): a row over them is cut here, not refused there. */
const MAX_TITLE = 500;
const MAX_DESCRIPTION = 10_000;
const MAX_LABEL = 50;
const ROME = 'Europe/Rome';

/** RFC 4180: quoted fields with commas, doubled quotes and line breaks inside; a BOM, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else if (c === '\r' && source[i + 1] === '\n') {
        field += '\n';
        i++;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface ImportTask {
  /** The row's place in the file: the key that keeps a retry from creating it twice. */
  row: number;
  /** The row of its parent task, for a subtask. */
  parentRow: number | null;
  input: TaskInput & { title: string };
}

export interface ImportNote {
  title: string;
  phrase: string;
  /** Why it does not repeat, when the phrase itself was understood. */
  why?: string;
}

export interface ImportPlan {
  tasks: ImportTask[];
  subtasks: number;
  /** The sections' names, as labels. */
  labels: string[];
  /** Dates and deadlines not understood: kept in the description. */
  unreadDates: ImportNote[];
  /** Repetitions outside the five rules (or beside a deadline): the task does not repeat, the phrase is in the description. */
  nonRecurring: ImportNote[];
  /** Titles or descriptions cut to the server's length. */
  trimmed: number;
}

export class NotTodoistCsvError extends Error {
  constructor() {
    super('Il file non sembra un CSV esportato da Todoist: mancano le colonne TYPE e CONTENT.');
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A day and time in `zone` as Rome's; a zone the browser does not know is taken as Rome. */
export function toRome(date: string, time: string, zone: string): { date: string; time: string } {
  if (!zone || zone === ROME) return { date, time };
  try {
    const wall = (instant: number, timeZone: string) => {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
          .formatToParts(instant)
          .map((p) => [p.type, p.value]),
      );
      return { y: +parts.year, m: +parts.month, d: +parts.day, h: +parts.hour, min: +parts.minute };
    };
    const offset = (instant: number) => {
      const w = wall(instant, zone);
      return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min) - instant;
    };
    const [y, m, d] = date.split('-').map(Number);
    const [h, min] = time.split(':').map(Number);
    const asUtc = Date.UTC(y, m - 1, d, h, min);
    // Twice: the offset at the guessed instant, then at the corrected one (a change of summer time in between).
    const instant = asUtc - offset(asUtc - offset(asUtc));
    const r = wall(instant, ROME);
    return { date: `${r.y}-${pad(r.m)}-${pad(r.d)}`, time: `${pad(r.h)}:${pad(r.min)}` };
  } catch {
    return { date, time };
  }
}

/** An ISO day («2026-11-20», «2026-11-20T10:00»), else a phrase in Italian or English. */
function readWhen(phrase: string, today: string): DatePhrase | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(phrase);
  if (iso) {
    const [, y, m, d, h, min] = iso;
    const check = new Date(Date.UTC(+y, +m - 1, +d));
    if (check.getUTCMonth() !== +m - 1 || check.getUTCDate() !== +d) return null;
    const time = h !== undefined && +h < 24 && +min < 60 ? `${h}:${min}` : null;
    return { date: `${y}-${m}-${d}`, time, recurrence: null, recurrenceFrom: 'pianificata' };
  }
  return parseDatePhrase(phrase, today);
}

const clean = (text: string) => text.replace(/\0/g, '');
/** The first `max` UTF-16 units, without half an emoji at the end (the server would refuse it every time). */
const cut = (text: string, max: number) => text.slice(0, max).replace(/[\uD800-\uDBFF]$/, '');

/** The file read into tasks, in its order. Throws `NotTodoistCsvError` for a file without Todoist's columns. */
export function planTodoistImport(text: string, today: string): ImportPlan {
  const [header, ...records] = parseCsv(text);
  const columns = (header ?? []).map((name) => name.trim().toUpperCase());
  const at = (name: string) => columns.indexOf(name);
  if (at('TYPE') < 0 || at('CONTENT') < 0) throw new NotTodoistCsvError();
  const cell = (record: string[], name: string) => (at(name) < 0 ? '' : (record[at(name)] ?? '').trim());

  const plan: ImportPlan = { tasks: [], subtasks: 0, labels: [], unreadDates: [], nonRecurring: [], trimmed: 0 };
  let section: string | null = null;
  // The open tasks above this row, by indent: the last one with a smaller indent is the parent.
  let stack: { indent: number; row: number }[] = [];

  records.forEach((record, index) => {
    const row = index + 1;
    const type = cell(record, 'TYPE').toLowerCase();
    if (type === 'section') {
      section = cut(clean(cell(record, 'CONTENT')), MAX_LABEL).trim() || null;
      if (section && !plan.labels.includes(section)) plan.labels.push(section);
      stack = [];
      return;
    }
    if (type !== 'task') return;
    const content = clean(cell(record, 'CONTENT'));
    if (!content) return;

    const indent = Math.max(1, Number.parseInt(cell(record, 'INDENT'), 10) || 1);
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parentRow = stack.length > 0 ? stack[stack.length - 1].row : null;
    stack.push({ indent, row });
    if (parentRow !== null) plan.subtasks++;

    const priority = Number(cell(record, 'PRIORITY'));
    const input: TaskInput & { title: string } = {
      title: cut(content, MAX_TITLE),
      priority: ([1, 2, 3, 4].includes(priority) ? priority : 4) as TaskPriority,
      labels: section ? [section] : [],
    };
    const notes: string[] = [];
    const zone = cell(record, 'TIMEZONE');

    const datePhrase = cell(record, 'DATE');
    const planned = datePhrase ? readWhen(datePhrase, today) : null;
    if (planned) {
      const moved = planned.time ? toRome(planned.date, planned.time, zone) : { date: planned.date, time: null };
      input.plannedDate = moved.date;
      input.plannedTime = moved.time;
      if (planned.recurrence) {
        input.recurrence = planned.recurrence;
        input.recurrenceFrom = planned.recurrenceFrom;
      }
    } else if (datePhrase) {
      const repeats = isRepetitionPhrase(datePhrase);
      (repeats ? plan.nonRecurring : plan.unreadDates).push({ title: input.title, phrase: datePhrase });
      notes.push(repeats ? `Ripetizione in Todoist: «${datePhrase}»` : `Data in Todoist: «${datePhrase}»`);
    }

    const deadlinePhrase = cell(record, 'DEADLINE');
    const deadline = deadlinePhrase ? readWhen(deadlinePhrase, today) : null;
    if (deadline && !deadline.recurrence) {
      const moved = deadline.time ? toRome(deadline.date, deadline.time, zone) : { date: deadline.date, time: null };
      input.dueDate = moved.date;
      input.dueTime = moved.time;
      // The deadline never repeats (the server refuses both): the deadline stays, the repetition is written down.
      if (input.recurrence) {
        delete input.recurrence;
        delete input.recurrenceFrom;
        plan.nonRecurring.push({ title: input.title, phrase: datePhrase, why: 'ha anche un termine finale, che non si ripete' });
        notes.push(`Ripetizione in Todoist: «${datePhrase}» (non si ripete: il compito ha un termine finale)`);
      }
    } else if (deadlinePhrase) {
      plan.unreadDates.push({ title: input.title, phrase: deadlinePhrase });
      notes.push(`Termine in Todoist: «${deadlinePhrase}»`);
    }

    const description = [clean(cell(record, 'DESCRIPTION')), ...notes].filter(Boolean).join('\n\n');
    if (description) input.description = cut(description, MAX_DESCRIPTION);
    if (content.length > MAX_TITLE || description.length > MAX_DESCRIPTION) plan.trimmed++;
    plan.tasks.push({ row, parentRow, input });
  });
  return plan;
}

/**
 * Creates the plan's tasks in `dossierId`, one at a time and in order (a parent before its subtasks), skipping the
 * rows already in `created` and writing each new one there. Stops at the first failure: run again with the same
 * `created`, nothing is created twice. `onCreated` follows each row written there (to keep it past a reload).
 */
export async function runTodoistImport(
  plan: ImportPlan,
  dossierId: string,
  created: Map<number, string>,
  create: (input: TaskInput & { title: string }) => Promise<{ id: string }>,
  onCreated?: () => void,
): Promise<{ added: number; error: unknown }> {
  let added = 0;
  for (const task of plan.tasks) {
    if (created.has(task.row)) continue;
    const parentId = task.parentRow === null ? null : created.get(task.parentRow);
    if (parentId === undefined) continue;
    try {
      const { id } = await create({ ...task.input, dossierId, parentId });
      created.set(task.row, id);
      onCreated?.();
      added++;
    } catch (error) {
      return { added, error };
    }
  }
  return { added, error: null };
}
