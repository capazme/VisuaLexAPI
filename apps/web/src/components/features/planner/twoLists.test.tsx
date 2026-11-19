import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Task } from '../../../types/tasks';

const service = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  complete: vi.fn(),
  reopen: vi.fn(),
  trash: vi.fn(),
  restore: vi.fn(),
}));
vi.mock('../../../services/taskService', () => ({ taskService: service }));
const study = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock('../../../services/studiaService', () => ({ studiaService: study }));

import { InboxView, TodayView } from './OpusViews';
import { OpusPage } from './OpusPage';
import { PlannerHost } from './PlannerHost';
import { plannerStore } from './plannerStore';
import { belongsTo } from './taskDraft';
import { inSection, newTaskOrigin } from './taskSection';
import { appStore } from '../../../store/useAppStore';
import { resetNotifications } from '../../ui/notifications/notifications';

const TODAY = '2026-10-20';

function task(id: string, fields: Partial<Task> = {}): Task {
  return {
    id, title: `Compito ${id}`, description: null, priority: 4, labels: [], position: 0, parentId: null,
    dossierId: null, dossierItemId: null, plannedDate: null, plannedTime: null, dueDate: null, dueTime: null,
    recurrence: null, recurrenceFrom: 'pianificata', origin: 'lavoro', completedAt: null, deletedAt: null,
    createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z', ...fields,
  };
}

const answer = (tasks: Task[]) => ({ today: TODAY, tasks, truncated: false });
const saved = (base: Task) => (_id: string, input: Partial<Task>) => Promise.resolve({ ...base, ...input, updatedAt: '2026-10-01T10:00:01.000Z' });

/** Work's planner and Learn's, as `App.tsx` routes them. */
function renderPlanner(path: string) {
  const views = (
    <>
      <Route path="scadenziario" element={<TodayView />} />
      <Route path="ingresso" element={<InboxView />} />
    </>
  );
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PlannerHost enabled />
      <Routes>
        <Route path="/work" element={<OpusPage />}>{views}</Route>
        <Route path="/learn/attivita" element={<OpusPage />}>{views}</Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.values(service).forEach((fn) => fn.mockReset());
  study.session.mockReset().mockResolvedValue({ conteggi: { dovute: 0, nuove: 0 }, cards: [] });
  plannerStore.setState({ version: 0, todayCount: null, today: null, notice: null, quickAdd: null, folded: {} });
  appStore.setState({
    dossiers: [
      { id: 'd1', title: 'Ricorso Rossi', createdAt: '', items: [], kind: 'lavoro' },
      { id: 'd2', title: 'Esame di diritto civile', createdAt: '', items: [], kind: 'studio' },
    ],
  });
});
afterEach(() => resetNotifications());

const mixed = [
  task('a', { plannedDate: TODAY }),
  task('s', { plannedDate: TODAY, origin: 'studio' }),
  task('f', { plannedDate: TODAY, origin: 'forum' }),
];

// LC130: two to-do lists, Work's («lavoro», and «forum» where it always was) and Learn's («studio»).
describe('Work and Learn, two lists of tasks', () => {
  it('Work lists its tasks and the Forum\'s, not the study ones; the counts are per section', async () => {
    service.list.mockResolvedValue(answer(mixed));
    renderPlanner('/work/scadenziario');
    expect(await screen.findByRole('checkbox', { name: /Compito a/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Compito f/ })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Compito s/ })).toBeNull();
    expect(plannerStore.getState().todayCount).toEqual({ work: 2, learn: 1 });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Learn → Attività lists only the study tasks, under «Attività» with its own views', async () => {
    service.list.mockResolvedValue(answer(mixed));
    renderPlanner('/learn/attivita/scadenziario');
    expect(await screen.findByRole('checkbox', { name: /Compito s/ })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Compito a/ })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Compito f/ })).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Attività$/);
    const views = screen.getByRole('navigation', { name: 'Viste di Learn' });
    expect([...views.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '/learn/attivita/scadenziario', '/learn/attivita/prossimi', '/learn/attivita/ingresso',
    ]);
    expect(screen.getByRole('link', { name: 'Cestino dei compiti' })).toHaveAttribute('href', '/learn/attivita/cestino');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('an empty Scadenziario in Learn offers the pratiche di studio to take up, not the work ones', async () => {
    service.list.mockResolvedValue(answer([]));
    renderPlanner('/learn/attivita/scadenziario');
    const resume = await screen.findByRole('region', { name: 'Riprendi' });
    expect(within(resume).getAllByRole('link').map((a) => a.textContent)).toEqual([expect.stringContaining('Esame di diritto civile')]);
  });

  it.each([
    ['/learn/attivita/scadenziario', 'studio'],
    ['/work/scadenziario', 'lavoro'],
  ])('the quick add on %s sends the origin «%s»', async (path, origin) => {
    service.list.mockResolvedValue(answer([]));
    service.create.mockResolvedValue(task('n', { plannedDate: TODAY, origin: origin as Task['origin'] }));
    renderPlanner(path);
    // The field is keyed on the server's day: typed in once the first read answered.
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    const field = screen.getByLabelText('Nuovo compito');
    fireEvent.change(field, { target: { value: 'Ripassare la prescrizione' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi il compito' }));
    await waitFor(() => expect(service.create).toHaveBeenCalled());
    expect(service.create.mock.calls[0][0]).toMatchObject({ title: 'Ripassare la prescrizione', origin });
    expect(plannerStore.getState().notice).toBeNull();
  });

  it('in Learn, a task for a work dossier is the dossier\'s, and the page says it is not in this view', async () => {
    service.list.mockResolvedValue(answer([]));
    service.create.mockResolvedValue(task('n', { plannedDate: TODAY, dossierId: 'd1' }));
    renderPlanner('/learn/attivita/scadenziario');
    await screen.findByLabelText('Nuovo compito');
    fireEvent.keyDown(window, { key: 'c' });
    const dialog = await screen.findByRole('dialog', { name: 'Nuovo compito' });
    fireEvent.change(within(dialog).getByLabelText('Titolo'), { target: { value: 'Memoria' } });
    fireEvent.change(within(dialog).getByLabelText('Pratica'), { target: { value: 'd1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aggiungi' }));
    await waitFor(() => expect(service.create).toHaveBeenCalled());
    expect(service.create.mock.calls[0][0]).toMatchObject({ dossierId: 'd1', origin: 'lavoro' });
    await waitFor(() => expect(plannerStore.getState().notice?.message).toBe('Compito aggiunto: non è in questa vista'));
  });

  it('in Learn, «#» and Enter choose a work dossier, and the task is that dossier\'s', async () => {
    service.list.mockResolvedValue(answer([]));
    service.create.mockResolvedValue(task('n', { plannedDate: TODAY, dossierId: 'd1' }));
    renderPlanner('/learn/attivita/scadenziario');
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    const field = screen.getByLabelText('Nuovo compito');
    fireEvent.change(field, { target: { value: 'Memoria #Ros', selectionStart: 12 } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(service.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi il compito' }));
    await waitFor(() => expect(service.create).toHaveBeenCalled());
    expect(service.create.mock.calls[0][0]).toMatchObject({ dossierId: 'd1', origin: 'lavoro' });
    await waitFor(() => expect(plannerStore.getState().notice?.message).toBe('Compito aggiunto: non è in questa vista'));
  });

  it('«c» in Learn creates a study task', async () => {
    service.list.mockResolvedValue(answer([]));
    service.create.mockResolvedValue(task('n', { plannedDate: TODAY, origin: 'studio' }));
    renderPlanner('/learn/attivita/ingresso');
    await screen.findByLabelText('Nuovo compito');
    fireEvent.keyDown(window, { key: 'c' });
    const dialog = await screen.findByRole('dialog', { name: 'Nuovo compito' });
    fireEvent.change(within(dialog).getByLabelText('Titolo'), { target: { value: 'Schema' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aggiungi' }));
    await waitFor(() => expect(service.create).toHaveBeenCalled());
    expect(service.create.mock.calls[0][0]).toMatchObject({ title: 'Schema', origin: 'studio' });
  });

  it('a subtask added in Learn takes its parent\'s origin', async () => {
    const p = task('p', { origin: 'studio' });
    service.list.mockResolvedValue(answer([p]));
    service.create.mockResolvedValue(task('c1', { parentId: 'p', origin: 'studio' }));
    renderPlanner('/learn/attivita/ingresso');
    fireEvent.click(await screen.findByRole('button', { name: 'Compito p' }));
    const sheet = await screen.findByRole('dialog', { name: 'Compito p' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Aggiungi un sottocompito' }));
    fireEvent.change(within(sheet).getByLabelText('Nuovo sottocompito'), { target: { value: 'Bozza' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Aggiungi il sottocompito' }));
    await waitFor(() => expect(service.create).toHaveBeenCalledWith({ title: 'Bozza', parentId: 'p', origin: 'studio' }));
  });

  it('a task moved to a dossier of the other kind brings its subtasks into the new list', async () => {
    const p = task('p');
    const child = task('k', { parentId: 'p' });
    service.list.mockResolvedValue(answer([p, child]));
    service.update.mockImplementation(saved(p));
    renderPlanner('/work/ingresso');
    fireEvent.click(await screen.findByRole('button', { name: 'Compito p' }));
    const sheet = await screen.findByRole('dialog', { name: 'Compito p' });
    fireEvent.click(within(sheet).getByRole('button', { name: "Pratica Lista d'ingresso" }));
    const search = within(sheet).getByRole('combobox', { name: 'Cerca una pratica' });
    fireEvent.change(search, { target: { value: 'esame' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(service.update).toHaveBeenCalledWith('p', { dossierId: 'd2', origin: 'studio' }));
    await waitFor(() => expect(service.update).toHaveBeenCalledWith('k', { origin: 'studio' }));
  });

  it('a study task moved back to «Lista d\'ingresso» keeps its origin, and stays in Learn', async () => {
    const s = task('s', { origin: 'studio', dossierId: 'd2' });
    service.list.mockResolvedValue(answer([{ ...s, plannedDate: TODAY }]));
    service.update.mockImplementation(saved(s));
    renderPlanner('/learn/attivita/scadenziario');
    fireEvent.click(await screen.findByRole('button', { name: 'Compito s' }));
    const sheet = await screen.findByRole('dialog', { name: 'Compito s' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Pratica Esame di diritto civile' }));
    const search = within(sheet).getByRole('combobox', { name: 'Cerca una pratica' });
    fireEvent.change(search, { target: { value: "Lista d'ingresso" } });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(service.update).toHaveBeenCalledWith('s', { dossierId: null }));
  });
});

describe('taskSection', () => {
  it('splits the origins: Learn the study tasks, Work every other; a new task is its dossier\'s, else its section\'s', () => {
    expect(['lavoro', 'studio', 'forum'].filter((origin) => inSection({ origin: origin as Task['origin'] }, 'work'))).toEqual(['lavoro', 'forum']);
    expect(['lavoro', 'studio', 'forum'].filter((origin) => inSection({ origin: origin as Task['origin'] }, 'learn'))).toEqual(['studio']);
    expect(newTaskOrigin(undefined, 'learn')).toBe('studio');
    expect(newTaskOrigin(undefined, 'work')).toBe('lavoro');
    expect(newTaskOrigin('lavoro', 'learn')).toBe('lavoro');
    expect(newTaskOrigin('studio', 'work')).toBe('studio');
    expect(belongsTo(task('x', { dossierId: null, origin: 'studio' }), 'inbox', TODAY, undefined, 'work')).toBe(false);
    expect(belongsTo(task('x', { dossierId: null, origin: 'studio' }), 'inbox', TODAY, undefined, 'learn')).toBe(true);
  });

  it('without Learn (VITE_FEATURE_STUDIA off) Work lists every task: none is out of reach', () => {
    vi.stubEnv('VITE_FEATURE_STUDIA', 'false');
    try {
      expect(inSection({ origin: 'studio' }, 'work')).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
