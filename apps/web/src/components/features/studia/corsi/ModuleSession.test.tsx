import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

// The real service over a mocked `apiClient`: the test reads every body the session sends (§8, §15).
vi.mock('../../../../services/api', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../../../store/assistantProposals', () => ({ loadAssistantFeatures: vi.fn(async () => {}) }));
const view = vi.hoisted(() => ({ desktop: true }));
vi.mock('../../../../hooks/useIsDesktop', () => ({ useIsDesktop: () => view.desktop }));
// The readers a citation opens are the dossier's, tested there: here, what they are given.
vi.mock('../../dossier/DossierItemReader', () => ({
  DossierItemReader: ({ norma, onOpenOnDashboard }: { norma: { tipo_atto: string; numero_articolo: string }; onOpenOnDashboard: () => void }) => (
    <div>
      <p data-testid="norm-reader">
        {norma.tipo_atto} art. {norma.numero_articolo}
      </p>
      <button type="button" onClick={onOpenOnDashboard}>
        Apri su Dashboard
      </button>
    </div>
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
import { loadAssistantFeatures } from '../../../../store/assistantProposals';
import { coursesSwitchStore, setCoursesSwitch } from './coursesSwitch';
import { ModuleSession } from './ModuleSession';
import { forgetModuleSessions, saveStepReached } from './moduleSteps';
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
        <Route path="/" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Selects from (node, offset) to (node, offset) and tells the page, as a browser does. */
function select(startNode: Node, startOffset: number, endNode: Node, endOffset: number) {
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  range.getBoundingClientRect = () => new DOMRect(0, 0, 10, 10);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
  fireEvent(document, new Event('selectionchange'));
}

const graded: EsitoRisposta = {
  registrata: true,
  domandaId: 'd-1',
  xp: { crediti: [], livello: { livello: 1, totale: 0, nelLivello: 0, perIlProssimo: 100, oggi: 0 }, nuovoLivello: false },
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
  view.desktop = true;
  forgetModuleSessions();
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
    expect(stepLine()).toHaveTextContent('Passo 1 di 5 · Prima di leggere');
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
    expect(stepLine()).toHaveTextContent('Passo 1 di 5');
  });

  it('starts it with `apri`, then reads the first block', async () => {
    const user = userEvent.setup();
    renderSession();
    await user.click(await screen.findByRole('button', { name: 'Inizia il modulo' }));
    expect(post).toHaveBeenCalledWith('/lingo/corsi/corso-1/moduli/m-3/apri', {});
    expect(await screen.findByRole('heading', { level: 1, name: 'Il segno distintivo' })).toHaveFocus();
    expect(stepLine()).toHaveTextContent('Passo 2 di 5 · Lettura');
    expect(screen.getByText('Blocco 1 di 2 · circa 15 minuti di lettura')).toBeInTheDocument();
  });

  it('says «Non registrato: riprova» when `apri` does not arrive, and stays on the start', async () => {
    post.mockRejectedValueOnce({ status: 0 });
    const user = userEvent.setup();
    renderSession();
    await user.click(await screen.findByRole('button', { name: 'Inizia il modulo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Non registrato: riprova.');
    expect(stepLine()).toHaveTextContent('Passo 1 di 5');
  });

  it('resumes an opened module at the step this device reached, never one not started', async () => {
    saveStepReached('m-3', 2);
    const first = renderSession(lesson({ stato: 'in-corso' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Che cosa ricordi di «Il segno distintivo»?' })).toBeInTheDocument();
    expect(stepLine()).toHaveTextContent('Passo 3 di 5 · Richiamo');
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
    // The lesson's `###` one level under the step's heading.
    expect(screen.getByRole('heading', { level: 2, name: 'Che cos’è' })).toBeInTheDocument();
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

describe('highlights and citations, further (§5 step 3, §6.5)', () => {
  async function atReading() {
    const user = userEvent.setup();
    renderSession(lesson({ stato: 'in-corso' }));
    await user.click(await screen.findByRole('button', { name: 'Comincia a leggere' }));
    await screen.findByRole('heading', { level: 1, name: 'Il segno distintivo' });
    return user;
  }

  it('maps a selection across a bold word, its edges on elements, to the plain text\'s offsets', async () => {
    const user = await atReading();
    const paragraph = screen.getByText('marchio').closest('p')!;
    // From before «Il» (an element edge) to after «marchio» (the end of the <strong>).
    select(paragraph, 0, screen.getByText('marchio').closest('strong')!, 1);
    await user.click(await screen.findByRole('button', { name: 'Evidenzia' }));
    expect([...document.querySelectorAll('mark')].map((m) => m.textContent).join('')).toBe('Il marchio');
    expect(document.querySelectorAll('mark[tabindex="0"]')).toHaveLength(1);
  });

  it('goes from the text to «Evidenzia» with Tab while words are selected', async () => {
    await atReading();
    const word = screen.getByText(/distingue i prodotti/);
    select(word.firstChild!, 1, word.firstChild!, 9);
    const text = document.querySelector<HTMLElement>('[data-lesson-text]')!;
    text.focus();
    fireEvent.keyDown(text, { key: 'Tab' });
    expect(await screen.findByRole('button', { name: 'Evidenzia' })).toHaveFocus();
  });

  it('gives the focus back to the citation when its panel closes', async () => {
    const user = await atReading();
    const citation = screen.getByRole('button', { name: /l’art\. 7 c\.p\.i\./ });
    await user.click(citation);
    expect(screen.getByRole('heading', { level: 2, name: 'art. 7, d.lgs. 10 febbraio 2005, n. 30' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Chiudi la citazione' }));
    await waitFor(() => expect(citation).toHaveFocus());
  });

  it('opens a citation in a sheet on a phone, which keeps its own Esc', async () => {
    view.desktop = false;
    const user = await atReading();
    await user.click(screen.getByRole('button', { name: /l’art\. 7 c\.p\.i\./ }));
    expect(screen.getByRole('dialog', { name: 'art. 7, d.lgs. 10 febbraio 2005, n. 30' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary')).toBeNull();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByTestId('where')).toBeNull();
  });

  it('asks before a reader\'s «Apri su Dashboard» takes the reader away from what was highlighted', async () => {
    const user = await atReading();
    const word = screen.getByText(/distingue i prodotti/);
    select(word.firstChild!, 1, word.firstChild!, 9);
    await user.click(await screen.findByRole('button', { name: 'Evidenzia' }));
    await user.click(screen.getByRole('button', { name: /l’art\. 7 c\.p\.i\./ }));
    await user.click(screen.getByRole('button', { name: 'Apri su Dashboard' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Interrompi il modulo?' });
    expect(dialog).toHaveTextContent('Le evidenziazioni si perdono.');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Interrompi' }).closest('[data-ready]')).not.toBeNull(), { timeout: 2000 });
    await user.click(within(dialog).getByRole('button', { name: 'Interrompi' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/));
  });
});

describe('the review of #374', () => {
  it('keeps what was written, highlighted and the phase across a reload, and the browser asks before the tab closes', async () => {
    saveStepReached('m-3', 2);
    const user = userEvent.setup();
    const first = renderSession(lesson({ stato: 'in-corso' }));
    await user.type(await screen.findByLabelText(/gli elementi, le eccezioni, un caso/), 'Un segno');
    await user.click(screen.getByRole('button', { name: 'Confronta con il testo' }));
    const closing = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(closing);
    expect(closing.defaultPrevented).toBe(true);
    first.unmount();
    renderSession(lesson({ stato: 'in-corso' }));
    expect(await screen.findByRole('region', { name: 'Quello che hai scritto' })).toHaveTextContent('Un segno');
  });

  it('asks nothing of the browser with nothing written, and forgets the work once «Interrompi» is confirmed', async () => {
    saveStepReached('m-3', 2);
    const user = userEvent.setup();
    const first = renderSession(lesson({ stato: 'in-corso' }));
    const field = await screen.findByLabelText(/gli elementi, le eccezioni, un caso/);
    const idle = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(idle);
    expect(idle.defaultPrevented).toBe(false);
    await user.type(field, 'qualcosa');
    await user.click(screen.getByRole('button', { name: 'Chiudi il modulo' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Interrompi il modulo?' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Interrompi' }).closest('[data-ready]')).not.toBeNull(), { timeout: 2000 });
    await user.click(within(dialog).getByRole('button', { name: 'Interrompi' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/studia/percorsi/corso-1'));
    first.unmount();
    renderSession(lesson({ stato: 'in-corso' }));
    expect(await screen.findByLabelText(/gli elementi, le eccezioni, un caso/)).toHaveValue('');
  });

  it('closes a citation opened in a recall\'s comparison when the questions come, the focus on their heading', async () => {
    saveStepReached('m-3', 2);
    const user = userEvent.setup();
    renderSession(lesson({ stato: 'in-corso' }));
    await user.click(await screen.findByRole('button', { name: 'Confronta con il testo' }));
    await user.click(screen.getByRole('button', { name: /l’art\. 7 c\.p\.i\./ }));
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Alle domande' }));
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Domande su «Il segno distintivo»' })).toHaveFocus();
  });

  it('draws a highlight over a citation with nothing interactive inside its button, and takes it away by selecting its words', async () => {
    const user = userEvent.setup();
    renderSession(lesson({ stato: 'in-corso' }));
    await user.click(await screen.findByRole('button', { name: 'Comincia a leggere' }));
    const cite = await screen.findByRole('button', { name: /l’art\. 7 c\.p\.i\./ });
    const words = within(cite).getByText('l’art. 7 c.p.i.');
    select(words.firstChild!, 0, words.firstChild!, 6);
    await user.click(await screen.findByRole('button', { name: 'Evidenzia' }));
    const mark = cite.querySelector('mark')!;
    expect(mark).toHaveTextContent('l’art.');
    expect(cite.querySelector('[tabindex], [role="button"]')).toBeNull();
    select(mark.firstChild!, 1, mark.firstChild!, 4);
    await user.click(await screen.findByRole('button', { name: 'Togli' }));
    expect(document.querySelector('mark')).toBeNull();
  });

  it('reads the features again on a 404, and goes back to Oggi when the switch was turned off', async () => {
    vi.mocked(loadAssistantFeatures).mockImplementation(async () => setCoursesSwitch(false));
    get.mockRejectedValue({ status: 404, data: { detail: 'Not found' } });
    render(
      <MemoryRouter initialEntries={['/studia/percorsi/corso-1/moduli/m-3']}>
        <Routes>
          <Route path="/studia/percorsi/:id/moduli/:moduloId" element={<ModuleSession />} />
          <Route path="/studia/ripasso" element={<p data-testid="where">/studia/ripasso</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('where')).toHaveTextContent('/studia/ripasso');
    expect(screen.queryByText(/non c’è più/)).toBeNull();
    vi.mocked(loadAssistantFeatures).mockImplementation(async () => {});
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
    // «Rispondi» is gone: the focus is on the question, not lost to the page.
    await waitFor(() => expect(screen.getByRole('group', { name: /Domanda 1 di 1/ })).toHaveFocus());
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
    expect(stepLine()).toHaveTextContent('Passo 4 di 5 · Lettura');
    await user.click(screen.getByRole('button', { name: 'Ho letto: al richiamo' }));
    await user.click(screen.getByRole('button', { name: 'Confronta con il testo' }));
    expect(screen.queryByRole('button', { name: 'Alle domande' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Avanti' }));
    expect(screen.getByText('Fine della lettura')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Hai finito la lettura del modulo.' })).toBeInTheDocument();
  });
});

describe('a module as S2 reads it back (#375)', () => {
  it('draws a recall question answered before with its outcome and explanations, and no «Rispondi»', async () => {
    saveStepReached('m-3', 2);
    const base = lesson({ stato: 'in-corso' });
    const answered = {
      ...base.blocchi[0].richiamo[0],
      opzioni: graded.opzioni,
      risposta: { scelta: 'a' as const, corretto: true, corretta: 'a' as const, giorno: '2026-10-28', segnalata: false },
    };
    const user = userEvent.setup();
    renderSession({ ...base, blocchi: [{ ...base.blocchi[0], richiamo: [answered] }, base.blocchi[1]] });
    await user.click(await screen.findByRole('button', { name: 'Confronta con il testo' }));
    await user.click(screen.getByRole('button', { name: 'Alle domande' }));
    expect(screen.getByText('La tua risposta, giusta')).toBeInTheDocument();
    expect(screen.getByText('Il brevetto protegge un’invenzione, non distingue.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rispondi' })).toBeNull();
    expect(screen.getByRole('radio', { name: /I prodotti/ })).toBeChecked();
  });

  it('says a withdrawn module is withdrawn, and still reads it', async () => {
    renderSession(lesson({ stato: 'ritirato', ritirato: true }));
    expect(await screen.findByText(/Hai ritirato questo modulo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Comincia a leggere' })).toBeInTheDocument();
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

  it('asks «Interrompi il modulo?» once something was written, and goes on when told to', async () => {
    saveStepReached('m-3', 2);
    const user = userEvent.setup();
    renderSession(lesson({ stato: 'in-corso' }));
    await user.type(await screen.findByLabelText(/gli elementi, le eccezioni, un caso/), 'qualcosa');
    await user.click(screen.getByRole('button', { name: 'Chiudi il modulo' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Interrompi il modulo?' });
    expect(dialog).toHaveTextContent('Quello che hai scritto si perde.');
    await user.click(within(dialog).getByRole('button', { name: 'Continua il modulo' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.queryByTestId('where')).toBeNull();
  });

  it('lets Esc cancel the question, and stays', async () => {
    saveStepReached('m-3', 2);
    const user = userEvent.setup();
    renderSession(lesson({ stato: 'in-corso' }));
    await user.type(await screen.findByLabelText(/gli elementi, le eccezioni, un caso/), 'qualcosa');
    await user.keyboard('{Escape}');
    await screen.findByRole('alertdialog', { name: 'Interrompi il modulo?' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.queryByTestId('where')).toBeNull();
    expect(screen.getByLabelText(/gli elementi, le eccezioni, un caso/)).toHaveValue('qualcosa');
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
      ['/lingo/corsi/corso-1/moduli/m-3/apri', {}],
      ['/lingo/corsi/corso-1/moduli/m-3/risposte', { domandaId: 'd-1', scelta: 'b' }],
    ]);
    expect(JSON.stringify([...post.mock.calls, ...get.mock.calls])).not.toMatch(/RICORDO-PRIVATO|distingu/);
  });
});
