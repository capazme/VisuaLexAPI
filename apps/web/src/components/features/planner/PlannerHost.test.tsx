import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Task } from '../../../types/tasks';

const service = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn() }));
vi.mock('../../../services/taskService', () => ({ taskService: service }));

import { PlannerHost } from './PlannerHost';
import { DossierTasksPanel } from './DossierTasksPanel';
import { TaskDialog } from './TaskDialog';
import { plannerStore } from './plannerStore';
import { splitLinks } from './splitLinks';
import { appStore } from '../../../store/useAppStore';

const TODAY = '2026-10-20';

function task(id: string, fields: Partial<Task> = {}): Task {
  return {
    id, title: `Compito ${id}`, description: null, priority: 4, labels: [], position: 0, parentId: null,
    dossierId: null, dossierItemId: null, plannedDate: null, plannedTime: null, dueDate: null, dueTime: null,
    recurrence: null, recurrenceFrom: 'pianificata', origin: 'lavoro', completedAt: null, deletedAt: null,
    createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z', ...fields,
  };
}

beforeEach(() => {
  Object.values(service).forEach((fn) => fn.mockReset());
  service.list.mockResolvedValue({ today: TODAY, tasks: [], truncated: false });
  plannerStore.setState({ version: 0, todayCount: null, notice: null, quickAdd: null });
  appStore.setState({
    dossiers: [
      { id: 'd1', title: 'Ricorso Rossi', createdAt: '', items: [], kind: 'lavoro' },
      { id: 'd2', title: 'Esame di diritto civile', createdAt: '', items: [], kind: 'studio' },
    ],
  });
});

const host = (path = '/') => render(<MemoryRouter initialEntries={[path]}><PlannerHost enabled /><input aria-label="Altro campo" /></MemoryRouter>);

describe('«q», the quick add from anywhere', () => {
  it('opens the new task, and on a dossier\'s page the dossier is chosen', async () => {
    host('/dossier?dossier=d1');
    fireEvent.keyDown(window, { key: 'q' });
    const dialog = await screen.findByRole('dialog', { name: 'Nuovo compito' });
    expect(within(dialog).getByLabelText('Dossier')).toHaveValue('d1');
    expect(within(dialog).getByLabelText('Titolo')).toHaveFocus();
  });

  it('is left alone in a field, with a modifier, and under a dialog', () => {
    host();
    const field = screen.getByLabelText('Altro campo');
    fireEvent.keyDown(field, { key: 'q' });
    fireEvent.keyDown(window, { key: 'q', metaKey: true });
    expect(plannerStore.getState().quickAdd).toBeNull();
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.append(modal);
    fireEvent.keyDown(window, { key: 'q' });
    expect(plannerStore.getState().quickAdd).toBeNull();
    modal.remove();
  });

  it('creates the task with what was chosen, and its origin from the dossier\'s kind', async () => {
    service.create.mockResolvedValue(task('n', { dossierId: 'd2' }));
    host('/dossier?dossier=d2');
    fireEvent.keyDown(window, { key: 'q' });
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Titolo'), { target: { value: 'Ripassare la prescrizione' } });
    fireEvent.change(within(dialog).getByLabelText('Termine finale'), { target: { value: '2026-11-02' } });
    fireEvent.change(within(dialog).getByLabelText('Priorità'), { target: { value: '2' } });
    fireEvent.change(within(dialog).getByLabelText('Etichette'), { target: { value: 'esame, civile' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aggiungi' }));
    await waitFor(() => expect(service.create).toHaveBeenCalled());
    expect(service.create.mock.calls[0][0]).toMatchObject({
      title: 'Ripassare la prescrizione', dueDate: '2026-11-02', priority: 2, labels: ['esame', 'civile'], dossierId: 'd2', origin: 'studio',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(plannerStore.getState().notice?.message).toBe('Compito aggiunto');
  });

  it('keeps what was typed and says why when the form cannot be sent', async () => {
    host();
    act(() => plannerStore.getState().openQuickAdd(null));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Titolo'), { target: { value: 'Udienza' } });
    fireEvent.change(within(dialog).getByLabelText('Ripetizione'), { target: { value: 'FREQ=WEEKLY' } });
    // A repetition switches the deadline off, and the other way round.
    expect(within(dialog).getByLabelText('Termine finale')).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aggiungi' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Una ripetizione richiede la data pianificata.');
    expect(service.create).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText('Titolo')).toHaveValue('Udienza');
  });

  it('reads the count for the bar, and again after a write', async () => {
    service.list.mockResolvedValue({ today: TODAY, tasks: [task('a'), task('b')], truncated: false });
    host();
    await waitFor(() => expect(plannerStore.getState().todayCount).toBe(2));
    service.list.mockResolvedValue({ today: TODAY, tasks: [task('a')], truncated: false });
    act(() => plannerStore.getState().changed());
    await waitFor(() => expect(plannerStore.getState().todayCount).toBe(1));
    expect(service.list).toHaveBeenCalledWith('today');
  });
});

describe('editing a task', () => {
  it('saves every field and lists its subtasks, which it can add', async () => {
    const parent = task('p', { dossierId: 'd1', plannedDate: TODAY, labels: ['udienza'] });
    service.list.mockResolvedValue({ today: TODAY, tasks: [parent, task('s', { parentId: 'p', dossierId: 'd1' })], truncated: false });
    service.update.mockResolvedValue(parent);
    service.create.mockResolvedValue(task('s2', { parentId: 'p' }));
    const onClose = vi.fn();
    render(<MemoryRouter><TaskDialog mode="edit" task={parent} today={TODAY} onClose={onClose} /></MemoryRouter>);
    const dialog = screen.getByRole('dialog', { name: 'Modifica compito' });
    expect(await within(dialog).findByText('Compito s')).toBeInTheDocument();
    expect(service.list).toHaveBeenCalledWith('dossier', 'd1');
    fireEvent.change(within(dialog).getByLabelText('Nuovo sottocompito'), { target: { value: 'Bozza' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aggiungi il sottocompito' }));
    await waitFor(() => expect(service.create).toHaveBeenCalledWith({ title: 'Bozza', parentId: 'p' }));
    fireEvent.change(within(dialog).getByLabelText('Descrizione'), { target: { value: 'Vedi https://example.org/atto.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salva' }));
    await waitFor(() => expect(service.update).toHaveBeenCalled());
    expect(service.update.mock.calls[0]).toEqual(['p', expect.objectContaining({ description: 'Vedi https://example.org/atto.', labels: ['udienza'], dossierId: 'd1' })]);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows the server's refusal in the dialog", async () => {
    const parent = task('p');
    service.update.mockRejectedValue({ status: 400, message: 'Un compito con un termine finale non si ripete: togli la ripetizione o il termine.' });
    render(<MemoryRouter><TaskDialog mode="edit" task={parent} today={TODAY} onClose={vi.fn()} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/non si ripete/);
  });
});

describe("the dossier's tasks", () => {
  it('lists the dossier\'s tasks without naming the dossier again, and adds one to it', async () => {
    service.list.mockResolvedValue({ today: TODAY, tasks: [task('a', { dossierId: 'd1' })], truncated: false });
    service.create.mockResolvedValue(task('n', { dossierId: 'd1' }));
    render(<MemoryRouter><DossierTasksPanel dossierId="d1" /></MemoryRouter>);
    const panel = screen.getByRole('region', { name: /Compiti/ });
    expect(await within(panel).findByRole('checkbox', { name: /Compito a/ })).toBeInTheDocument();
    expect(within(panel).queryByRole('link', { name: /Ricorso Rossi/ })).toBeNull();
    expect(within(panel).getByText('Senza data · nel dossier «Ricorso Rossi»')).toBeInTheDocument();
    fireEvent.change(within(panel).getByLabelText('Nuovo compito'), { target: { value: 'Notificare' } });
    fireEvent.submit(within(panel).getByLabelText('Nuovo compito'));
    await waitFor(() => expect(service.create.mock.calls[0][0]).toMatchObject({ title: 'Notificare', dossierId: 'd1' }));
  });
});

describe('a description', () => {
  it('turns web addresses into links, http and https only, a final stop left out', () => {
    expect(splitLinks('Vedi https://example.org/atto. e javascript:alert(1) o http://a.it/x)')).toEqual([
      { text: 'Vedi ' },
      { text: 'https://example.org/atto', href: 'https://example.org/atto' },
      { text: '. e javascript:alert(1) o ' },
      { text: 'http://a.it/x', href: 'http://a.it/x' },
      { text: ')' },
    ]);
  });
});
