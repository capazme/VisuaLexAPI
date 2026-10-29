import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

// The real service over a mocked `apiClient`: the test reads every body the session sends (§8, §15).
vi.mock('../../../../services/api', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../../../store/assistantProposals', () => ({ loadAssistantFeatures: vi.fn(async () => {}) }));
vi.mock('../../../../hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
// The readers a citation opens are the dossier's, tested there: here, what they are given.
vi.mock('../../dossier/DossierItemReader', () => ({
  DossierItemReader: ({ norma }: { norma: { tipo_atto: string; numero_articolo: string } }) => (
    <p data-testid="norm-reader">
      {norma.tipo_atto} art. {norma.numero_articolo}
    </p>
  ),
}));
vi.mock('../../dossier/DossierDecisionReader', () => ({
  DossierDecisionReader: ({ identity }: { identity: { corte: string; numero: number; anno: number } }) => (
    <p data-testid="decision-reader">
      {identity.corte} {identity.numero}/{identity.anno}
    </p>
  ),
}));

import { apiClient } from '../../../../services/api';
import { coursesSwitchStore } from './coursesSwitch';
import { ModuleSession } from './ModuleSession';
import { forgetStepsReached, saveStepReached } from './moduleSteps';
import { lesson } from './__fixtures__/corsi';
import type { EsitoRisposta, ModuloLezione } from '../../../../types/corsi';

const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);

function Where() {
  const { pathname } = useLocation();
  return <p data-testid="where">{pathname}</p>;
}

function renderSession(modulo: ModuloLezione = lesson()) {
  get.mockResolvedValue({ data: modulo });
  return render(
    <MemoryRouter initialEntries={[`/studia/percorsi/corso-1/moduli/${modulo.id}`]}>
      <Routes>
        <Route path="/studia/percorsi/:id/moduli/:moduloId" element={<ModuleSession />} />
        <Route path="/studia/percorsi/:id" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const graded: EsitoRisposta = {
  registrata: true,
  scelta: 'b',
  corretto: false,
  corretta: 'a',
  opzioni: [
    { chiave: 'a', testo: 'I prodotti o i servizi di un’impresa', spiegazione: 'È la funzione distintiva del marchio.' },
    { chiave: 'b', testo: 'Il titolare di un brevetto', spiegazione: 'Il brevetto protegge un’invenzione, non distingue.' },
  ],
};

const stepLine = () => screen.getByText(/^Passo \d+ di \d+ · /);

beforeEach(() => {
  coursesSwitchStore.setState({ state: 'on' });
  forgetStepsReached();
  post.mockResolvedValue({ data: {} });
});

afterEach(() => {
  vi.clearAllMocks();
  coursesSwitchStore.setState({ state: 'unknown' });
});

describe('a module\'s start (§5, step 1; §6.4)', () => {
  it('says what the module is for, its pre-questions, and that starting it keeps it in the course', async () => {
    renderSession();
    expect(await screen.findByRole('heading', { level: 1, name: 'Il marchio e i suoi impedimenti' })).toHaveFocus();
    expect(stepLine()).toHaveTextContent('Passo 1 di 6 · Prima di leggere');
    expect(screen.getByText('Modulo 3 · 2 blocchi · circa 30 minuti')).toBeInTheDocument();
    expect(screen.getByText('Qualificare un segno distintivo e indicare gli impedimenti assoluti')).toBeInTheDocument();
    const before = screen.getByRole('region', { name: 'Prima di leggere' });
    expect(within(before).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Che cosa rende un segno distintivo?', 'Quando un segno non si può registrare?']);
    expect(screen.getByText(/non potrai più eliminarlo/)).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/lingo/corsi/corso-1/moduli/m-3');
  });

  it('reads a module not yet started without starting it: no `apri`, every block in one page', async () => {
    const user = userEvent.setup();
    renderSession();
    await user.click(await screen.findByRole('button', { name: 'Leggi senza iniziare' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Il marchio e i suoi impedimenti' })).toBeInTheDocument();
    expect(screen.getByText('Anteprima: il modulo non è ancora iniziato')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Il segno distintivo' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Blocco 2 di 2' })).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Torna all’inizio' }));
    expect(stepLine()).toHaveTextContent('Passo 1 di 6');
  });

  it('starts it with `apri`, then reads the first block', async () => {
    const user = userEvent.setup();
    renderSession();
    await user.click(await screen.findByRole('button', { name: 'Inizia il modulo' }));
    expect(post).toHaveBeenCalledWith('/lingo/corsi/corso-1/moduli/m-3/apri');
    expect(await screen.findByRole('heading', { level: 1, name: 'Il segno distintivo' })).toHaveFocus();
    expect(stepLine()).toHaveTextContent('Passo 2 di 6 · Lettura');
    expect(screen.getByText('Blocco 1 di 2 · circa 15 minuti di lettura')).toBeInTheDocument();
  });

  it('says «Non registrato: riprova» when `apri` does not arrive, and stays on the start', async () => {
    post.mockRejectedValueOnce({ status: 0 });
    const user = userEvent.setup();
    renderSession();
    await user.click(await screen.findByRole('button', { name: 'Inizia il modulo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Non registrato: riprova.');
    expect(stepLine()).toHaveTextContent('Passo 1 di 6');
  });

  it('resumes an opened module at the step this device reached, never one not started', async () => {
    saveStepReached('m-3', 2);
    const first = renderSession(lesson({ stato: 'in-corso' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Che cosa ricordi di «Il segno distintivo»?' })).toBeInTheDocument();
    expect(stepLine()).toHaveTextContent('Passo 3 di 6 · Richiamo');
    first.unmount();
    renderSession(lesson({ stato: 'da-iniziare' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Il marchio e i suoi impedimenti' })).toBeInTheDocument();
  });

  it('says a module gone is gone, with the way back to the course', async () => {
    get.mockRejectedValue({ status: 404, data: { detail: 'Percorso non trovato.' } });
    render(
      <MemoryRouter initialEntries={['/studia/percorsi/corso-1/moduli/m-9']}>
        <Routes>
          <Route path="/studia/percorsi/:id/moduli/:moduloId" element={<ModuleSession />} />
          <Route path="/studia/percorsi/:id" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Questo modulo non c’è più');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Torna al percorso' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/studia/percorsi/corso-1');
  });
});

describe('reading a block (§5, step 2; §10.3)', () => {
  async function atReading() {
    const user = userEvent.setup();
    renderSession(lesson({ stato: 'in-corso' }));
    await user.click(await screen.findByRole('button', { name: 'Comincia a leggere' }));
    await screen.findByRole('heading', { level: 1, name: 'Il segno distintivo' });
    return user;
  }

  it('draws the lesson\'s format as text: headings, bold, lists, and HTML left as words', async () => {
    await atReading();
    expect(screen.getByRole('heading', { level: 3, name: 'Che cos’è' })).toBeInTheDocument();
    expect(screen.getByText('marchio').tagName).toBe('SPAN');
    expect(screen.getByText('marchio').closest('strong')).not.toBeNull();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(expect.arrayContaining(['primo requisito', 'secondo requisito']));
    expect(screen.getByText('<img src=x onerror=alert(1)> resta testo.')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('keeps the pre-questions one tap away, folded', async () => {
    await atReading();
    expect(screen.getByText('Le domande guida').closest('details')).not.toHaveAttribute('open');
  });

  it('opens a cited norm beside the text, and Esc closes it before anything else', async () => {
    const user = await atReading();
    await user.click(screen.getByRole('button', { name: /l’art\. 7 c\.p\.i\./ }));
    const panel = screen.getByRole('complementary', { name: 'art. 7, d.lgs. 10 febbraio 2005, n. 30' });
    expect(within(panel).getByTestId('norm-reader')).toHaveTextContent('decreto legislativo art. 7');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Il segno distintivo' })).toBeInTheDocument();
  });

  it('opens a cited decision with the decision\'s own reader', async () => {
    saveStepReached('m-3', 3);
    const user = userEvent.setup();
    renderSession(lesson({ stato: 'in-corso' }));
    await user.click(await screen.findByRole('button', { name: /la Cassazione/ }));
    expect(screen.getByTestId('decision-reader')).toHaveTextContent('cassazione 1234/2020');
  });

  it('highlights a selection for the session with «Evidenzia», and «Togli» takes it away', async () => {
    const user = await atReading();
    const word = screen.getByText(/distingue i prodotti/);
    const range = document.createRange();
    range.setStart(word.firstChild!, 1);
    range.setEnd(word.firstChild!, 9);
    range.getBoundingClientRect = () => new DOMRect(0, 0, 10, 10);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    fireEvent(document, new Event('selectionchange'));
    await user.click(await screen.findByRole('button', { name: 'Evidenzia' }));
    const mark = document.querySelector('mark');
    expect(mark).toHaveTextContent('distingu');
    fireEvent.click(mark!);
    await user.click(await screen.findByRole('button', { name: 'Togli' }));
    expect(document.querySelector('mark')).toBeNull();
  });
});

describe('the recall (§5, step 4)', () => {
  async function atRecall() {
    saveStepReached('m-3', 2);
    const user = userEvent.setup();
    renderSession(lesson({ stato: 'in-corso' }));
    await screen.findByRole('heading', { level: 1, name: 'Che cosa ricordi di «Il segno distintivo»?' });
    return user;
  }

  it('hides the text while the reader writes, then compares, then asks the block\'s questions', async () => {
    const user = await atRecall();
    expect(screen.queryByText(/distingue i prodotti/)).toBeNull();
    await user.type(screen.getByLabelText(/gli elementi, le eccezioni, un caso/), 'Un segno che distingue');
    await user.click(screen.getByRole('button', { name: 'Confronta con il testo' }));
    expect(screen.getByRole('region', { name: 'Quello che hai scritto' })).toHaveTextContent('Un segno che distingue');
    expect(within(screen.getByRole('region', { name: 'Il testo' })).getByText(/distingue i prodotti/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Alle domande' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Domande su «Il segno distintivo»' })).toHaveFocus();
    expect(screen.getByRole('group', { name: 'Domanda 1 di 1: Che cosa distingue il marchio?' })).toBeInTheDocument();
  });

  it('sends the choice alone, and draws what the server graded: the explanations, the right one, in a live region', async () => {
    const user = await atRecall();
    await user.click(screen.getByRole('button', { name: 'Confronta con il testo' }));
    await user.click(screen.getByRole('button', { name: 'Alle domande' }));
    post.mockResolvedValueOnce({ data: graded });
    const rispondi = screen.getByRole('button', { name: 'Rispondi' });
    expect(rispondi).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: /Il titolare di un brevetto/ }));
    await user.click(rispondi);
    expect(post).toHaveBeenCalledWith('/lingo/corsi/corso-1/moduli/m-3/risposte', { domandaId: 'd-1', scelta: 'b' });
    expect(await screen.findByText('Non è giusto: la risposta giusta è l’a.')).toBeInTheDocument();
    expect(screen.getByText('È la funzione distintiva del marchio.')).toBeInTheDocument();
    expect(screen.getByText('La risposta giusta')).toBeInTheDocument();
    expect(screen.getByText('La tua risposta')).toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
  });

  it('keeps the choice and says «Non registrato: riprova» when it does not arrive; a refusal says the server\'s words', async () => {
    const user = await atRecall();
    await user.click(screen.getByRole('button', { name: 'Confronta con il testo' }));
    await user.click(screen.getByRole('button', { name: 'Alle domande' }));
    post.mockRejectedValueOnce({ status: 0 });
    await user.click(screen.getByRole('radio', { name: /I prodotti/ }));
    await user.click(screen.getByRole('button', { name: 'Rispondi' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Non registrato: riprova.');
    expect(screen.getByRole('radio', { name: /I prodotti/ })).toBeChecked();
    post.mockRejectedValueOnce({ status: 409, data: { detail: 'Il modulo è stato ritirato.' } });
    await user.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Non registrato: Il modulo è stato ritirato.');
  });

  it('goes on to the next block\'s reading, and a block with no question skips the third phase', async () => {
    const user = await atRecall();
    await user.click(screen.getByRole('button', { name: 'Confronta con il testo' }));
    await user.click(screen.getByRole('button', { name: 'Alle domande' }));
    await user.click(screen.getByRole('button', { name: 'Avanti' }));
    expect(stepLine()).toHaveTextContent('Passo 4 di 6 · Lettura');
    await user.click(screen.getByRole('button', { name: 'Ho letto: al richiamo' }));
    await user.click(screen.getByRole('button', { name: 'Confronta con il testo' }));
    expect(screen.queryByRole('button', { name: 'Alle domande' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Avanti' }));
    expect(stepLine()).toHaveTextContent('Passo 6 di 6 · Quiz');
    expect(screen.getByRole('heading', { level: 1, name: 'Hai finito la lettura del modulo.' })).toBeInTheDocument();
  });
});

describe('leaving (§6.5) and what reaches the server (§8)', () => {
  it('leaves at once when nothing was written', async () => {
    const user = userEvent.setup();
    renderSession();
    await screen.findByRole('heading', { level: 1, name: 'Il marchio e i suoi impedimenti' });
    await user.keyboard('{Escape}');
    expect(screen.getByTestId('where')).toHaveTextContent('/studia/percorsi/corso-1');
  });

  it('asks «Interrompere il modulo?» once something was written, and goes on when told to', async () => {
    saveStepReached('m-3', 2);
    const user = userEvent.setup();
    renderSession(lesson({ stato: 'in-corso' }));
    await user.type(await screen.findByLabelText(/gli elementi, le eccezioni, un caso/), 'qualcosa');
    await user.click(screen.getByRole('button', { name: 'Chiudi il modulo' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Interrompere il modulo?' });
    expect(dialog).toHaveTextContent('Quello che hai scritto si perde.');
    await user.click(within(dialog).getByRole('button', { name: 'Continua il modulo' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.queryByTestId('where')).toBeNull();
  });

  it('sends no free recall, highlight or step: only `apri` and the item with its key', async () => {
    const user = userEvent.setup();
    renderSession();
    await user.click(await screen.findByRole('button', { name: 'Inizia il modulo' }));
    await screen.findByRole('heading', { level: 1, name: 'Il segno distintivo' });
    const word = screen.getByText(/distingue i prodotti/);
    const range = document.createRange();
    range.setStart(word.firstChild!, 1);
    range.setEnd(word.firstChild!, 9);
    range.getBoundingClientRect = () => new DOMRect(0, 0, 10, 10);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    fireEvent(document, new Event('selectionchange'));
    await user.click(await screen.findByRole('button', { name: 'Evidenzia' }));
    await user.click(screen.getByRole('button', { name: 'Ho letto: al richiamo' }));
    await user.type(screen.getByLabelText(/gli elementi, le eccezioni, un caso/), 'RICORDO-PRIVATO');
    await user.click(screen.getByRole('button', { name: 'Confronta con il testo' }));
    await user.click(screen.getByRole('button', { name: 'Alle domande' }));
    post.mockResolvedValueOnce({ data: graded });
    await user.click(screen.getByRole('radio', { name: /Il titolare/ }));
    await user.click(screen.getByRole('button', { name: 'Rispondi' }));
    await screen.findByText(/Non è giusto/);
    expect(post.mock.calls).toEqual([
      ['/lingo/corsi/corso-1/moduli/m-3/apri'],
      ['/lingo/corsi/corso-1/moduli/m-3/risposte', { domandaId: 'd-1', scelta: 'b' }],
    ]);
    expect(JSON.stringify([...post.mock.calls, ...get.mock.calls])).not.toMatch(/RICORDO-PRIVATO|distingu/);
  });
});
