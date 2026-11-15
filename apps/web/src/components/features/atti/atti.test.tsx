import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const atti = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
const dossiers = vi.hoisted(() => ({ getAll: vi.fn(), getById: vi.fn() }));

vi.mock('../../../services/attiService', async (original) => ({ ...(await original<object>()), attiService: atti }));
vi.mock('../../../services/dossierService', () => ({ dossierService: dossiers }));
// «Analizza documento»'s reader has its own tests: here a file's «text» is its name's, and a PDF is refused.
vi.mock('../documents/documentFile', () => ({
  readDocumentFile: async (file: File) =>
    /\.pdf$/i.test(file.name) ? { ok: false, error: 'I PDF non si leggono.' } : { ok: true, text: `Testo di ${file.name}` },
}));

import { AttiListView } from './AttiListView';
import { AttoEditor } from './AttoEditor';
import { DossierAttiPanel } from './DossierAttiPanel';
import { SAVE_DELAY_MS, changedOn } from './attiText';

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function SentState() {
  return <span data-testid="sent">{JSON.stringify(useLocation().state)}</span>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/work/atti" element={<AttiListView />} />
        <Route path="/work/atti/:id" element={<AttoEditor />} />
      </Routes>
    </MemoryRouter>,
  );
}

const ATTO = { id: 'a1', titolo: 'Atto di appello', tipo: 'Atto di appello', testo: 'Primo motivo.', stato: 'bozza', dossierId: 'd1', createdAt: '2026-11-15T20:00:00Z', updatedAt: '2026-11-15T20:00:00Z' };
const DOSSIER = {
  id: 'd1',
  name: 'Pratica 2026/14',
  kind: 'lavoro',
  is_pinned: false,
  created_at: '',
  updated_at: '',
  items: [
    { id: 'i1', item_type: 'norm', title: 'Art. 2043', citation: 'art. 2043 c.c.' },
    { id: 'i2', item_type: 'note', title: 'Nota', content: 'Verificare l’ingiustizia del danno.' },
    { id: 'i3', item_type: 'sentenza', title: 'Cass. civ., sez. un., n. 34318/2023', citation: null },
  ],
};

beforeEach(() => {
  Object.values(atti).forEach((fn) => fn.mockReset());
  dossiers.getAll.mockResolvedValue([DOSSIER, { ...DOSSIER, id: 'd2', name: 'Studio', kind: 'studio', items: [] }]);
  dossiers.getById.mockResolvedValue(DOSSIER);
});
afterEach(() => vi.useRealTimers());

describe('AttiListView', () => {
  it('lists the acts with their kind, dossier and state, and opens one', async () => {
    atti.list.mockResolvedValue([ATTO, { ...ATTO, id: 'a2', titolo: 'Diffida', tipo: null, dossierId: null, stato: 'finale' }]);
    renderAt('/work/atti');
    const first = await screen.findByRole('link', { name: /Atto di appello/ });
    expect(first).toHaveTextContent('Pratica 2026/14');
    expect(first).toHaveTextContent('Bozza');
    expect(screen.getByRole('link', { name: /Diffida/ })).toHaveTextContent('Finale');
    expect(first).toHaveAttribute('href', '/work/atti/a1');
  });

  it('offers the work dossiers only, creates the act and opens it', async () => {
    atti.list.mockResolvedValue([]);
    atti.create.mockResolvedValue({ ...ATTO, id: 'nuovo' });
    atti.get.mockResolvedValue({ ...ATTO, id: 'nuovo' });
    renderAt('/work/atti');
    expect(await screen.findByText(/Non hai ancora atti/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Pratica 2026/14' })).toBeInTheDocument());
    expect(screen.queryByRole('option', { name: 'Studio' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Titolo'), { target: { value: '  Appello  ' } });
    fireEvent.change(screen.getByLabelText('Dossier'), { target: { value: 'd1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crea e apri' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/work/atti/nuovo'));
    expect(atti.create).toHaveBeenCalledWith({ titolo: 'Appello', tipo: null, dossierId: 'd1' });
  });

  it('asks for a title before creating, and says why a creation failed', async () => {
    atti.list.mockResolvedValue([]);
    atti.create.mockRejectedValue({ status: 404, message: 'Dossier non trovato.' });
    renderAt('/work/atti');
    await screen.findByText(/Non hai ancora atti/);
    fireEvent.click(screen.getByRole('button', { name: 'Crea e apri' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Scrivi il titolo');
    expect(atti.create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Titolo'), { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crea e apri' }));
    expect(await screen.findByText('Dossier non trovato.')).toBeInTheDocument();
  });

  it('says a failed read and reads again on «Riprova»', async () => {
    atti.list.mockRejectedValueOnce({ message: 'Errore del server. Riprova tra poco.' }).mockResolvedValueOnce([ATTO]);
    renderAt('/work/atti');
    expect(await screen.findByText('Errore del server. Riprova tra poco.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByRole('link', { name: /Atto di appello/ })).toBeInTheDocument();
  });

  it('writes the year only for another year', () => {
    const now = new Date('2026-11-15T12:00:00Z');
    expect(changedOn('2026-03-02T12:00:00Z', now)).toBe('2 marzo');
    expect(changedOn('2025-03-02T12:00:00Z', now)).toBe('2 marzo 2025');
  });
});

describe('AttoEditor', () => {
  it('saves the text by itself after a pause, once for many keystrokes', async () => {
    atti.get.mockResolvedValue(ATTO);
    atti.update.mockImplementation(async (_id, input) => ({ ...ATTO, ...input }));
    renderAt('/work/atti/a1');
    fireEvent.click(await screen.findByRole('button', { name: 'Modifica il testo' }));
    const text = screen.getByLabelText('Testo dell’atto');
    vi.useFakeTimers();
    fireEvent.change(text, { target: { value: 'Primo motivo. Secondo' } });
    fireEvent.change(text, { target: { value: 'Primo motivo. Secondo motivo.' } });
    expect(screen.getByRole('status')).toHaveTextContent('Salvataggio…');
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DELAY_MS);
    });
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Salvato alle/));
    expect(atti.update).toHaveBeenCalledTimes(1);
    expect(atti.update).toHaveBeenCalledWith('a1', expect.objectContaining({ testo: 'Primo motivo. Secondo motivo.', titolo: 'Atto di appello' }));
  });

  it('keeps a failed save on screen and saves again on «Riprova»', async () => {
    atti.get.mockResolvedValue(ATTO);
    atti.update.mockRejectedValueOnce({ message: 'Troppe richieste in poco tempo. Riprova più tardi.' }).mockResolvedValueOnce(ATTO);
    renderAt('/work/atti/a1');
    const title = await screen.findByLabelText('Titolo dell’atto');
    fireEvent.change(title, { target: { value: 'Appello' } });
    fireEvent.blur(title);
    expect(await screen.findByText('Troppe richieste in poco tempo. Riprova più tardi.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Salvato alle/));
    expect(atti.update).toHaveBeenLastCalledWith('a1', expect.objectContaining({ titolo: 'Appello' }));
  });

  it('does not save an empty title', async () => {
    atti.get.mockResolvedValue(ATTO);
    renderAt('/work/atti/a1');
    const title = await screen.findByLabelText('Titolo dell’atto');
    fireEvent.change(title, { target: { value: '  ' } });
    fireEvent.blur(title);
    expect(await screen.findByRole('status')).toHaveTextContent('Il titolo è obbligatorio');
    expect(atti.update).not.toHaveBeenCalled();
  });

  it('lists the dossier’s norms and decisions, and «Cita» writes one where the cursor is', async () => {
    atti.get.mockResolvedValue({ ...ATTO, testo: 'Visto e considerato' });
    atti.update.mockResolvedValue(ATTO);
    renderAt('/work/atti/a1');
    expect(await screen.findByText('art. 2043 c.c.')).toBeInTheDocument();
    // Reading: the sources are there, «Cita» only once the text is open to a correction.
    expect(screen.queryByRole('button', { name: /^Cita/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Modifica il testo' }));
    const text = screen.getByLabelText('Testo dell’atto') as HTMLTextAreaElement;
    expect(screen.getByRole('button', { name: 'Cita Cass. civ., sez. un., n. 34318/2023' })).toBeInTheDocument();
    expect(screen.queryByText('Cita Una nota')).toBeNull();
    text.setSelectionRange(5, 5);
    fireEvent.click(screen.getByRole('button', { name: 'Cita art. 2043 c.c.' }));
    expect(text.value).toBe('Vistoart. 2043 c.c. e considerato');
  });

  it('deletes only after the confirmation, and goes back to the list', async () => {
    atti.get.mockResolvedValue(ATTO);
    atti.remove.mockResolvedValue(undefined);
    atti.list.mockResolvedValue([]);
    renderAt('/work/atti/a1');
    // Not among the page's buttons: in the «⋯» menu, last.
    expect(await screen.findByRole('button', { name: 'Altre azioni sull’atto' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Elimina/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Altre azioni sull’atto' }));
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Carica una nuova versione', 'Copia il testo', 'Scarica in .txt', 'Elimina l’atto']);
    fireEvent.click(items.at(-1)!);
    expect(atti.remove).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Non si può annullare');
    fireEvent.click(screen.getByRole('button', { name: 'Elimina' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/work\/atti$/));
    expect(atti.remove).toHaveBeenCalledWith('a1');
  });

  it('says an act that cannot be opened', async () => {
    atti.get.mockRejectedValue({ status: 404, message: 'Atto non trovato.' });
    renderAt('/work/atti/zz');
    expect(await screen.findByRole('alert')).toHaveTextContent('Atto non trovato.');
    expect(screen.getByRole('link', { name: 'Tutti gli atti' })).toHaveAttribute('href', '/work/atti');
  });

  it('opens an act with a text to read, with the dossier’s notes beside it and the way back to the dossier’s acts', async () => {
    atti.get.mockResolvedValue({ ...ATTO, testo: 'Primo motivo.\n\nSecondo motivo.' });
    renderAt('/work/atti/a1');
    const article = await screen.findByRole('article', { name: 'Testo dell’atto' });
    // As written, line for line (the same lines as in «Modifica il testo»).
    expect(article).toHaveTextContent('Primo motivo. Secondo motivo.');
    expect(screen.queryByRole('textbox', { name: 'Testo dell’atto' })).toBeNull();
    expect(await screen.findByText('Verificare l’ingiustizia del danno.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Atti del dossier' })).toHaveAttribute('href', '/dossier?dossier=d1&vista=atti');
  });

  it('«Analizza l’atto» opens «Analizza documento» with the act’s text', async () => {
    atti.get.mockResolvedValue(ATTO);
    render(
      <MemoryRouter initialEntries={['/work/atti/a1']}>
        <Routes>
          <Route path="/work/atti/:id" element={<AttoEditor />} />
          <Route path="/documents" element={<SentState />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Analizza l’atto' }));
    expect(await screen.findByTestId('sent')).toHaveTextContent(JSON.stringify({ atto: { id: 'a1', titolo: 'Atto di appello', testo: 'Primo motivo.' } }));
  });

  it('opens an empty act to be written', async () => {
    atti.get.mockResolvedValue({ ...ATTO, testo: '' });
    renderAt('/work/atti/a1');
    expect(await screen.findByRole('textbox', { name: 'Testo dell’atto' })).toBeInTheDocument();
  });

  it('replaces the text with a new version from its file, after the confirmation', async () => {
    atti.get.mockResolvedValue(ATTO);
    atti.update.mockImplementation(async (_id, input) => ({ ...ATTO, ...input }));
    const { container } = renderAt('/work/atti/a1');
    await screen.findByRole('article', { name: 'Testo dell’atto' });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['Testo della versione 3.'], 'appello v3.txt', { type: 'text/plain' })] } });
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('appello v3.txt');
    expect(atti.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sostituisci' }));
    expect(await screen.findByText('Testo di appello v3.txt')).toBeInTheDocument();
    fireEvent.blur(screen.getByLabelText('Titolo dell’atto'));
    await waitFor(() => expect(atti.update).toHaveBeenCalledWith('a1', expect.objectContaining({ testo: 'Testo di appello v3.txt' })));
  });
});

describe('DossierAttiPanel', () => {
  function renderPanel() {
    return render(
      <MemoryRouter initialEntries={['/dossier']}>
        <Where />
        <Routes>
          <Route path="/dossier" element={<DossierAttiPanel dossierId="d1" />} />
          <Route path="/work/atti/:id" element={<span>editor</span>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('lists the dossier’s acts only', async () => {
    atti.list.mockResolvedValue([ATTO]);
    renderPanel();
    expect(await screen.findByRole('link', { name: /Atto di appello/ })).toHaveAttribute('href', '/work/atti/a1');
    expect(atti.list).toHaveBeenCalledWith('d1');
  });

  it('loads an act from its file into the dossier and opens it', async () => {
    atti.list.mockResolvedValue([]);
    atti.create.mockResolvedValue({ ...ATTO, id: 'caricato' });
    const { container } = renderPanel();
    await screen.findByText('Questo dossier non ha ancora atti.');
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['Atto in prova.'], 'Atto di citazione.txt', { type: 'text/plain' })] } });
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/work/atti/caricato'));
    expect(atti.create).toHaveBeenCalledWith({ titolo: 'Atto di citazione', testo: 'Testo di Atto di citazione.txt', dossierId: 'd1' });
  });

  it('refuses a PDF, saying why, and creates nothing', async () => {
    atti.list.mockResolvedValue([]);
    const { container } = renderPanel();
    await screen.findByText('Questo dossier non ha ancora atti.');
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['%PDF'], 'atto.pdf', { type: 'application/pdf' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('PDF');
    expect(atti.create).not.toHaveBeenCalled();
  });
});
