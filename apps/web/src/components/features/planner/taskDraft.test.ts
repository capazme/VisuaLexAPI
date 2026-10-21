import { describe, expect, it } from 'vitest';
import { belongsTo, draftFromTask, draftProblem, emptyDraft, inputFromDraft, parseLabels } from './taskDraft';
import { taskFromApi } from '../../../services/taskService';
import type { Task } from '../../../types/tasks';

const TODAY = '2026-10-20';

const wire = {
  id: 't1', title: 'Deposito memoria', description: 'Vedi https://example.org', priority: 2, labels: ['udienza'], position: 0,
  parent_id: null, dossier_id: 'd1', dossier_item_id: null, planned_date: '2026-10-22', planned_time: '09:30',
  due_date: '2026-10-26', due_time: null, recurrence: null, recurrence_from: 'pianificata', origin: 'lavoro',
  completed_at: null, deleted_at: null, created_at: '2026-10-19T10:00:00.000Z', updated_at: '2026-10-19T10:00:00.000Z',
};

describe('a task from the server', () => {
  it('maps the snake_case answer once', () => {
    const task = taskFromApi(wire);
    expect(task).toMatchObject({ parentId: null, dossierId: 'd1', plannedDate: '2026-10-22', plannedTime: '09:30', dueDate: '2026-10-26', priority: 2 });
  });

  it('reads a priority out of range as the default', () => {
    expect(taskFromApi({ ...wire, priority: 9 }).priority).toBe(4);
  });
});

describe('the form', () => {
  it('reads labels as typed, trimmed, once', () => {
    expect(parseLabels(' cliente,udienza ,, cliente, da  fatturare')).toEqual(['cliente', 'udienza', 'da fatturare']);
  });

  it('says what the server would refuse, before sending', () => {
    expect(draftProblem(emptyDraft())).toBe('Il titolo è obbligatorio.');
    expect(draftProblem(emptyDraft({ title: 'x', plannedTime: '10:00' }))).toMatch(/richiede la data pianificata/);
    expect(draftProblem(emptyDraft({ title: 'x', recurrence: 'FREQ=WEEKLY' }))).toMatch(/richiede la data pianificata/);
    expect(draftProblem(emptyDraft({ title: 'x', recurrence: 'FREQ=WEEKLY', plannedDate: TODAY, dueDate: TODAY }))).toMatch(/non si ripete/);
    expect(draftProblem(emptyDraft({ title: 'x', labels: Array.from({ length: 21 }, (_, i) => `e${i}`).join(',') }))).toMatch(/20 etichette/);
    expect(draftProblem(emptyDraft({ title: 'Deposito', plannedDate: TODAY }))).toBeNull();
  });

  it('sends every field, a cleared one as null, and a subtask without its dossier', () => {
    const draft = { ...draftFromTask(taskFromApi(wire)), dueDate: '', dueTime: '12:00', description: '  ' };
    expect(inputFromDraft(draft, { withDossier: true })).toEqual({
      title: 'Deposito memoria', description: null, priority: 2, labels: ['udienza'], plannedDate: '2026-10-22',
      plannedTime: '09:30', dueDate: null, dueTime: null, recurrence: null, dossierId: 'd1',
    });
    expect(inputFromDraft(draft, { withDossier: false })).not.toHaveProperty('dossierId');
    expect(inputFromDraft({ ...draft, recurrence: 'FREQ=MONTHLY', recurrenceFrom: 'completamento' }, { withDossier: false, origin: 'studio' }))
      .toMatchObject({ recurrence: 'FREQ=MONTHLY', recurrenceFrom: 'completamento', origin: 'studio' });
  });
});

describe('where a new task went', () => {
  const task = (fields: Partial<Task>) => ({ ...taskFromApi(wire), dossierId: null, plannedDate: null, dueDate: null, ...fields });

  it('knows the views', () => {
    expect(belongsTo(task({ plannedDate: TODAY }), 'today', TODAY)).toBe(true);
    expect(belongsTo(task({ dueDate: '2026-10-19' }), 'today', TODAY)).toBe(true);
    expect(belongsTo(task({ plannedDate: '2026-10-21' }), 'today', TODAY)).toBe(false);
    expect(belongsTo(task({ plannedDate: '2026-10-26' }), 'upcoming', TODAY)).toBe(true);
    expect(belongsTo(task({ plannedDate: '2026-10-27' }), 'upcoming', TODAY)).toBe(false);
    expect(belongsTo(task({}), 'inbox', TODAY)).toBe(true);
    expect(belongsTo(task({ dossierId: 'd1' }), 'inbox', TODAY)).toBe(false);
    expect(belongsTo(task({ dossierId: 'd1' }), 'dossier', TODAY, 'd1')).toBe(true);
  });
});
