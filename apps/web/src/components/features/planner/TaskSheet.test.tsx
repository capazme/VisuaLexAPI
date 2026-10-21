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

import { InboxView, TodayView } from './OpusViews';
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
/** The server's answer to a write: the task as sent, a second later. */
const saved = (base: Task) => (_id: string, input: Partial<Task>) => Promise.resolve({ ...base, ...input, updatedAt: '2026-10-01T10:00:01.000Z' });

let toasts: (UndoToast | null)[];
let unregister: () => void;

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
  toasts = [];
  unregister = registerUndoToastListener((t) => toasts.push(t));
});
afterEach(() => {
  unregister();
  toasts[toasts.length - 1]?.onDismiss();
});

async function openSheet(tasks: Task[], title: string, view: 'inbox' | 'today' = 'inbox') {
  service.list.mockResolvedValue(answer(tasks));
  renderAt(view === 'inbox' ? <InboxView /> : <TodayView />);
  fireEvent.click(await screen.findByRole('button', { name: title }));
  return screen.findByRole('dialog', { name: title });
}

describe('the task sheet', () => {
  it('opens over the list with the fields in their order, and none the server does not keep', async () => {
    const sheet = await openSheet([task('a', { priority: 2, labels: ['udienza'] })], 'Compito a');
    const fields = within(sheet).getByRole('complementary', { name: 'Campi del compito' });
    const labels = [...fields.querySelectorAll('label, span[id]')].map((el) => el.textContent);
    expect(labels.filter((text) => ['Dossier', 'Data pianificata', 'Termine finale', 'Priorità', 'Etichette', 'Ripetizione'].includes(text ?? ''))).toEqual([
      'Dossier', 'Data pianificata', 'Termine finale', 'Priorità', 'Etichette', 'Ripetizione',
    ]);
    expect(within(sheet).queryByText(/Promemoria|Assegnatario|Posizione|Commenta/)).toBeNull();
    // The tick says the priority in words, not only in colour.
    expect(within(sheet).getByRole('checkbox', { name: 'Segna come fatto: Compito a, priorità alta' })).toBeInTheDocument();
    expect(within(within(sheet).getByRole('navigation', { name: 'Dove si trova il compito' })).getByText("Lista d'ingresso")).toBeInTheDocument();
    expect(within(sheet).getByText('Udienza')).toBeInTheDocument();
  });

  it('saves the title at Enter, and Esc gives up an edit before it closes', async () => {
    const a = task('a');
    service.update.mockImplementation(saved(a));
    const sheet = await openSheet([a], 'Compito a');
    const title = within(sheet).getByLabelText('Titolo');
    fireEvent.change(title, { target: { value: 'Depositare  la memoria' } });
    fireEvent.keyDown(title, { key: 'Escape' });
    expect(title).toHaveValue('Compito a');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.change(title, { target: { value: 'Depositare  la memoria ' } });
    fireEvent.keyDown(title, { key: 'Enter' });
    fireEvent.blur(title);
    await waitFor(() => expect(service.update).toHaveBeenCalledWith('a', { title: 'Depositare la memoria' }));
    expect(service.update).toHaveBeenCalledTimes(1);
  });

  it('edits the description where it stands, its addresses as links once saved', async () => {
    const a = task('a');
    service.update.mockImplementation(saved(a));
    const sheet = await openSheet([a], 'Compito a');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Aggiungi una descrizione' }));
    const field = within(sheet).getByLabelText('Descrizione');
    fireEvent.change(field, { target: { value: 'Vedi https://example.org/atto.' } });
    fireEvent.blur(field);
    await waitFor(() => expect(service.update).toHaveBeenCalledWith('a', { description: 'Vedi https://example.org/atto.' }));
    expect(await within(sheet).findByRole('link', { name: 'https://example.org/atto' })).toHaveAttribute('href', 'https://example.org/atto');
  });

  it('chooses the priority from a menu of four, the chosen one checked', async () => {
    const a = task('a', { priority: 3 });
    service.update.mockImplementation(saved(a));
    const sheet = await openSheet([a], 'Compito a');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Priorità: Media' }));
    const items = within(sheet).getAllByRole('menuitemradio');
    expect(items.map((item) => item.textContent)).toEqual(['Urgente', 'Alta', 'Media', 'Normale']);
    expect(items[2]).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(items[0]);
    await waitFor(() => expect(service.update).toHaveBeenCalledWith('a', { priority: 1 }));
    expect(within(sheet).getByRole('button', { name: 'Priorità: Urgente' })).toBeInTheDocument();
  });

  it("moves the task to a dossier found by its title, with that dossier's kind as its origin", async () => {
    const a = task('a');
    service.update.mockImplementation(saved(a));
    const sheet = await openSheet([a], 'Compito a');
    fireEvent.click(within(sheet).getByRole('button', { name: "Dossier Lista d'ingresso" }));
    const search = within(sheet).getByRole('combobox', { name: 'Cerca un dossier' });
    fireEvent.change(search, { target: { value: 'esame' } });
    expect(within(within(sheet).getByRole('listbox', { name: 'Dossier' })).getAllByRole('option').map((o) => o.textContent)).toEqual(['Esame di diritto civile']);
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(service.update).toHaveBeenCalledWith('a', { dossierId: 'd2', origin: 'studio' }));
  });

  it('adds a label at Enter and takes one off', async () => {
    const a = task('a', { labels: ['udienza'] });
    service.update.mockImplementation(saved(a));
    const sheet = await openSheet([a], 'Compito a');
    const field = within(sheet).getByLabelText('Etichette');
    fireEvent.change(field, { target: { value: 'da fatturare' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(service.update).toHaveBeenCalledWith('a', { labels: ['udienza', 'da fatturare'] }));
    fireEvent.click(within(sheet).getByRole('button', { name: "Togli l'etichetta Udienza" }));
    await waitFor(() => expect(service.update).toHaveBeenLastCalledWith('a', { labels: ['da fatturare'] }));
  });

  it("puts a field back and says why in the server's words when a change is refused", async () => {
    const a = task('a', { plannedDate: TODAY });
    service.update.mockRejectedValue({ status: 400, message: 'Una data va scritta AAAA-MM-GG (dal 1900 al 2199).' });
    const sheet = await openSheet([a], 'Compito a', 'today');
    const day = within(sheet).getByLabelText('Data pianificata');
    fireEvent.change(day, { target: { value: '2026-10-22' } });
    // Saved when the field is left, not while it is typed.
    expect(service.update).not.toHaveBeenCalled();
    fireEvent.blur(day);
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Una data va scritta');
    await waitFor(() => expect(day).toHaveValue(TODAY));
  });

  it('refuses before sending what the server would refuse: a repeating task keeps its planned date', async () => {
    const a = task('a', { plannedDate: TODAY, recurrence: 'FREQ=WEEKLY' });
    const sheet = await openSheet([a], 'Compito a', 'today');
    expect(within(sheet).getByLabelText('Termine finale')).toBeDisabled();
    const day = within(sheet).getByLabelText('Data pianificata');
    fireEvent.change(day, { target: { value: '' } });
    fireEvent.blur(day);
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Una ripetizione richiede la data pianificata.');
    expect(service.update).not.toHaveBeenCalled();
    expect(day).toHaveValue(TODAY);
  });

  it('lists the open subtasks, adds one, and opens one in the sheet with its parent in the path', async () => {
    const p = task('p', { dossierId: 'd1', plannedDate: TODAY });
    const s = task('s', { parentId: 'p', dossierId: 'd1' });
    service.create.mockResolvedValue(task('s2', { parentId: 'p' }));
    const sheet = await openSheet([p, s], 'Compito p', 'today');
    expect(await within(sheet).findByRole('button', { name: 'Compito s' })).toBeInTheDocument();
    expect(service.list).toHaveBeenCalledWith('dossier', 'd1');
    expect(within(sheet).getByText('1 da fare')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Aggiungi un sottocompito' }));
    fireEvent.change(within(sheet).getByLabelText('Nuovo sottocompito'), { target: { value: 'Bozza' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Aggiungi il sottocompito' }));
    await waitFor(() => expect(service.create).toHaveBeenCalledWith({ title: 'Bozza', parentId: 'p', origin: 'lavoro' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Compito s' }));
    const sub = await screen.findByRole('dialog', { name: 'Compito s' });
    fireEvent.click(within(sub).getByRole('button', { name: 'Compito principale: Compito p' }));
    expect(await screen.findByRole('dialog', { name: 'Compito p' })).toBeInTheDocument();
  });

  it('hands the focus to the next subtask when one is ticked, then to the field', async () => {
    const p = task('p');
    const tasks = [p, task('s1', { parentId: 'p' }), task('s2', { parentId: 'p' })];
    service.complete.mockResolvedValue({ task: p, recurred: null });
    const sheet = await openSheet(tasks, 'Compito p');
    const first = await within(sheet).findByRole('checkbox', { name: 'Segna come fatto: Compito s1' });
    // What the server lists once s1 is done.
    service.list.mockResolvedValue(answer([p, task('s2', { parentId: 'p' })]));
    first.focus();
    fireEvent.click(first);
    expect(within(sheet).getByRole('checkbox', { name: 'Segna come fatto: Compito s2' })).toHaveFocus();
    await waitFor(() => expect(within(sheet).queryByRole('checkbox', { name: 'Segna come fatto: Compito s1' })).toBeNull());
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Segna come fatto: Compito s2' }));
    await waitFor(() => expect(within(sheet).getByLabelText('Nuovo sottocompito')).toHaveFocus());
  });

  it('steps to the task before and after it in the view, with the arrows and with j and k, and gives the focus back to its row', async () => {
    const tasks = [task('a', { plannedDate: '2026-10-19' }), task('b', { plannedDate: TODAY }), task('c', { plannedDate: TODAY })];
    const sheet = await openSheet(tasks, 'Compito a', 'today');
    expect(within(sheet).getByRole('button', { name: 'Compito precedente' })).toBeDisabled();
    // From «In ritardo» into «Oggi»: the view's rows are one sequence.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Compito successivo' }));
    expect(await screen.findByRole('dialog', { name: 'Compito b' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog').querySelector('[tabindex="-1"]')!, { key: 'j' });
    const last = await screen.findByRole('dialog', { name: 'Compito c' });
    expect(within(last).getByRole('button', { name: 'Compito successivo' })).toBeDisabled();
    // A j typed in a field is a letter.
    fireEvent.keyDown(within(last).getByLabelText('Titolo'), { key: 'k' });
    expect(screen.getByRole('dialog', { name: 'Compito c' })).toBeInTheDocument();
    fireEvent.keyDown(last.querySelector('[tabindex="-1"]')!, { key: 'k' });
    expect(await screen.findByRole('dialog', { name: 'Compito b' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Compito b' })).toHaveFocus());
  });

  it('puts a refused title back', async () => {
    const a = task('a');
    service.update.mockRejectedValue({ status: 400, message: 'Il testo contiene un carattere non valido.' });
    const sheet = await openSheet([a], 'Compito a');
    const title = within(sheet).getByLabelText('Titolo');
    fireEvent.focus(title);
    fireEvent.change(title, { target: { value: 'Nuovo titolo' } });
    fireEvent.blur(title);
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('carattere non valido');
    await waitFor(() => expect(title).toHaveValue('Compito a'));
  });

  it('sends one write at a time, the changes made meanwhile together after it', async () => {
    const a = task('a');
    let land!: (value: Task) => void;
    service.update.mockReturnValueOnce(new Promise((r) => (land = r))).mockImplementation(saved(a));
    const sheet = await openSheet([a], 'Compito a');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Priorità: Normale' }));
    fireEvent.click(within(sheet).getByRole('menuitemradio', { name: 'Urgente' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Priorità: Urgente' }));
    fireEvent.click(within(sheet).getByRole('menuitemradio', { name: 'Alta' }));
    const labels = within(sheet).getByLabelText('Etichette');
    fireEvent.change(labels, { target: { value: 'udienza' } });
    fireEvent.keyDown(labels, { key: 'Enter' });
    expect(service.update).toHaveBeenCalledTimes(1);
    await act(async () => land({ ...a, priority: 1, updatedAt: '2026-10-01T10:00:01.000Z' }));
    await waitFor(() => expect(service.update).toHaveBeenCalledTimes(2));
    expect(service.update.mock.calls[1]).toEqual(['a', { priority: 2, labels: ['udienza'] }]);
    expect(within(sheet).getByRole('button', { name: 'Priorità: Alta' })).toBeInTheDocument();
  });

  it('keeps a task moved out of the inbox current in its sheet', async () => {
    const a = task('a');
    service.update.mockImplementation(saved(a));
    const sheet = await openSheet([a], 'Compito a');
    // What the inbox lists once the task has gone to a dossier.
    service.list.mockResolvedValue(answer([]));
    fireEvent.click(within(sheet).getByRole('button', { name: "Dossier Lista d'ingresso" }));
    fireEvent.keyDown(within(sheet).getByRole('combobox', { name: 'Cerca un dossier' }), { key: 'ArrowDown' });
    fireEvent.keyDown(within(sheet).getByRole('combobox', { name: 'Cerca un dossier' }), { key: 'Enter' });
    await waitFor(() => expect(service.update).toHaveBeenCalledWith('a', { dossierId: 'd2', origin: 'studio' }));
    const path = within(screen.getByRole('dialog', { name: 'Compito a' })).getByRole('navigation', { name: 'Dove si trova il compito' });
    await waitFor(() => expect(within(path).getByRole('link', { name: 'Esame di diritto civile' })).toBeInTheDocument());
  });

  it('opened from «Aggiungi un sottocompito», gives the field the focus, and the next task does not inherit it', async () => {
    service.list.mockResolvedValue(answer([task('a'), task('b')]));
    renderAt(<InboxView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Azioni: Compito a' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Aggiungi un sottocompito' }));
    const sheet = await screen.findByRole('dialog', { name: 'Compito a' });
    await waitFor(() => expect(within(sheet).getByLabelText('Nuovo sottocompito')).toHaveFocus());
    // The focus never goes behind the sheet while it moves on (the window's 50 ms of first focus included).
    const seen: (Element | null)[] = [];
    const watch = () => seen.push(document.activeElement);
    document.addEventListener('focus', watch, true);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Compito successivo' }));
    const next = await screen.findByRole('dialog', { name: 'Compito b' });
    expect(within(next).queryByLabelText('Nuovo sottocompito')).toBeNull();
    await act(() => new Promise((resolve) => setTimeout(resolve, 120)));
    document.removeEventListener('focus', watch, true);
    expect(seen.filter((el) => !next.contains(el))).toEqual([]);
    expect(next.contains(document.activeElement)).toBe(true);
    expect(within(next).getByRole('button', { name: 'Aggiungi un sottocompito' })).toBeInTheDocument();
  });

  it('ticks a repeating task from the sheet with its occurrence, and «Annulla» puts its date back', async () => {
    const weekly = task('w', { plannedDate: TODAY, recurrence: 'FREQ=WEEKLY' });
    service.complete.mockResolvedValue({ task: weekly, recurred: { previousPlannedDate: TODAY, plannedDate: '2026-10-27' } });
    service.update.mockResolvedValue(weekly);
    const sheet = await openSheet([weekly], 'Compito w', 'today');
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Segna come fatto: Compito w' }));
    await waitFor(() => expect(service.complete).toHaveBeenCalledWith('w', TODAY));
    await waitFor(() => expect(toasts[toasts.length - 1]?.message).toBe('Fatto: torna mar 27 ott'));
    await act(async () => toasts[toasts.length - 1]!.onUndo());
    expect(service.update).toHaveBeenCalledWith('w', { plannedDate: TODAY });
  });

  it('gives up a date or a label not saved at the first Esc, and closes at the second', async () => {
    const a = task('a', { plannedDate: TODAY });
    const sheet = await openSheet([a], 'Compito a', 'today');
    const day = within(sheet).getByLabelText('Data pianificata');
    fireEvent.change(day, { target: { value: '2026-10-25' } });
    fireEvent.keyDown(day, { key: 'Escape' });
    expect(day).toHaveValue(TODAY);
    expect(screen.getByRole('dialog', { name: 'Compito a' })).toBeInTheDocument();
    const labels = within(sheet).getByLabelText('Etichette');
    fireEvent.change(labels, { target: { value: 'udienza' } });
    fireEvent.keyDown(labels, { key: 'Escape' });
    expect(labels).toHaveValue('');
    expect(screen.getByRole('dialog', { name: 'Compito a' })).toBeInTheDocument();
    // Nothing typed is pending: this Esc closes.
    fireEvent.keyDown(labels, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(service.update).not.toHaveBeenCalled();
  });

  it('ticks the task from the sheet, which closes', async () => {
    const a = task('a');
    service.complete.mockResolvedValue({ task: a, recurred: null });
    const sheet = await openSheet([a, task('b')], 'Compito a');
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Segna come fatto: Compito a' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(service.complete).toHaveBeenCalledWith('a', undefined));
    await waitFor(() => expect(toasts[toasts.length - 1]?.message).toBe('Compito completato'));
    await act(async () => {});
  });
});
