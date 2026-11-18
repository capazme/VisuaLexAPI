import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../services/taskService', () => ({ taskService: { create: vi.fn() } }));

import { taskService } from '../../../services/taskService';
import type { Task } from '../../../types/tasks';
import example from './__fixtures__/todoist-esempio.csv?raw';
import { TodoistImport } from './TodoistImport';

const TODAY = '2026-11-17';

function chooseFile(text: string) {
  const file = new File([text], 'Pratica.csv', { type: 'text/csv', lastModified: 1 });
  // jsdom's Blob has no text().
  Object.defineProperty(file, 'text', { value: async () => text });
  fireEvent.change(screen.getByLabelText('Importa da Todoist (CSV)'), { target: { files: [file] } });
}

describe('TodoistImport', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.mocked(taskService.create).mockReset();
  });

  it('previews the file, stops halfway, then resumes without creating a task twice', async () => {
    const create = vi.mocked(taskService.create);
    let calls = 0;
    create.mockImplementation(async (input) => {
      calls++;
      if (calls === 4) throw new Error('rete');
      return { id: `t${calls}`, title: input.title } as Task;
    });
    render(<TodoistImport id="imp" open onClose={() => {}} dossierId="d1" today={TODAY} />);

    chooseFile(example);
    expect(await screen.findByText(/Nasceranno 13 compiti, di cui 3 sottocompiti, con 2 etichette/)).toBeInTheDocument();
    expect(screen.getByText(/Date non capite/)).toBeInTheDocument();
    expect(screen.getByText(/Ripetizioni che diventano compiti non ricorrenti/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Importa 13 compiti' }));
    expect(await screen.findByText(/Import interrotto: 3 compiti entrati su 13/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Riprova: 10 compiti da importare' }));
    expect(await screen.findByText(/Import completato: 13 compiti entrati/)).toBeInTheDocument();
    // 3 created, 1 failed, then the 10 left: each title once among the successful calls.
    expect(create).toHaveBeenCalledTimes(14);
    const titles = create.mock.calls.map(([input]) => input.title);
    expect(new Set(titles).size).toBe(13);
    await waitFor(() => expect(screen.queryByRole('button', { name: /Importa|Riprova/ })).not.toBeInTheDocument());
  });

  it('resumes after a reload in the same dossier, and starts afresh in another one', async () => {
    const create = vi.mocked(taskService.create);
    let calls = 0;
    create.mockImplementation(async (input) => {
      calls++;
      if (calls === 3) throw new Error('rete');
      return { id: `t${calls}`, title: input.title } as Task;
    });
    const first = render(<TodoistImport id="imp" open onClose={() => {}} dossierId="d1" today={TODAY} />);
    chooseFile(example);
    fireEvent.click(await screen.findByRole('button', { name: 'Importa 13 compiti' }));
    expect(await screen.findByText(/Import interrotto: 2 compiti entrati su 13/)).toBeInTheDocument();
    first.unmount();

    // The page reloaded: the same file in the same dossier goes on from the third task.
    const again = render(<TodoistImport id="imp" open onClose={() => {}} dossierId="d1" today={TODAY} />);
    chooseFile(example);
    expect(await screen.findByRole('button', { name: 'Importa 11 compiti' })).toBeInTheDocument();
    again.unmount();

    render(<TodoistImport id="imp" open onClose={() => {}} dossierId="d2" today={TODAY} />);
    chooseFile(example);
    expect(await screen.findByRole('button', { name: 'Importa 13 compiti' })).toBeInTheDocument();
  });

  it('says so for a file that is not a Todoist export', async () => {
    render(<TodoistImport id="imp" open onClose={() => {}} dossierId="d1" today={TODAY} />);
    chooseFile('nome,cognome\nA,B');
    expect(await screen.findByRole('alert')).toHaveTextContent('non sembra un CSV esportato da Todoist');
  });
});
