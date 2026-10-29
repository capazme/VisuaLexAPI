import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

import { InboxView, TaskTrashView, TodayView, UpcomingView } from './OpusViews';
import { plannerStore } from './plannerStore';
import { registerUndoToastListener, type UndoToast } from '../../../hooks/useUndoableAction';
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

const answer = (tasks: Task[]) => ({ today: TODAY, tasks, truncated: false });
const renderAt = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

let toasts: (UndoToast | null)[];
let unregister: () => void;

beforeEach(() => {
  Object.values(service).forEach((fn) => fn.mockReset());
  study.session.mockReset().mockResolvedValue({ conteggi: { dovute: 0, nuove: 0 }, cards: [] });
  plannerStore.setState({ version: 0, todayCount: null, today: null, notice: null, quickAdd: null, folded: {} });
  appStore.setState({ dossiers: [{ id: 'd1', title: 'Ricorso Rossi', createdAt: '', items: [], kind: 'lavoro' }] });
  toasts = [];
  unregister = registerUndoToastListener((t) => toasts.push(t));
});
afterEach(() => {
  unregister();
  const last = toasts[toasts.length - 1];
  last?.onDismiss();
});

describe('«Oggi»', () => {
  it('holds the rows while it reads, then lists the missed deadlines and the late tasks first, and gives the bar its count', async () => {
    let resolve!: (value: unknown) => void;
    service.list.mockReturnValue(new Promise((r) => (resolve = r)));
    renderAt(<TodayView />);
    expect(screen.getByRole('heading', { level: 2, name: 'Oggi' })).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    await act(async () =>
      resolve(
        answer([
          task('a', { plannedDate: TODAY }),
          task('b', { plannedDate: '2026-10-18', dueDate: '2026-10-19', priority: 1, dossierId: 'd1', labels: ['udienza', 'DPO'] }),
          task('c', { plannedDate: '2026-10-19' }),
        ]),
      ),
    );
    const groups = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(groups).toEqual(['Termini scaduti, 1 compito', 'In ritardo, 1 compito', 'Oggi, 1 compito']);
    expect(within(screen.getByRole('list', { name: 'In ritardo' })).getByRole('checkbox', { name: /Compito c/ })).toBeInTheDocument();
    const overdue = screen.getByRole('list', { name: 'Termini scaduti' });
    // Labels as the dossiers' tags: the first letter capitalised, the rest as typed.
    expect(within(overdue).getByText('Udienza')).toBeInTheDocument();
    expect(within(overdue).getByText('DPO')).toBeInTheDocument();
    expect(within(overdue).getByText(/Termine finale ieri · scaduto da 1 giorno/)).toBeInTheDocument();
    expect(within(overdue).getByText('Urgente')).toBeInTheDocument();
    expect(within(overdue).getByRole('link', { name: /Ricorso Rossi/ })).toHaveAttribute('href', '/dossier?dossier=d1');
    // The count is still overdue plus today: every task the view lists.
    expect(plannerStore.getState().todayCount).toBe(3);
    expect(service.list).toHaveBeenCalledWith('today', undefined);
  });

  it('says when there is nothing for today', async () => {
    service.list.mockResolvedValue(answer([]));
    renderAt(<TodayView />);
    expect(await screen.findByText('Nessun compito per oggi')).toBeInTheDocument();
  });

  it('says a failed read and reads again on «Riprova»', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    service.list.mockRejectedValueOnce({ status: 503 }).mockResolvedValueOnce(answer([task('a', { plannedDate: TODAY })]));
    renderAt(<TodayView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Riprova' }));
    expect(await screen.findByRole('button', { name: 'Compito a' })).toBeInTheDocument();
    // Logged by its status, never the request's titles.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('today'), 503);
    warn.mockRestore();
  });

  it('ticks with Space on the checkbox, hides the row, and «Annulla» reopens it', async () => {
    service.list.mockResolvedValue(answer([task('a', { plannedDate: TODAY })]));
    service.complete.mockResolvedValue({ task: task('a'), recurred: null });
    service.reopen.mockResolvedValue(task('a'));
    renderAt(<TodayView />);
    const tick = await screen.findByRole('checkbox', { name: 'Segna come fatto: Compito a' });
    // A real checkbox: the browser turns Space into a click.
    fireEvent.click(tick);
    await waitFor(() => expect(service.complete).toHaveBeenCalledWith('a', undefined));
    await waitFor(() => expect(toasts[toasts.length - 1]?.message).toBe('Compito completato'));
    await act(async () => toasts[toasts.length - 1]!.onUndo());
    expect(service.reopen).toHaveBeenCalledWith('a');
    // Every write reads the views again.
    expect(plannerStore.getState().version).toBe(2);
  });

  it('ticks a repeating task with its occurrence, and «Annulla» puts its date back', async () => {
    const weekly = task('w', { plannedDate: TODAY, recurrence: 'FREQ=WEEKLY' });
    service.list.mockResolvedValue(answer([weekly]));
    service.complete.mockResolvedValue({ task: weekly, recurred: { previousPlannedDate: TODAY, plannedDate: '2026-10-27' } });
    service.update.mockResolvedValue(weekly);
    renderAt(<TodayView />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Compito w/ }));
    await waitFor(() => expect(service.complete).toHaveBeenCalledWith('w', TODAY));
    await waitFor(() => expect(toasts[toasts.length - 1]?.message).toBe('Fatto: torna mar 27 ott'));
    await act(async () => toasts[toasts.length - 1]!.onUndo());
    expect(service.update).toHaveBeenCalledWith('w', { plannedDate: TODAY });
  });

  it('puts a row back and says why when the tick is refused, without the title', async () => {
    service.list.mockResolvedValue(answer([task('a', { plannedDate: TODAY })]));
    service.complete.mockRejectedValue({ status: 409, message: 'Il compito è già passato alla data successiva.' });
    renderAt(<TodayView />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Compito a/ }));
    await waitFor(() => expect(plannerStore.getState().notice?.message).toBe('Il compito è già passato alla data successiva.'));
    expect(screen.getByRole('checkbox', { name: /Compito a/ })).toBeInTheDocument();
    // A 4xx reads the view again: the row on screen was stale.
    await waitFor(() => expect(service.list).toHaveBeenCalledTimes(2));
  });

  it('follows a new day: a page left open overnight reads again and proposes the new date', async () => {
    service.list.mockResolvedValue(answer([]));
    service.create.mockResolvedValue(task('n', { plannedDate: '2026-10-21' }));
    renderAt(<TodayView />);
    expect(await screen.findByText('martedì 20 ottobre')).toBeInTheDocument();
    // The bar's count, read every two minutes, answers the next day.
    service.list.mockResolvedValue({ today: '2026-10-21', tasks: [], truncated: false });
    act(() => plannerStore.getState().setToday('2026-10-21'));
    expect(await screen.findByText('mercoledì 21 ottobre')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nuovo compito'), { target: { value: 'Telefonare' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi il compito' }));
    await waitFor(() => expect(service.create.mock.calls[0][0]).toMatchObject({ plannedDate: '2026-10-21' }));
  });

  it('reads again when the tab comes back into view', async () => {
    service.list.mockResolvedValue(answer([]));
    renderAt(<TodayView />);
    await screen.findByText('Nessun compito per oggi');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(service.list).toHaveBeenCalledTimes(2));
  });

  it('gives the focus to a neighbour when a task trashed from its sheet leaves', async () => {
    service.list.mockResolvedValue(answer([task('a', { plannedDate: TODAY }), task('b', { plannedDate: TODAY })]));
    service.trash.mockResolvedValue({ taskCount: 1 });
    renderAt(<TodayView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Compito a' }));
    const sheet = await screen.findByRole('dialog', { name: 'Compito a' });
    service.list.mockResolvedValue(answer([task('b', { plannedDate: TODAY })]));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Altre azioni sul compito' }));
    fireEvent.click(within(sheet).getByRole('menuitem', { name: 'Sposta nel cestino' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Compito b/ })).toHaveFocus());
  });

  it('keeps a ticked row hidden until a read made after the tick, even when one made before, or a failed one, answers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = task('a', { plannedDate: TODAY });
    const b = task('b', { plannedDate: TODAY });
    service.list.mockResolvedValue(answer([a, b]));
    let landTick!: (value: unknown) => void;
    service.complete.mockReturnValue(new Promise((r) => (landTick = r)));
    renderAt(<TodayView />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Compito b/ }));
    expect(screen.queryByRole('checkbox', { name: /Compito b/ })).toBeNull();
    // Another write's read, which started before b's tick landed, still lists b.
    await act(async () => plannerStore.getState().changed());
    expect(screen.queryByRole('checkbox', { name: /Compito b/ })).toBeNull();
    // The tick lands; the read after it fails: what is on screen is older than the tick.
    service.list.mockRejectedValue({ status: 503 });
    await act(async () => landTick({ task: b, recurred: null }));
    await screen.findByRole('button', { name: 'Riprova' });
    expect(screen.queryByRole('checkbox', { name: /Compito b/ })).toBeNull();
    // A read after it, as the server answers it.
    service.list.mockResolvedValue(answer([a]));
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Riprova' })).toBeNull());
    expect(screen.getByRole('checkbox', { name: /Compito a/ })).toBeInTheDocument();
    warn.mockRestore();
  });

  it('gives the focus to the next row when a row leaves, else the previous one, else the heading', async () => {
    service.list.mockResolvedValue(answer([task('a', { plannedDate: TODAY }), task('b', { plannedDate: TODAY })]));
    service.complete.mockResolvedValue({ task: task('a'), recurred: null });
    renderAt(<TodayView />);
    const a = await screen.findByRole('checkbox', { name: /Compito a/ });
    a.focus();
    fireEvent.click(a);
    expect(screen.getByRole('checkbox', { name: /Compito b/ })).toHaveFocus();
    service.list.mockResolvedValue(answer([]));
    fireEvent.click(screen.getByRole('checkbox', { name: /Compito b/ }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Oggi' })).toHaveFocus());
  });

  it('moves between the rows with the arrows', async () => {
    service.list.mockResolvedValue(answer([task('a', { plannedDate: '2026-10-19' }), task('b', { plannedDate: TODAY }), task('c', { plannedDate: TODAY })]));
    renderAt(<TodayView />);
    const [a, b, c] = await screen.findAllByRole('checkbox');
    a.focus();
    // From the overdue list into today's: one sequence.
    fireEvent.keyDown(a, { key: 'ArrowDown' });
    expect(b).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Compito b' }), { key: 'ArrowDown' });
    expect(c).toHaveFocus();
    fireEvent.keyDown(c, { key: 'Home' });
    expect(a).toHaveFocus();
    fireEvent.keyDown(a, { key: 'ArrowUp' });
    expect(a).toHaveFocus();
  });

  it('moves a task to the trash from «⋯», with its subtasks, and «Annulla» restores it', async () => {
    service.list.mockResolvedValue(answer([task('p', { plannedDate: TODAY }), task('s', { plannedDate: TODAY, parentId: 'p' })]));
    service.trash.mockResolvedValue({ taskCount: 2 });
    service.restore.mockResolvedValue(task('p'));
    renderAt(<TodayView />);
    // The subtask sits under its parent.
    const subtasks = await screen.findByRole('list', { name: 'Sottocompiti di Compito p' });
    expect(within(subtasks).getByRole('checkbox', { name: /Compito s/ })).toBeInTheDocument();
    // What the server lists once they are gone.
    service.list.mockResolvedValue(answer([]));
    fireEvent.click(screen.getByRole('button', { name: 'Azioni: Compito p' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sposta nel cestino' }));
    await waitFor(() => expect(toasts[toasts.length - 1]?.message).toBe('Compito e 1 sottocompito spostati nel cestino'));
    expect(screen.queryByRole('checkbox', { name: /Compito s/ })).toBeNull();
    await act(async () => toasts[toasts.length - 1]!.onUndo());
    expect(service.restore).toHaveBeenCalledWith('p');
  });
});

describe('«Oggi» in groups', () => {
  it("leads to Gymnasium's day on one line, and reads nothing of Gymnasium's (its reads mark the day)", async () => {
    service.list.mockResolvedValue(answer([]));
    renderAt(<TodayView />);
    expect(await screen.findByRole('link', { name: 'Gymnasium: il ripasso di oggi' })).toHaveAttribute('href', '/studia/ripasso');
    await screen.findByText('Nessun compito per oggi');
    // The session's read settles the day and the missions on the server: opening Opus must not.
    expect(study.session).not.toHaveBeenCalled();
    // Not a task: no tick.
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('folds a group by its heading, and adds a task under it with its day', async () => {
    service.list.mockResolvedValue(answer([task('a', { plannedDate: TODAY })]));
    service.create.mockResolvedValue(task('n', { plannedDate: TODAY }));
    renderAt(<TodayView />);
    const toggle = await screen.findByRole('button', { name: /^Oggi\s*,\s*1 compito$/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi compito' }));
    fireEvent.change(screen.getAllByLabelText('Nuovo compito')[1], { target: { value: 'Telefonare' } });
    fireEvent.submit(screen.getAllByLabelText('Nuovo compito')[1]);
    await waitFor(() => expect(service.create.mock.calls[0][0]).toMatchObject({ title: 'Telefonare', plannedDate: TODAY, dossierId: null }));
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('checkbox', { name: /Compito a/ })).toBeNull();
    // Folded for the session.
    expect(plannerStore.getState().folded['today:today']).toBe(true);
  });

  it('keeps «Oggi» and its «+ Aggiungi compito» when only late tasks are listed', async () => {
    service.list.mockResolvedValue(answer([task('a', { plannedDate: '2026-10-19' })]));
    renderAt(<TodayView />);
    const today = await screen.findByRole('region', { name: /^Oggi\s*,\s*0 compiti$/ });
    expect(within(today).getByRole('button', { name: 'Aggiungi compito' })).toBeInTheDocument();
  });

  it('groups by dossier when asked, the inbox last, and remembers the choice', async () => {
    service.list.mockResolvedValue(answer([task('a', { plannedDate: TODAY }), task('b', { plannedDate: TODAY, dossierId: 'd1' })]));
    renderAt(<TodayView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Raggruppa: per data' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Per dossier' }));
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Ricorso Rossi, 1 compito', "Lista d'ingresso, 1 compito"]);
    expect(localStorage.getItem('visualex-opus-today-grouping')).toBe('dossier');
    localStorage.removeItem('visualex-opus-today-grouping');
  });

  it("writes a row on two levels: the description in one line, the day in words, the subtasks' count that opens them", async () => {
    service.list.mockResolvedValue(answer([
      task('p', { description: 'Sentire il cliente', plannedDate: '2026-10-23', dossierId: 'd1' }),
      task('s', { parentId: 'p', dossierId: 'd1' }),
    ]));
    renderAt(<InboxView />);
    expect(await screen.findByText('Sentire il cliente')).toBeInTheDocument();
    expect(screen.getByText('venerdì')).toBeInTheDocument();
    // In a list the subtasks wait behind the counter.
    const counter = screen.getByRole('button', { name: '1 sottocompito' });
    expect(counter).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('checkbox', { name: /Compito s/ })).toBeNull();
    fireEvent.click(counter);
    expect(screen.getByRole('checkbox', { name: /Compito s/ })).toBeInTheDocument();
  });
});

describe('the other views', () => {
  it('«Prossimi giorni» draws a block for each day of the week it can show, an empty one too', async () => {
    service.list.mockResolvedValue(answer([task('a', { plannedDate: '2026-10-22', dossierId: 'd1' }), task('b', { dueDate: TODAY })]));
    renderAt(<UpcomingView />);
    await screen.findByRole('list', { name: 'Oggi · martedì 20 ottobre' });
    // 20 October is a Tuesday: Monday has passed; the server's seven days run to Monday 26.
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      '20 ott · Oggi · martedì, 1 compito',
      '21 ott · Domani · mercoledì, 0 compiti',
      '22 ott · giovedì, 1 compito',
      '23 ott · venerdì, 0 compiti',
      '24 ott · sabato, 0 compiti',
      '25 ott · domenica, 0 compiti',
    ]);
    expect(screen.getByText('Termine finale: scade oggi')).toBeInTheDocument();
    // The dossier at the row's right end.
    expect(within(screen.getByRole('list', { name: 'Giovedì 22 ottobre' })).getByRole('link', { name: /Ricorso Rossi/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Aggiungi compito' })).toHaveLength(6);
    // The block names the day: the row does not repeat it.
    expect(within(screen.getByRole('list', { name: 'Giovedì 22 ottobre' })).queryByText(/giovedì/)).toBeNull();
  });

  it('chooses the month from a menu when the seven days span two', async () => {
    service.list.mockResolvedValue({ today: '2026-10-28', tasks: [], truncated: false });
    renderAt(<UpcomingView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mese: ottobre 2026' }));
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual(['ottobre 2026', 'novembre 2026']);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'novembre 2026' }));
    expect(screen.getByRole('button', { name: 'Mese: novembre 2026' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'domenica 1 novembre' })).toHaveAttribute('aria-pressed', 'true');
  });

  it("walks the week's strip: today marked, the days out of reach not chosen, the next week, back to today", async () => {
    service.list.mockResolvedValue(answer([task('m', { plannedDate: '2026-10-26' })]));
    service.create.mockResolvedValue(task('n', { plannedDate: '2026-10-23' }));
    renderAt(<UpcomingView />);
    const strip = await screen.findByRole('list', { name: /^Settimana da lunedì 19 ottobre a domenica 25 ottobre$/ });
    expect(screen.getByText('ottobre 2026')).toBeInTheDocument();
    expect(within(strip).getByRole('button', { name: 'lunedì 19 ottobre' })).toBeDisabled();
    expect(within(strip).getByRole('button', { name: 'martedì 20 ottobre, oggi' })).toHaveAttribute('aria-current', 'date');
    expect(within(strip).getByRole('button', { name: 'martedì 20 ottobre, oggi' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Settimana precedente' })).toBeDisabled();
    // A day of the week: chosen, and its block gets «+ Aggiungi compito» for that day.
    fireEvent.click(within(strip).getByRole('button', { name: 'venerdì 23 ottobre' }));
    expect(within(strip).getByRole('button', { name: 'venerdì 23 ottobre' })).toHaveAttribute('aria-pressed', 'true');
    const friday = screen.getByRole('region', { name: /^23 ott · venerdì/ });
    fireEvent.click(within(friday).getByRole('button', { name: 'Aggiungi compito' }));
    fireEvent.change(within(friday).getByLabelText('Nuovo compito'), { target: { value: 'Udienza' } });
    fireEvent.submit(within(friday).getByLabelText('Nuovo compito'));
    await waitFor(() => expect(service.create.mock.calls[0][0]).toMatchObject({ title: 'Udienza', plannedDate: '2026-10-23' }));
    // Monday 26 is in the server's seven days: said under this week, and its dot on nothing here.
    expect(screen.getByRole('button', { name: /La settimana dopo: 1 compito fino a lunedì 26 ottobre/ })).toBeInTheDocument();
    // The next week: only Monday 26 is in the server's seven days.
    fireEvent.click(screen.getByRole('button', { name: 'Settimana successiva' }));
    expect(screen.getByRole('button', { name: 'lunedì 26 ottobre, 1 compito' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['26 ott · lunedì, 1 compito']);
    expect(screen.getByRole('button', { name: 'Settimana successiva' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Oggi' }));
    expect(screen.getAllByRole('heading', { level: 3 })[0]).toHaveTextContent('20 ott · Oggi · martedì');
  });

  it("the inbox adds a task with no date and no dossier", async () => {
    service.list.mockResolvedValue(answer([]));
    service.create.mockResolvedValue(task('n'));
    renderAt(<InboxView />);
    expect(await screen.findByText("La lista d'ingresso è vuota")).toBeInTheDocument();
    expect(screen.getByText("Senza data · nella lista d'ingresso")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nuovo compito'), { target: { value: '  Chiamare il cliente ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi il compito' }));
    await waitFor(() => expect(service.create).toHaveBeenCalled());
    expect(service.create.mock.calls[0][0]).toMatchObject({ title: 'Chiamare il cliente', plannedDate: null, dueDate: null, dossierId: null, origin: 'lavoro' });
    await waitFor(() => expect(screen.getByLabelText('Nuovo compito')).toHaveValue(''));
  });

  it('the trash restores a task', async () => {
    service.list.mockResolvedValue(answer([task('t', { deletedAt: '2026-10-19T09:00:00.000Z' })]));
    service.restore.mockResolvedValue(task('t'));
    renderAt(<TaskTrashView />);
    fireEvent.click(await screen.findByRole('button', { name: /^Ripristina\s*:\s*Compito t$/ }));
    await waitFor(() => expect(service.restore).toHaveBeenCalledWith('t'));
    expect(plannerStore.getState().notice?.message).toBe('Compito ripristinato');
  });
});
