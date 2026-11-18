import { describe, expect, it, vi } from 'vitest';
import { RECURRENCE_RULES } from '../../../types/tasks';
import example from './__fixtures__/todoist-esempio.csv?raw';
import { NotTodoistCsvError, parseCsv, planTodoistImport, readTodoistTitle, runTodoistImport, toRome } from './todoistCsv';

// Tuesday 17 November 2026, the server's Rome day.
const TODAY = '2026-11-17';

describe('parseCsv', () => {
  it('reads quotes, doubled quotes, commas and line breaks inside a field', () => {
    expect(parseCsv('a,"b, c","say ""hi""","one\r\ntwo"\r\nx,,z')).toEqual([
      ['a', 'b, c', 'say "hi"', 'one\ntwo'],
      ['x', '', 'z'],
    ]);
  });

  it('drops the BOM, takes LF and a last line without a break, keeps empty fields', () => {
    expect(parseCsv('﻿TYPE,CONTENT\n,\ntask,a')).toEqual([['TYPE', 'CONTENT'], ['', ''], ['task', 'a']]);
  });
});

describe('planTodoistImport on the example file', () => {
  const plan = planTodoistImport(example, TODAY);
  const byTitle = (title: string) => plan.tasks.find((t) => t.input.title === title)!;

  it('counts tasks, subtasks and the sections as labels; meta and empty rows are skipped', () => {
    expect(plan.tasks).toHaveLength(13);
    expect(plan.subtasks).toBe(3);
    expect(plan.labels).toEqual(['udienza', 'Studio della pratica 📚', 'Adempimenti ⭐️']);
    expect(plan.fromTitles).toEqual({ labels: 1, deadlines: 1, durations: 1, links: 1 });
    expect(byTitle('Rileggere il contratto, clausola 7').input.labels).toEqual(['Studio della pratica 📚']);
    expect(byTitle('Deposito memoria').input.labels).toEqual(['udienza']);
  });

  it('builds the tree from INDENT and the order of the rows', () => {
    const parent = byTitle('Sentire il cliente sui fatti');
    const call = byTitle('Fissare la telefonata');
    expect(parent.parentRow).toBeNull();
    expect(call.parentRow).toBe(parent.row);
    expect(byTitle('Preparare le domande').parentRow).toBe(call.row);
    expect(byTitle('Inviare il riepilogo').parentRow).toBe(parent.row);
    // A new section closes the tree.
    expect(byTitle('Controllo PEC').parentRow).toBeNull();
  });

  it('keeps the priority as it is (1 is urgent in the CSV too) and the multi-line description', () => {
    expect(byTitle('Deposito memoria').input.priority).toBe(1);
    expect(byTitle("Preparare l'indice dei documenti").input.priority).toBe(2);
    expect(byTitle("Preparare l'indice dei documenti").input.description).toBe(
      'Punti da coprire:\n\n- allegati del ricorso\n- [modello](https://example.com/modello) da adattare',
    );
  });

  it('reads dates in Italian and English, and the five repetitions', () => {
    expect(byTitle('Leggi la guida introduttiva (Guarda) 📽️').input.plannedDate).toBe(TODAY);
    expect(byTitle('Rileggere il contratto, clausola 7').input.plannedDate).toBe('2026-11-18');
    expect(byTitle('Fissare la telefonata').input).toMatchObject({ plannedDate: '2026-11-18', plannedTime: '15:00' });
    expect(byTitle('Rileggere il contratto, clausola 7').input.recurrence).toBeUndefined();
    expect(byTitle('Controllo PEC').input).toMatchObject({ plannedTime: '09:00', recurrence: RECURRENCE_RULES.workingDays });
    expect(byTitle('Inviare il riepilogo').input).toMatchObject({ dueDate: '2026-11-30' });
  });

  it('brings a time in another zone to Rome', () => {
    // 10:00 in New York on 18 November is 16:00 in Rome.
    expect(byTitle('Call con il corrispondente').input).toMatchObject({ plannedDate: '2026-11-18', plannedTime: '16:00' });
  });

  it('turns a repetition outside the five rules into a task that does not repeat, the phrase in the description', () => {
    const report = byTitle('Report al socio').input;
    expect(report.recurrence).toBeUndefined();
    expect(report.plannedDate).toBeUndefined();
    expect(report.description).toBe('Ripetizione in Todoist: «ogni 2 settimane»');
    // A repetition beside a deadline: the deadline stays, the server refuses both.
    const monthly = byTitle('Revisione mensile').input;
    expect(monthly).toMatchObject({ plannedDate: TODAY, dueDate: '2026-12-15' });
    expect(monthly.recurrence).toBeUndefined();
    expect(plan.nonRecurring.map((n) => n.phrase)).toEqual(['ogni venerdì alle 10', 'ogni 2 settimane', 'ogni mese']);
    const why = 'ha anche un termine finale, che non si ripete';
    expect(plan.nonRecurring.map((n) => n.why)).toEqual([why, undefined, why]);
  });

  it("reads Todoist's syntax out of the title: label, deadline, duration and links", () => {
    const deposit = byTitle('Deposito memoria').input;
    // «{tra 10 giorni}» is the deadline (the CSV has none), so «ogni venerdì alle 10» does not repeat.
    expect(deposit).toMatchObject({ labels: ['udienza'], dueDate: '2026-11-27', plannedDate: '2026-11-20', plannedTime: '10:00' });
    expect(deposit.recurrence).toBeUndefined();
    expect(deposit.description).toBe(
      'Durata in Todoist: 1h\n\nRipetizione in Todoist: «ogni venerdì alle 10» (non si ripete: il compito ha un termine finale)',
    );
    expect(byTitle('Leggi la guida introduttiva (Guarda) 📽️').input.description).toBe('Link:\n- Guarda: https://example.com/guida');
  });

  it('lists the dates it did not understand and keeps them in the description', () => {
    expect(plan.unreadDates).toEqual([{ title: 'Archiviare le bozze', phrase: 'a metà mese' }]);
    expect(byTitle('Archiviare le bozze').input.description).toBe('Data in Todoist: «a metà mese»');
    expect(byTitle('Archiviare le bozze').input.plannedDate).toBeUndefined();
  });

  it('refuses a file without Todoist columns', () => {
    expect(() => planTodoistImport('nome,cognome\nA,B', TODAY)).toThrow(NotTodoistCsvError);
  });

  it('cuts a title over the server cap and counts it', () => {
    const long = planTodoistImport(`TYPE,CONTENT\ntask,${'x'.repeat(600)}`, TODAY);
    expect(long.tasks[0].input.title).toHaveLength(500);
    expect(long.trimmed).toBe(1);
    // Never half an emoji at the cut.
    const emoji = planTodoistImport(`TYPE,CONTENT\ntask,${'x'.repeat(499)}📚`, TODAY);
    expect(emoji.tasks[0].input.title).toBe('x'.repeat(499));
  });
});

describe('readTodoistTitle', () => {
  it('reads only labels and a deadline, never a date in words or a priority', () => {
    const read = readTodoistTitle('Chiamare domani p1 il cliente @telefono @studio', TODAY);
    expect(read).toMatchObject({ title: 'Chiamare domani p1 il cliente', labels: ['telefono', 'studio'], due: null, notes: [] });
  });

  it('keeps a «{…}» that is not a date, an address and a «!» that is not a duration', () => {
    const read = readTodoistTitle('Scrivere a mario@studio.it {bozza} !importante', TODAY);
    expect(read).toMatchObject({ title: 'Scrivere a mario@studio.it {bozza} !importante', labels: [], due: null, durations: 0 });
  });

  it('keeps the words of every link, with the addresses in the description, and a title of symbols alone whole', () => {
    const read = readTodoistTitle('Leggi [art. 2043](https://example.com/a?x=1 y) e [la nota](https://example.com/b) !30 min', TODAY);
    expect(read.title).toBe('Leggi art. 2043 e la nota');
    expect(read.notes).toEqual(['Link:\n- art. 2043: https://example.com/a?x=1 y\n- la nota: https://example.com/b', 'Durata in Todoist: 30 min']);
    expect(readTodoistTitle('@solo', TODAY).title).toBe('@solo');
  });

  it('leaves the deadline of the CSV first and writes the title\'s down', () => {
    const csv = 'TYPE,CONTENT,DEADLINE\ntask,Depositare {tra 3 giorni},2026-12-01';
    const task = planTodoistImport(csv, TODAY).tasks[0].input;
    expect(task).toMatchObject({ title: 'Depositare', dueDate: '2026-12-01', description: 'Termine nel titolo in Todoist: {tra 3 giorni}' });
  });
});

describe('toRome', () => {
  it('leaves Rome and an unknown zone alone, and follows summer time', () => {
    expect(toRome('2026-11-18', '10:00', 'Europe/Rome')).toEqual({ date: '2026-11-18', time: '10:00' });
    expect(toRome('2026-11-18', '10:00', 'Nowhere/Land')).toEqual({ date: '2026-11-18', time: '10:00' });
    expect(toRome('2026-07-01', '09:00', 'Europe/London')).toEqual({ date: '2026-07-01', time: '10:00' });
    expect(toRome('2026-11-18', '20:00', 'America/Los_Angeles')).toEqual({ date: '2026-11-19', time: '05:00' });
  });
});

describe('runTodoistImport', () => {
  const plan = planTodoistImport(example, TODAY);

  it('creates parents before subtasks, in the dossier, and resumes after a failure without duplicates', async () => {
    let n = 0;
    const calls: { title: string; parentId: string | null | undefined; dossierId: string | null | undefined }[] = [];
    const create = vi.fn(async (input: { title: string; parentId?: string | null; dossierId?: string | null }) => {
      if (calls.length === 5 && n === 5) {
        n++;
        throw new Error('rete');
      }
      n++;
      calls.push({ title: input.title, parentId: input.parentId, dossierId: input.dossierId });
      return { id: `t${calls.length}` };
    });
    const created = new Map<number, string>();

    const first = await runTodoistImport(plan, 'd1', created, create);
    expect(first.added).toBe(5);
    expect(first.error).toBeInstanceOf(Error);
    expect(created.size).toBe(5);

    const second = await runTodoistImport(plan, 'd1', created, create);
    expect(second).toEqual({ added: 8, error: null });
    expect(calls).toHaveLength(13);
    expect(new Set(calls.map((c) => c.title)).size).toBe(13);
    expect(calls.every((c) => c.dossierId === 'd1')).toBe(true);
    const id = (title: string) => `t${calls.findIndex((c) => c.title === title) + 1}`;
    expect(calls.find((c) => c.title === 'Fissare la telefonata')!.parentId).toBe(id('Sentire il cliente sui fatti'));
    expect(calls.find((c) => c.title === 'Preparare le domande')!.parentId).toBe(id('Fissare la telefonata'));

    // A third run has nothing left.
    expect(await runTodoistImport(plan, 'd1', created, create)).toEqual({ added: 0, error: null });
  });
});
