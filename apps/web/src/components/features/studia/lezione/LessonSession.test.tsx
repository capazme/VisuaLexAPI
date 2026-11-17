import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../../../services/studiaService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../services/studiaService')>();
  return { ...actual, studiaService: { createLesson: vi.fn(), answerLesson: vi.fn() } };
});

import { studiaService } from '../../../../services/studiaService';
import type { EsitoEsercizio, Lezione, XpEsito } from '../../../../types/studia';
import { LessonSession } from './LessonSession';

// LC63: the short lesson's screen — one exercise at a time, the server's grading at once, a progress bar, and at the end
// the right answers and the XP the server credited (never a number the browser made).

const create = vi.mocked(studiaService.createLesson);
const answer = vi.mocked(studiaService.answerLesson);

const LESSON: Lezione = {
  id: 'lez-1',
  materia: 'DIRITTO_CIVILE',
  esercizi: [
    { tipo: 'scelta', domanda: 'Che cos’è la mora?', opzioni: ['Il ritardo', 'Il possesso', 'La garanzia', 'Il contratto'] },
    { tipo: 'vero-falso', domanda: 'Che cos’è la risoluzione?', affermazione: 'Lo scioglimento del contratto.' },
    { tipo: 'completa', domanda: 'Che cos’è l’usucapione?', testo: 'Un modo di acquisto della _____.', opzioni: ['proprietà', 'garanzia', 'diligenza', 'obbligazione'] },
    { tipo: 'abbina', norme: ['art. 1453 codice civile', 'art. 2043 codice civile'], istituti: ['Fatto illecito', 'Risoluzione'] },
    { tipo: 'scelta', domanda: 'Che cos’è la buona fede?', opzioni: ['A', 'B', 'C', 'D'] },
  ],
};

const xp = (punti: number): XpEsito => ({
  crediti: punti > 0 ? [{ missione: 'lezione', punti }] : [],
  livello: { livello: 2, totale: 140, nelLivello: 40, perIlProssimo: 125, oggi: punti },
  nuovoLivello: false,
});
const graded = (indice: number, giusta: boolean, soluzione: EsitoEsercizio['soluzione'], fine?: EsitoEsercizio['fine']): EsitoEsercizio => ({ registrata: true, indice, giusta, soluzione, ...(fine ? { fine } : {}) });

function renderLesson(materia = 'DIRITTO_CIVILE') {
  render(
    <MemoryRouter initialEntries={[`/learn/lezione?materia=${materia}`]}>
      <Routes>
        <Route path="/learn/lezione" element={<LessonSession />} />
        <Route path="/learn/ripasso" element={<p>Oggi</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const progress = () => screen.getByRole('progressbar', { name: 'Avanzamento della lezione' });

afterEach(() => vi.clearAllMocks());

describe('LessonSession', () => {
  it('runs the lesson: grades each answer on the server, says it at once, and ends with the server\'s XP', async () => {
    create.mockResolvedValue(LESSON);
    answer
      .mockResolvedValueOnce(graded(0, true, 0))
      .mockResolvedValueOnce(graded(1, false, true))
      .mockResolvedValueOnce(graded(2, true, 0))
      .mockResolvedValueOnce(graded(3, true, [1, 0]))
      .mockResolvedValueOnce(graded(4, false, 2, { giuste: 3, totale: 5, xp: xp(10) }));
    const user = userEvent.setup();
    renderLesson();

    expect(await screen.findByText('Che cos’è la mora?')).toBeInTheDocument();
    expect(create).toHaveBeenCalledWith('DIRITTO_CIVILE');
    expect(progress()).toHaveAttribute('aria-valuenow', '0');
    expect(progress()).toHaveAttribute('aria-valuemax', '5');

    // A multiple choice: the tap answers.
    await user.click(screen.getByRole('button', { name: 'Il ritardo' }));
    expect(answer).toHaveBeenLastCalledWith('lez-1', 0, 0);
    expect(await screen.findByRole('status')).toHaveTextContent('Giusto!');
    expect(progress()).toHaveAttribute('aria-valuenow', '1');
    await user.click(screen.getByRole('button', { name: 'Continua' }));

    // True or false: wrong, the right answer said.
    expect(screen.getByText('Lo scioglimento del contratto.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Falso' }));
    expect(answer).toHaveBeenLastCalledWith('lez-1', 1, false);
    expect(await screen.findByRole('status')).toHaveTextContent('Non è così. La risposta giusta: Vero.');
    await user.click(screen.getByRole('button', { name: 'Continua' }));

    // Fill in the word.
    expect(screen.getByText('Un modo di acquisto della _____.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'proprietà' }));
    await user.click(await screen.findByRole('button', { name: 'Continua' }));

    // The match: a select per article, «Verifica» once each has an institute.
    const check = screen.getByRole('button', { name: 'Verifica' });
    expect(check).toBeDisabled();
    await user.selectOptions(screen.getByRole('combobox', { name: 'art. 1453 codice civile' }), 'Risoluzione');
    await user.selectOptions(screen.getByRole('combobox', { name: 'art. 2043 codice civile' }), 'Fatto illecito');
    await user.click(check);
    expect(answer).toHaveBeenLastCalledWith('lez-1', 3, [1, 0]);
    await user.click(await screen.findByRole('button', { name: 'Continua' }));

    // The last one ends the lesson.
    await user.click(screen.getByRole('button', { name: 'A' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Non è così. La risposta giusta: C.');
    await user.click(screen.getByRole('button', { name: 'Continua' }));
    const end = await screen.findByRole('region', { name: 'Lezione finita' });
    expect(end).toHaveTextContent('3 giuste su 5');
    expect(end).toHaveTextContent('+10 XP');
    expect(within(end).getByRole('link', { name: 'Torna a Oggi' })).toHaveAttribute('href', '/learn/ripasso');
  });

  it('says so when the server credited nothing, with no number of its own', async () => {
    create.mockResolvedValue({ ...LESSON, esercizi: LESSON.esercizi.slice(0, 1) });
    answer.mockResolvedValueOnce(graded(0, true, 0, { giuste: 1, totale: 1, xp: xp(0) }));
    const user = userEvent.setup();
    renderLesson();
    await user.click(await screen.findByRole('button', { name: 'Il ritardo' }));
    await user.click(await screen.findByRole('button', { name: 'Continua' }));
    const end = await screen.findByRole('region', { name: 'Lezione finita' });
    expect(end).toHaveTextContent('Per oggi le lezioni non danno più punti.');
    expect(end).not.toHaveTextContent('XP');
  });

  it('says the server\'s reason when the subject has too few cards', async () => {
    create.mockRejectedValue({ status: 409, data: { detail: 'Per una lezione servono almeno 4 schede in questa materia (ne hai 2).' } });
    renderLesson();
    expect(await screen.findByText('Per una lezione servono almeno 4 schede in questa materia (ne hai 2).')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Torna a Oggi' })).toBeInTheDocument();
  });

  it('offers «Riprova» when an answer cannot be sent, and sends it again', async () => {
    create.mockResolvedValue(LESSON);
    answer.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(graded(0, true, 0));
    const user = userEvent.setup();
    renderLesson();
    await user.click(await screen.findByRole('button', { name: 'Il ritardo' }));
    expect(await screen.findByText('Non riesco a inviare la risposta.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(answer).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('status')).toHaveTextContent('Giusto!');
  });

  it('shows the end when the last answer is sent again after its response was lost', async () => {
    create.mockResolvedValue({ ...LESSON, esercizi: LESSON.esercizi.slice(0, 1) });
    answer
      .mockRejectedValueOnce(new Error('lost'))
      .mockResolvedValueOnce({ registrata: false, indice: 0, giusta: true, soluzione: 0, fine: { giuste: 1, totale: 1, xp: xp(10) } });
    const user = userEvent.setup();
    renderLesson();
    await user.click(await screen.findByRole('button', { name: 'Il ritardo' }));
    await user.click(await screen.findByRole('button', { name: 'Riprova' }));
    const next = await screen.findByRole('button', { name: 'Continua' });
    // The correction is the button's description: a screen reader hears it with the focus.
    expect(next).toHaveAccessibleDescription('Giusto!');
    await user.click(next);
    expect(await screen.findByRole('region', { name: 'Lezione finita' })).toHaveTextContent('+10 XP');
  });

  it('reads no subject it does not know', async () => {
    renderLesson('DIRITTO_ROMANO');
    expect(await screen.findByText('Materia non riconosciuta.')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  describe('closing', () => {
    const close = () => screen.getByRole('button', { name: 'Chiudi la lezione' });
    const firstRight = async (user: ReturnType<typeof userEvent.setup>) => {
      await screen.findByText('Che cos’è la mora?');
      await user.click(screen.getByRole('button', { name: 'Il ritardo' }));
      await screen.findByRole('status');
    };

    it('leaves at once before the first answer', async () => {
      create.mockResolvedValue(LESSON);
      const user = userEvent.setup();
      renderLesson();
      await screen.findByText('Che cos’è la mora?');
      await user.click(close());
      expect(screen.getByText('Oggi')).toBeInTheDocument();
    });

    it('asks first once an answer is given: «Continua la lezione» stays, «Interrompi» leaves', async () => {
      create.mockResolvedValue(LESSON);
      answer.mockResolvedValueOnce(graded(0, true, 0));
      const user = userEvent.setup();
      renderLesson();
      await firstRight(user);
      await user.click(close());
      const dialog = screen.getByRole('alertdialog', { name: 'Interrompere la lezione?' });
      await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Continua la lezione' })).toHaveFocus());
      await user.click(within(dialog).getByRole('button', { name: 'Continua la lezione' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      expect(screen.getByText('Che cos’è la mora?')).toBeInTheDocument();
      await user.click(close());
      await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Interrompi' }));
      expect(screen.getByText('Oggi')).toBeInTheDocument();
    });

    it('asks on Esc too, and an Esc in the question only closes the question', async () => {
      create.mockResolvedValue(LESSON);
      answer.mockResolvedValueOnce(graded(0, true, 0));
      const user = userEvent.setup();
      renderLesson();
      await firstRight(user);
      await user.keyboard('{Escape}');
      expect(screen.getByRole('alertdialog', { name: 'Interrompere la lezione?' })).toBeInTheDocument();
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      expect(screen.getByText('Che cos’è la mora?')).toBeInTheDocument();
    });

    it('leaves at once from the end', async () => {
      create.mockResolvedValue({ ...LESSON, esercizi: LESSON.esercizi.slice(0, 1) });
      answer.mockResolvedValueOnce(graded(0, true, 0, { giuste: 1, totale: 1, xp: xp(10) }));
      const user = userEvent.setup();
      renderLesson();
      await firstRight(user);
      await user.click(screen.getByRole('button', { name: 'Continua' }));
      await user.click(close());
      expect(screen.getByText('Oggi')).toBeInTheDocument();
    });
  });
});
