import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

// The real service over a mocked `apiClient`: the test reads every path and body the exam sends.
vi.mock('../../../../services/api', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../../../store/assistantProposals', () => ({ loadAssistantFeatures: vi.fn(async () => {}) }));

import { apiClient } from '../../../../services/api';
import { coursesSwitchStore } from './coursesSwitch';
import { ExamSession } from './ExamSession';
import type { DomandaEsame, ProvaEsame } from '../../../../types/corsi';
import { examOf, page } from './__fixtures__/corsi';

const post = vi.mocked(apiClient.post);
const get = vi.mocked(apiClient.get);
const BASE = '/lingo/corsi/corso-1/esami/e-1';

function Where() {
  const { pathname, state } = useLocation();
  return <p data-testid="where" data-focus={(state as { focus?: string } | null)?.focus}>{pathname}</p>;
}

const item = (n: number, over: Partial<DomandaEsame> = {}): DomandaEsame => ({
  id: `q-${n}`,
  tipo: 'ESAME',
  ordine: n,
  applicazione: false,
  testo: `Domanda d’esame ${n}`,
  competenze: [n === 1 ? 'C1' : 'C2'],
  opzioni: [
    { chiave: 'a', testo: `Prima opzione ${n}` },
    { chiave: 'b', testo: `Seconda opzione ${n}` },
  ],
  ...over,
});
const opinion: DomandaEsame = {
  id: 'q-op',
  tipo: 'ESAME_APERTA',
  ordine: 3,
  applicazione: true,
  testo: 'Scrivi il parere sul caso del marchio di fatto.',
  competenze: ['C1'],
  opzioni: null,
};

const started = (): ProvaEsame => ({
  esameId: 'e-1',
  tentativo: { id: 't-1', apertoIl: '2026-11-15T09:00:00.000Z', consegnatoIl: null, giorno: null, percentuale: null, superato: null },
  perCompetenza: null,
  nuovoEsameDal: null,
  domande: [item(1), item(2), opinion],
  aperta: null,
  xp: null,
});

const handedIn = (over: Partial<ProvaEsame> = {}): ProvaEsame => ({
  ...started(),
  tentativo: { id: 't-1', apertoIl: '2026-11-15T09:00:00.000Z', consegnatoIl: '2026-11-15T09:20:00.000Z', giorno: '2026-11-15', percentuale: 50, superato: false },
  perCompetenza: [
    { codice: 'C1', percentuale: 100, superata: true },
    { codice: 'C2', percentuale: 0, superata: false },
  ],
  nuovoEsameDal: '2026-11-18',
  domande: [
    item(1, { opzioni: [{ chiave: 'a', testo: 'Prima opzione 1', spiegazione: 'Spiegazione a1' }, { chiave: 'b', testo: 'Seconda opzione 1', spiegazione: 'Spiegazione b1' }], corretta: 'a', esito: { scelta: 'a', corretto: true, segnalata: false } }),
    item(2, { opzioni: [{ chiave: 'a', testo: 'Prima opzione 2', spiegazione: 'Spiegazione a2' }, { chiave: 'b', testo: 'Seconda opzione 2', spiegazione: 'Spiegazione b2' }], corretta: 'b', esito: { scelta: null, corretto: false, segnalata: false } }),
    { ...opinion, rispostaModello: 'La risposta modello del parere.', rubrica: ['Individua la questione', 'Cita la regola', 'Trae l’esito'], esito: { scelta: null, corretto: null, segnalata: false } },
  ],
  aperta: { domandaId: 'q-op', spuntate: [] },
  ...over,
});

function renderExam() {
  return render(
    <MemoryRouter initialEntries={['/learn/percorsi/corso-1/esami/e-1']}>
      <Routes>
        <Route path="/learn/percorsi/:id/esami/:esameId" element={<ExamSession />} />
        <Route path="/learn/percorsi/:id" element={<Where />} />
        <Route path="/" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The dialog's buttons answer once they have risen into sight (`WireConfirm`'s `data-ready`). */
async function pressInDialog(dialog: HTMLElement, name: string) {
  await waitFor(() => expect(within(dialog).getByRole('button', { name }).closest('[data-ready]')).not.toBeNull(), { timeout: 2000 });
  await userEvent.click(within(dialog).getByRole('button', { name }));
}

async function startExam() {
  post.mockResolvedValueOnce({ data: started() });
  renderExam();
  await userEvent.click(await screen.findByRole('button', { name: 'Inizia la prova' }));
  return screen.findByRole('heading', { level: 1, name: 'Le domande' });
}

beforeEach(() => {
  coursesSwitchStore.setState({ state: 'on' });
  // The exam's state, read from the course page: open and not started, unless a test says otherwise.
  get.mockResolvedValue({ data: page({ esame: examOf({ stato: 'aperto' }) }) });
});
afterEach(() => {
  vi.clearAllMocks();
  coursesSwitchStore.setState({ state: 'unknown' });
});

describe('the final exam from the web (LC9)', () => {
  it('opens on its rules, focused, and sends nothing until «Inizia la prova»', async () => {
    renderExam();
    expect(await screen.findByRole('heading', { level: 1, name: 'Esame finale' })).toHaveFocus();
    expect(screen.getByText(/serve il 70% in tutto e almeno il 60% su ogni competenza/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('starts the attempt with an empty body, then shows the questions with the heading focused', async () => {
    const heading = await startExam();
    expect(post).toHaveBeenCalledWith(`${BASE}/inizia`, {});
    expect(heading).toHaveFocus();
    expect(screen.getByRole('group', { name: /Domanda 1 di 2: Domanda d’esame 1/ })).toBeInTheDocument();
    expect(screen.getByText('Esame finale · 0 di 2 risposte')).toBeInTheDocument();
    // No «Rispondi» per item: everything goes at the hand-in.
    expect(screen.queryByRole('button', { name: 'Rispondi' })).toBeNull();
    expect(screen.getByLabelText('Scrivi il parere sul caso del marchio di fatto.')).toBeInTheDocument();
  });

  it('hands in only the choices, never the opinion written, and shows the result focused', async () => {
    await startExam();
    await userEvent.click(screen.getByRole('radio', { name: /Prima opzione 1/ }));
    await userEvent.click(screen.getByRole('radio', { name: /Seconda opzione 2/ }));
    await userEvent.type(screen.getByLabelText('Scrivi il parere sul caso del marchio di fatto.'), 'Il mio parere');
    expect(screen.getByText('Esame finale · 2 di 2 risposte')).toBeInTheDocument();
    post.mockResolvedValueOnce({ data: handedIn() });
    await userEvent.click(screen.getByRole('button', { name: 'Consegna' }));
    await pressInDialog(await screen.findByRole('alertdialog'), 'Consegna');
    expect(post).toHaveBeenLastCalledWith(`${BASE}/consegna`, { risposte: [{ domandaId: 'q-1', scelta: 'a' }, { domandaId: 'q-2', scelta: 'b' }] });
    expect(await screen.findByRole('heading', { level: 1, name: 'Esame non superato' })).toHaveFocus();
    expect(screen.getByText(/50% in tutto/)).toBeInTheDocument();
    expect(screen.getByText('C2 · 0%, sotto il 60%')).toBeInTheDocument();
    expect(screen.getByText(/Un nuovo esame si può chiedere al tuo assistente dal 18 novembre 2026/)).toBeInTheDocument();
    // The graded answers, the explanations, the opinion written beside the model answer.
    expect(screen.getByText('Spiegazione b2')).toBeInTheDocument();
    expect(screen.getByText('Senza risposta: la risposta giusta è la b.')).toBeInTheDocument();
    expect(screen.getByText('Il mio parere')).toBeInTheDocument();
    expect(screen.getByText('La risposta modello del parere.')).toBeInTheDocument();
  });

  it('asks before handing in with questions left without a choice', async () => {
    await startExam();
    await userEvent.click(screen.getByRole('radio', { name: /Prima opzione 1/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Consegna' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('1 domanda è senza risposta: conta come sbagliata.');
    expect(post).toHaveBeenCalledTimes(1);
    post.mockResolvedValueOnce({ data: handedIn() });
    await pressInDialog(dialog, 'Consegna lo stesso');
    await waitFor(() => expect(post).toHaveBeenLastCalledWith(`${BASE}/consegna`, { risposte: [{ domandaId: 'q-1', scelta: 'a' }] }));
  });

  it('asks before handing in with every question answered too, without speaking of missing answers (LC12)', async () => {
    await startExam();
    await userEvent.click(screen.getByRole('radio', { name: /Prima opzione 1/ }));
    await userEvent.click(screen.getByRole('radio', { name: /Seconda opzione 2/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Consegna' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Consegni la prova?');
    expect(dialog).not.toHaveTextContent('senza risposta');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Continua la prova' })).toHaveFocus());
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('keeps every choice on screen when the hand-in does not arrive, and hands in again', async () => {
    await startExam();
    await userEvent.click(screen.getByRole('radio', { name: /Prima opzione 1/ }));
    await userEvent.click(screen.getByRole('radio', { name: /Seconda opzione 2/ }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    post.mockRejectedValueOnce({ status: undefined });
    await userEvent.click(screen.getByRole('button', { name: 'Consegna' }));
    await pressInDialog(await screen.findByRole('alertdialog'), 'Consegna');
    expect(await screen.findByRole('alert')).toHaveTextContent('Non consegnato: riprova.');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull(), { timeout: 2000 });
    expect(screen.getByRole('radio', { name: /Prima opzione 1/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Seconda opzione 2/ })).toBeChecked();
    post.mockResolvedValueOnce({ data: handedIn() });
    await userEvent.click(screen.getByRole('button', { name: 'Consegna' }));
    await pressInDialog(await screen.findByRole('alertdialog'), 'Consegna');
    expect(await screen.findByRole('heading', { level: 1, name: 'Esame non superato' })).toBeInTheDocument();
    warn.mockRestore();
  });

  it('says the server\'s words when the exam is not open', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    post.mockRejectedValueOnce({ status: 409, data: { detail: 'L’esame finale si apre quando hai finito tutti i moduli del programma.' } });
    renderExam();
    await userEvent.click(await screen.findByRole('button', { name: 'Inizia la prova' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('L’esame finale si apre quando hai finito tutti i moduli del programma.');
    warn.mockRestore();
  });

  it('shows the result at once for an attempt already handed in, and stores the rubric ticks', async () => {
    post.mockResolvedValueOnce({ data: handedIn({ tentativo: { ...handedIn().tentativo, percentuale: 90, superato: true }, nuovoEsameDal: null }) });
    renderExam();
    await userEvent.click(await screen.findByRole('button', { name: 'Inizia la prova' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Esame superato' })).toHaveFocus();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Cita la regola' }));
    post.mockResolvedValueOnce({ data: { domandaId: 'q-op', spuntate: [1] } });
    await userEvent.click(screen.getByRole('button', { name: 'Salva l’autovalutazione' }));
    expect(post).toHaveBeenLastCalledWith(`${BASE}/aperta`, { spuntate: [1] });
    expect(await screen.findByText('Autovalutazione salvata.')).toHaveAttribute('role', 'status');
  });

  it('leaves to the course with nothing chosen, and asks first once something is', async () => {
    await startExam();
    await userEvent.click(screen.getByRole('radio', { name: /Prima opzione 1/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Chiudi la prova' }));
    const dialog = await screen.findByRole('alertdialog');
    await pressInDialog(dialog, 'Esci');
    expect(await screen.findByTestId('where')).toHaveTextContent('/learn/percorsi/corso-1');
  });

  it('closing hands the course page the focus back to the exam\'s command (LC12)', async () => {
    renderExam();
    await userEvent.click(await screen.findByRole('button', { name: 'Chiudi la prova' }));
    expect(await screen.findByTestId('where')).toHaveAttribute('data-focus', 'esame');
  });
});

describe('the exam\'s address follows the attempt\'s state (LC12)', () => {
  it('offers «Inizia la prova» on an exam not started, read from the course page', async () => {
    get.mockResolvedValueOnce({ data: page({ esame: examOf({ stato: 'aperto' }) }) });
    renderExam();
    expect(await screen.findByRole('button', { name: 'Inizia la prova' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/lingo/corsi/corso-1');
    expect(screen.getByRole('heading', { level: 1, name: 'Esame finale' })).toHaveFocus();
    expect(post).not.toHaveBeenCalled();
  });

  it('offers «Riprendi la prova» on an attempt started', async () => {
    get.mockResolvedValueOnce({ data: page({ esame: examOf({ stato: 'in-corso' }) }) });
    renderExam();
    expect(await screen.findByRole('button', { name: 'Riprendi la prova' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Inizia la prova' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Esame finale' })).toHaveFocus();
    expect(post).not.toHaveBeenCalled();
  });

  it('shows the result straight away on an exam handed in, without the rules', async () => {
    get.mockResolvedValueOnce({ data: page({ esame: examOf({ stato: 'non-superato' }) }) });
    post.mockResolvedValueOnce({ data: handedIn() });
    renderExam();
    expect(await screen.findByRole('heading', { level: 1, name: 'Esame non superato' })).toHaveFocus();
    expect(post).toHaveBeenCalledWith(`${BASE}/inizia`, {});
    expect(screen.queryByText(/C’è un solo tentativo/)).toBeNull();
  });

  it('speaks of several missing answers in the plural (#458)', async () => {
    await startExam();
    await userEvent.click(screen.getByRole('button', { name: 'Consegna' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('2 domande sono senza risposta: contano come sbagliate.');
  });

  it('says the exam\'s state could not be read, with «Riprova» in place of the command, and reads it again (#458)', async () => {
    get.mockReset();
    get.mockRejectedValueOnce({ status: 503 });
    get.mockResolvedValueOnce({ data: page({ esame: examOf({ stato: 'in-corso' }) }) });
    renderExam();
    expect(await screen.findByRole('alert')).toHaveTextContent('Non riesco a leggere lo stato dell’esame.');
    expect(screen.queryByRole('button', { name: /^(Inizia|Riprendi) la prova$/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByRole('button', { name: 'Riprendi la prova' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
    expect(post).not.toHaveBeenCalled();
  });
});
