import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const files = vi.hoisted(() => ({
  list: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  trash: vi.fn(),
  restore: vi.fn(),
  remove: vi.fn(),
  getIstruzioni: vi.fn(),
  saveIstruzioni: vi.fn(),
}));
const atti = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn() }));
const saved = vi.hoisted(() => ({ saveBlob: vi.fn() }));

vi.mock('../../../services/praticaFilesService', async (original) => ({ ...(await original<object>()), praticaFilesService: files }));
vi.mock('../../../services/attiService', async (original) => ({ ...(await original<object>()), attiService: atti }));
vi.mock('../../../utils/saveBlob', () => saved);

import { DossierAttiPanel } from './DossierAttiPanel';
import { OldAttoRedirect } from './OldAttoRedirect';
import { SAVE_DELAY_MS } from './attiText';
import { readDocxBytes } from '../documents/docx/readDocxPackage';
import { memoryStorage } from '../../../test/memoryStorage';

const NOTICE_KEY = 'visualex.atti.avviso-visto';

const ORIGINAL = {
  id: 'f1', dossierId: 'd1', nome: 'Citazione.pdf', mime: 'application/pdf', peso: 250_000, versione: 1, versioneDi: null,
  autore: 'utente', createdAt: '2026-11-10T10:00:00Z', updatedAt: '2026-11-10T10:00:00Z', deletedAt: null,
};
const VERSION = {
  ...ORIGINAL, id: 'f2', nome: 'Citazione v2.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  versione: 2, versioneDi: 'f1', autore: 'claude', createdAt: '2026-11-16T09:00:00Z', updatedAt: '2026-11-16T09:00:00Z',
};
const OTHER = { ...ORIGINAL, id: 'f3', nome: 'Procura.pdf', createdAt: '2026-11-12T10:00:00Z', updatedAt: '2026-11-12T10:00:00Z' };
const TRASHED = { ...ORIGINAL, id: 'f9', nome: 'Vecchio.txt', mime: 'text/plain', deletedAt: '2026-11-16T10:00:00Z' };

function renderPanel() {
  return render(<MemoryRouter><DossierAttiPanel dossierId="d1" /></MemoryRouter>);
}

function pick(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

const pdf = (name = 'Atto.pdf', size = 10) => new File([new Uint8Array(size)], name, { type: 'application/pdf' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('localStorage', memoryStorage());
  files.list.mockResolvedValue({ files: [{ ...ORIGINAL, versioni: [VERSION] }, { ...OTHER, versioni: [] }], cestino: [TRASHED] });
  files.getIstruzioni.mockResolvedValue('');
  files.saveIstruzioni.mockResolvedValue(undefined);
  files.upload.mockResolvedValue(ORIGINAL);
  files.trash.mockResolvedValue(undefined);
  files.restore.mockResolvedValue(undefined);
  files.remove.mockResolvedValue(undefined);
  atti.list.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the dossier\'s «Atti» tab (LC53)', () => {
  it('has three parts, in this order, with written headings and the limits beside the upload', async () => {
    renderPanel();
    const headings = (await screen.findAllByRole('heading', { level: 3 })).map((h) => h.textContent);
    expect(headings).toEqual(['Istruzioni per Claude', 'File', 'Carica un file']);
    expect(screen.getByText('Claude le legge per prime quando lavora su questa pratica.')).toBeInTheDocument();
    expect(screen.getByText('Fino a 25 MB per file. PDF, Word, ODT, RTF, TXT, JPG, PNG.')).toBeInTheDocument();
  });

  it('saves the instructions by itself and says «Salvato»', async () => {
    renderPanel();
    const box = await screen.findByRole('textbox', { name: 'Istruzioni per Claude' });
    vi.useFakeTimers();
    fireEvent.change(box, { target: { value: 'Cita solo la Cassazione.' } });
    expect(files.saveIstruzioni).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(SAVE_DELAY_MS); });
    expect(files.saveIstruzioni).toHaveBeenCalledWith('d1', 'Cita solo la Cassazione.');
    vi.useRealTimers();
    expect(await screen.findByText('Salvato')).toBeInTheDocument();
  });

  it('«Grassetto» and «Elenco» write the Markdown into the instructions', async () => {
    renderPanel();
    const box = (await screen.findByRole('textbox', { name: 'Istruzioni per Claude' })) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'importante' } });
    box.setSelectionRange(0, 10);
    fireEvent.click(screen.getByRole('button', { name: 'Grassetto' }));
    expect(box.value).toBe('**importante**');
    box.setSelectionRange(0, 0);
    fireEvent.click(screen.getByRole('button', { name: 'Elenco' }));
    expect(box.value).toBe('- **importante**');
  });

  it('lists the files, the last changed first, with the versions under the original and who wrote them', async () => {
    renderPanel();
    const list = await screen.findByRole('list', { name: 'File della pratica' });
    const rows = within(list).getAllByRole('listitem').filter((li) => li.parentElement === list);
    expect(rows.map((row) => within(row).getAllByText(/\.(pdf|docx)$/)[0].textContent)).toEqual(['Citazione.pdf', 'Procura.pdf']);
    expect(within(rows[0]).getByText(/versione 2, scritta da Claude, il 16 novembre/)).toBeInTheDocument();
    expect(within(rows[1]).getByText(/PDF · 250 KB · caricato da te il 12 novembre/)).toBeInTheDocument();
    for (const label of ['Scarica', 'Carica una versione nuova', 'Sposta nel cestino']) {
      expect(within(rows[1]).getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('«Scarica» saves the file under its name', async () => {
    const blob = new Blob(['x']);
    files.download.mockResolvedValue(blob);
    renderPanel();
    const list = await screen.findByRole('list', { name: 'File della pratica' });
    fireEvent.click(within(list).getAllByRole('button', { name: /^Scarica/ })[0]);
    await waitFor(() => expect(saved.saveBlob).toHaveBeenCalledWith(blob, 'Citazione.pdf'));
    expect(files.download).toHaveBeenCalledWith('d1', 'f1');
  });

  it('the first upload shows the notice, with the test line; the next ones do not', async () => {
    renderPanel();
    await screen.findByRole('list', { name: 'File della pratica' });
    pick(pdf());
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('I file che carichi restano sul server di LexCraft, cifrati. Nell\'app li vedi solo tu; chi gestisce il server, se serve, può accedervi. Se li fai leggere a Claude, il loro testo arriva al modello che usi.');
    expect(dialog).toHaveTextContent('È una prova: non caricare atti veri di clienti.');
    expect(files.upload).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ho capito, carica' }));
    await waitFor(() => expect(files.upload).toHaveBeenCalledWith('d1', expect.any(File), undefined));
    expect(localStorage.getItem(NOTICE_KEY)).toBe('1');

    pick(pdf('Secondo.pdf'));
    await waitFor(() => expect(files.upload).toHaveBeenCalledTimes(2));
    // The first dialog may still be closing: none stays, and none opens again.
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('«Annulla» on the notice uploads nothing and asks again next time', async () => {
    renderPanel();
    await screen.findByRole('list', { name: 'File della pratica' });
    pick(pdf());
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Annulla' }));
    expect(files.upload).not.toHaveBeenCalled();
    expect(localStorage.getItem(NOTICE_KEY)).toBeNull();
  });

  it('«Carica una versione nuova» uploads under that file', async () => {
    localStorage.setItem(NOTICE_KEY, '1');
    renderPanel();
    const list = await screen.findByRole('list', { name: 'File della pratica' });
    fireEvent.click(within(list).getAllByRole('button', { name: /Carica una versione nuova/ })[0]);
    pick(pdf());
    await waitFor(() => expect(files.upload).toHaveBeenCalledWith('d1', expect.any(File), 'f1'));
  });

  it('a file over 25 MB is refused before it is sent', async () => {
    localStorage.setItem(NOTICE_KEY, '1');
    renderPanel();
    await screen.findByRole('list', { name: 'File della pratica' });
    pick(pdf('Grande.pdf', 25 * 1024 * 1024 + 1));
    expect(await screen.findByRole('alert')).toHaveTextContent('Il file supera 25 MB.');
    expect(files.upload).not.toHaveBeenCalled();
  });

  it('an empty file is refused before it is sent, as empty', async () => {
    localStorage.setItem(NOTICE_KEY, '1');
    renderPanel();
    await screen.findByRole('list', { name: 'File della pratica' });
    pick(pdf('Vuoto.pdf', 0));
    expect(await screen.findByRole('alert')).toHaveTextContent('Il file è vuoto.');
    expect(files.upload).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 413, message: 'La pratica supera 500 MB di file (cestino compreso).' }, 'Con questo file la pratica supererebbe 500 MB (cestino compreso).'],
    [{ status: 413, message: 'Il tuo account supera 2 GB di file (cestino compreso).' }, 'Con questo file il tuo account supererebbe 2 GB.'],
    [{ status: 415, message: 'Formato non ammesso: PDF, DOCX, DOC, ODT, RTF, TXT, JPG o PNG, controllati sul contenuto.' }, 'Formato non ammesso: PDF, DOCX, DOC, ODT, RTF, TXT, JPG o PNG, controllati sul contenuto.'],
  ])('an upload refused says so (%o)', async (failure, shown) => {
    localStorage.setItem(NOTICE_KEY, '1');
    files.upload.mockRejectedValue(failure);
    renderPanel();
    await screen.findByRole('list', { name: 'File della pratica' });
    pick(pdf());
    expect(await screen.findByRole('alert')).toHaveTextContent(shown);
  });

  it('a file that no longer decrypts says to tell who runs LexCraft', async () => {
    files.download.mockRejectedValue({ status: 500, message: 'Il file non si può decifrare: la chiave del server è cambiata o il file è danneggiato.' });
    renderPanel();
    const list = await screen.findByRole('list', { name: 'File della pratica' });
    fireEvent.click(within(list).getAllByRole('button', { name: /^Scarica/ })[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Il file non si può decifrare: la chiave del server è cambiata o il file è danneggiato. Avvisa chi gestisce LexCraft.');
  });

  it('«Sposta nel cestino», then the trash with «Ripristina» and «Elimina» (asked first; never «per sempre»)', async () => {
    renderPanel();
    const list = await screen.findByRole('list', { name: 'File della pratica' });
    fireEvent.click(within(list).getByRole('button', { name: 'Sposta nel cestino Procura.pdf' }));
    await waitFor(() => expect(files.trash).toHaveBeenCalledWith('d1', 'f3'));

    const trash = screen.getByRole('list', { name: 'Cestino della pratica' });
    fireEvent.click(within(trash).getByRole('button', { name: /Ripristina/ }));
    await waitFor(() => expect(files.restore).toHaveBeenCalledWith('d1', 'f9'));

    fireEvent.click(within(trash).getByRole('button', { name: /Elimina/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(files.remove).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/per sempre/i);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Elimina' }));
    await waitFor(() => expect(files.remove).toHaveBeenCalledWith('d1', 'f9'));
  });

  it('without the server key (503) the files say they are off, and the instructions still work', async () => {
    files.list.mockRejectedValue({ status: 503, message: "L'archivio dei file della pratica non è configurato su questo server." });
    files.getIstruzioni.mockResolvedValue('Testo salvato');
    renderPanel();
    expect(await screen.findByText('I file della pratica non sono attivi su questo server.')).toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: 'Istruzioni per Claude' })).toHaveValue('Testo salvato');
  });

  it('without the server key (503) «Carica un file» is not active (LC61)', async () => {
    files.list.mockRejectedValue({ status: 503, message: 'off' });
    renderPanel();
    await screen.findByText('I file della pratica non sono attivi su questo server.');
    expect(screen.getByRole('button', { name: 'Carica un file' })).toBeDisabled();
  });

  it('the drafts written with the old editor are offered as Word files', async () => {
    atti.list.mockResolvedValue([
      { id: 'a1', titolo: 'Procura alle liti', tipo: null, stato: 'bozza', dossierId: 'd1', createdAt: '', updatedAt: '' },
      { id: 'a2', titolo: 'Data Breach', tipo: null, stato: 'finale', dossierId: 'd1', createdAt: '', updatedAt: '' },
    ]);
    atti.get.mockResolvedValue({ id: 'a1', titolo: 'Procura alle liti', testo: 'Il sottoscritto\nconferisce procura.', dossierId: 'd1' });
    renderPanel();
    expect(await screen.findByText('Hai 2 bozze scritte nella versione precedente')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /Scarica come Word/ })[0]);
    await waitFor(() => expect(saved.saveBlob).toHaveBeenCalled());
    expect(atti.get).toHaveBeenCalledWith('a1');
    const [blob, name] = saved.saveBlob.mock.calls[0] as [Blob, string];
    expect(name).toBe('Procura alle liti.docx');
    const bytes = await new Promise<Uint8Array>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.readAsArrayBuffer(blob);
    });
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const reading = await readDocxBytes(bytes);
    expect(reading.text).toContain('Procura alle liti');
    expect(reading.text).toContain('conferisce procura.');
  });

  it('with no old drafts there is no such line', async () => {
    renderPanel();
    await screen.findByRole('list', { name: 'File della pratica' });
    expect(screen.queryByText(/versione precedente/)).not.toBeInTheDocument();
  });
});

function Where() {
  const { pathname, search } = useLocation();
  return <span data-testid="where">{pathname + search}</span>;
}

describe('the old act addresses (LC53)', () => {
  const renderAt = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/work/atti/:id" element={<OldAttoRedirect />} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>,
    );

  it('an act with a dossier leads to that dossier\'s «Atti» tab', async () => {
    atti.get.mockResolvedValue({ id: 'a1', dossierId: 'd1' });
    renderAt('/work/atti/a1');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/pratiche?dossier=d1&vista=atti'));
  });

  it('an act without one, or one that cannot be read, leads to the dossiers', async () => {
    atti.get.mockResolvedValue({ id: 'a1', dossierId: null });
    renderAt('/work/atti/a1');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/pratiche$/));
  });
});
