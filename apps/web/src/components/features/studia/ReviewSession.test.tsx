import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('../../../services/studiaService', () => ({
  studiaService: { session: vi.fn(), review: vi.fn(), progress: vi.fn() },
}));

// The reader is tested with the dossier; here it is a stand-in that shows which article it was given.
vi.mock('../dossier/DossierItemReader', () => ({
  DossierItemReader: ({ norma, onOpenOnDashboard }: { norma: { tipo_atto: string; numero_articolo: string }; onOpenOnDashboard: () => void }) => (
    <div data-testid="article-reader">
      {norma.tipo_atto} art. {norma.numero_articolo}
      <button type="button" onClick={onOpenOnDashboard}>Apri nel lettore</button>
    </div>
  ),
}));

import { studiaService } from '../../../services/studiaService';
import { appStore } from '../../../store/useAppStore';
import { Z_INDEX } from '../../../constants/zIndex';
import type { Progressi, SchedaDiRipasso } from '../../../types/studia';
import { SESSION_NOTICE_MS } from './progress/Celebration';
import { ReviewSession } from './ReviewSession';

const session = vi.mocked(studiaService.session);
const review = vi.mocked(studiaService.review);
const progress = vi.mocked(studiaService.progress);

const CELEBRATED_KEY = 'visualex.studia.festeggiato';

/** The dashboard's read as the end screen asks it: today's goal and the streak. */
const progressAnswer = (ripassi: number, raggiunto: boolean, serie: number): Progressi => ({
  oggi: { giorno: '2026-10-19', ripassi, obiettivo: 10, raggiunto, dovute: 0, nuove: 0 },
  serie: { attuale: serie, record: 9, ultimiGiorni: ['13', '14', '15', '16', '17', '18', '19'].map((d) => ({ giorno: `2026-10-${d}`, stato: 'fatto' as const })) },
  stati: { nuove: 0, apprendimento: 1, consolidate: 0 },
  materie: [],
  calendario: [],
  prossimi: [],
});

const CIVILE_URN = 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453';

const card = (id: string, extra: Partial<SchedaDiRipasso> = {}): SchedaDiRipasso => ({
  id, materia: 'DIRITTO_CIVILE', istituto: 'Risoluzione per inadempimento', tipo: 'ISTITUTO_DEFINIZIONE',
  domanda: `Domanda ${id}?`, risposta: `Risposta ${id}.`, spiegazione: null, stato: 'BOZZA_PERSONALE',
  createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T10:00:00Z', origine: null,
  ancore: [{ normaKey: 'codice_civile', articleId: 'art_1453', urn: CIVILE_URN, isPrimary: true }],
  nuova: false, comunita: false, anteprima: { '1': 1, '2': 3, '3': 8, '4': 21 },
  ...extra,
});

/** jsdom has no viewport: the desktop's layout is chosen here. */
function setDesktop(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

function renderSession(cards: SchedaDiRipasso[], path = '/studia/ripasso/sessione') {
  session.mockResolvedValue({ conteggi: { dovute: cards.length, nuove: 0 }, cards });
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Where />} />
        <Route path="/studia/ripasso" element={<><p>Landing</p><Where /></>} />
        <Route path="/studia/ripasso/sessione" element={<ReviewSession />} />
      </Routes>
    </MemoryRouter>,
  );
}

const show = async () => userEvent.setup().click(await screen.findByRole('button', { name: /Mostra risposta/ }));

beforeEach(() => {
  setDesktop(true);
  session.mockReset();
  review.mockReset();
  review.mockResolvedValue({ registrata: true, prossimoRipasso: '2026-10-12', scheduledDays: 1 });
  progress.mockReset();
  progress.mockResolvedValue(progressAnswer(3, false, 2));
  localStorage.removeItem(CELEBRATED_KEY);
  appStore.setState({ searchTrigger: null });
});

afterEach(() => setDesktop(false));

describe('the review session', () => {
  it('asks for the session of the subject in the address', async () => {
    renderSession([card('a')], '/studia/ripasso/sessione?materia=DIRITTO_PENALE');
    await screen.findByText('Domanda a?');
    expect(session).toHaveBeenCalledWith('DIRITTO_PENALE');
  });

  it('ignores a subject it does not know', async () => {
    renderSession([card('a')], '/studia/ripasso/sessione?materia=toString');
    await screen.findByText('Domanda a?');
    expect(session).toHaveBeenCalledWith(undefined);
  });

  it('counts what remains in words that cannot be read as an anchor', async () => {
    renderSession([card('a'), card('b')]);
    expect(await screen.findByText('Restano 2')).toBeInTheDocument();
    await show();
    await userEvent.setup().click(screen.getByRole('button', { name: /Bene/ }));
    expect(await screen.findByText('Resta 1')).toBeInTheDocument();
  });

  it('sets the question, and then the answer, in a serif container', async () => {
    renderSession([card('a', { spiegazione: 'Perché sì.' })]);
    const question = await screen.findByRole('heading', { name: 'Domanda a?' });
    expect(question).toHaveClass('font-serif');
    expect(question).toHaveClass('max-w-[60ch]');
    expect(screen.getByText('art. 1453 c.c.')).toBeInTheDocument();
    expect(screen.queryByText('Risposta a.')).not.toBeInTheDocument();

    await show();
    expect(screen.getByText('Risposta a.')).toHaveClass('font-serif');
    expect(screen.getByText('Perché sì.')).toBeInTheDocument();
  });

  it('shows plain text as text, never as markup', async () => {
    renderSession([card('x', { domanda: '<img src=x onerror=alert(1)>', risposta: '<b>grassetto</b>' })]);
    expect(await screen.findByRole('heading', { name: '<img src=x onerror=alert(1)>' })).toBeInTheDocument();
    await show();
    expect(screen.getByText('<b>grassetto</b>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(document.querySelector('article b')).toBeNull();
  });

  it('shows the interval large and the grade small on each button, «Di nuovo» in the warning tone', async () => {
    renderSession([card('a')]);
    await show();
    const group = screen.getByRole('group', { name: 'Come è andata?' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['domaniDi nuovo', '3 giorniDifficile', '8 giorniBene', '21 giorniFacile']);
    const hard = screen.getByRole('button', { name: /Difficile/ });
    expect(within(hard).getByText('3 giorni')).toHaveClass('text-base', 'font-semibold');
    expect(within(hard).getByText('Difficile')).toHaveClass('text-xs');
    expect(buttons[0]).toHaveClass('bg-amber-50');
    expect(buttons[1]).not.toHaveClass('bg-amber-50');
    buttons.forEach((b) => expect(b).toHaveClass('min-h-[44px]'));
  });

  it('pins the bar to the bottom on a phone and puts it in the flow from md up', async () => {
    renderSession([card('a')]);
    const reveal = await screen.findByRole('button', { name: /Mostra risposta/ });
    expect(reveal.parentElement).toHaveClass('fixed', 'inset-x-0', 'bottom-0', 'md:static', Z_INDEX.pinnedBar);
    expect(reveal).toHaveClass('min-h-[44px]');
    expect(within(reveal).getByText('Spazio')).toBeInTheDocument();
  });

  describe('the reveal motion', () => {
    it('draws the hairline and unfolds the answer under motion-safe only', async () => {
      renderSession([card('a')]);
      await show();
      const rule = document.querySelector('hr') as HTMLElement;
      const answer = screen.getByText('Risposta a.').parentElement as HTMLElement;
      expect(rule).toHaveClass('motion-safe:animate-vlx-rule');
      expect(answer).toHaveClass('motion-safe:animate-vlx-unfold');
      // Reduced motion applies none of the `motion-safe:` classes, so nothing else may animate or transition.
      for (const element of [rule, answer]) {
        const bare = [...element.classList].filter((c) => /^(animate|transition|duration)/.test(c));
        expect(bare).toEqual([]);
      }
    });

    it('has nothing under the question before the reveal', async () => {
      renderSession([card('a')]);
      await screen.findByText('Domanda a?');
      expect(document.querySelector('hr')).toBeNull();
    });
  });

  describe('the keyboard', () => {
    it('shows the answer on space and grades with 1–4', async () => {
      renderSession([card('a'), card('b')]);
      await screen.findByText('Domanda a?');
      fireEvent.keyDown(document.body, { key: '3' });
      expect(review).not.toHaveBeenCalled();
      fireEvent.keyDown(document.body, { key: ' ' });
      expect(await screen.findByText('Risposta a.')).toBeInTheDocument();
      fireEvent.keyDown(document.body, { key: '3' });
      expect(await screen.findByText('Domanda b?')).toBeInTheDocument();
      expect(review).toHaveBeenCalledWith(expect.objectContaining({ cardId: 'a', rating: 3 }));
      expect(screen.queryByText('Risposta b.')).not.toBeInTheDocument();
    });

    it('asks before stopping on Esc, and goes back to the landing on confirm', async () => {
      renderSession([card('a')]);
      await screen.findByText('Domanda a?');
      fireEvent.keyDown(document.body, { key: 'Escape' });
      const dialog = await screen.findByRole('alertdialog', { name: 'Interrompere il ripasso?' });
      expect(within(dialog).getByText('Le schede già valutate restano registrate.')).toBeInTheDocument();
      // The dialog has the keyboard: space behind it shows nothing.
      fireEvent.keyDown(document.body, { key: ' ' });
      expect(screen.queryByText('Risposta a.')).not.toBeInTheDocument();
      await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Interrompi' }));
      expect(await screen.findByText('Landing')).toBeInTheDocument();
    });

    it('keeps the session when the user goes on', async () => {
      renderSession([card('a')]);
      await screen.findByText('Domanda a?');
      await userEvent.setup().click(screen.getByRole('button', { name: 'Interrompi' }));
      await userEvent.setup().click(await screen.findByRole('button', { name: 'Continua' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(screen.getByText('Domanda a?')).toBeInTheDocument();
    });
  });

  it('keeps the card, shown, with «Non registrato: riprova» when the grade fails, and grades again', async () => {
    renderSession([card('a'), card('b')]);
    await show();
    review.mockRejectedValueOnce(new Error('offline'));
    await userEvent.setup().click(screen.getByRole('button', { name: /Bene/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Non registrato: riprova');
    expect(screen.getByText('Risposta a.')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /Bene/ }));
    expect(await screen.findByText('Domanda b?')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  describe("an anchor's article", () => {
    it('opens beside the card on desktop, the session stays as it was, and closes', async () => {
      renderSession([card('a'), card('b')]);
      await show();
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'art. 1453 c.c.' }));
      const panel = screen.getByRole('complementary', { name: 'Articolo' });
      expect(within(panel).getByTestId('article-reader')).toHaveTextContent('codice civile art. 1453');
      expect(screen.getByText('Domanda a?')).toBeInTheDocument();
      expect(screen.getByText('Risposta a.')).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Come è andata?' })).toBeInTheDocument();

      await user.click(within(panel).getByRole('button', { name: 'Chiudi l’articolo' }));
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
      expect(screen.getByText('Risposta a.')).toBeInTheDocument();
      expect(review).not.toHaveBeenCalled();
    });

    it('goes when the card is graded', async () => {
      renderSession([card('a'), card('b')]);
      await show();
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'art. 1453 c.c.' }));
      await user.click(screen.getByRole('button', { name: /Bene/ }));
      await screen.findByText('Domanda b?');
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    });

    it('opens in a bottom sheet on a phone, which the find shortcut leaves to the browser', async () => {
      setDesktop(false);
      renderSession([card('a')]);
      await show();
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'art. 1453 c.c.' }));
      const sheet = await screen.findByRole('dialog', { name: 'art. 1453 c.c.' });
      expect(within(sheet).getByTestId('article-reader')).toBeInTheDocument();
      expect(sheet).toHaveClass('fixed', 'inset-x-0', 'bottom-0');
      expect(sheet).toHaveAttribute('data-find-overlay');
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
      expect(screen.getByText('Domanda a?')).toBeInTheDocument();

      // The sheet owns the keyboard: space behind it does nothing, Esc closes it and not the session.
      fireEvent.keyDown(document.body, { key: '3' });
      expect(review).not.toHaveBeenCalled();
      fireEvent.keyDown(document.body, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(screen.getByText('Risposta a.')).toBeInTheDocument();
    });

    it('closes with the first Esc and asks to stop on the second, on desktop', async () => {
      renderSession([card('a')]);
      await show();
      await userEvent.setup().click(screen.getByRole('button', { name: 'art. 1453 c.c.' }));
      expect(screen.getByRole('complementary', { name: 'Articolo' })).toBeInTheDocument();
      fireEvent.keyDown(document.body, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeInTheDocument());
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(await screen.findByRole('alertdialog', { name: 'Interrompere il ripasso?' })).toBeInTheDocument();
    });

    it('does not come back by itself when a «Di nuovo» card returns', async () => {
      renderSession([card('a')]);
      await show();
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'art. 1453 c.c.' }));
      expect(screen.getByRole('complementary')).toBeInTheDocument();
      // The only card goes back to the queue and is the next one: same card, new pass.
      await user.click(screen.getByRole('button', { name: /Di nuovo/ }));
      await screen.findByRole('button', { name: /Mostra risposta/ });
      expect(screen.getByText('Domanda a?')).toBeInTheDocument();
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
      await show();
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    });

    it('can be left for the reader, which takes the session’s place', async () => {
      renderSession([card('a')]);
      await show();
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'art. 1453 c.c.' }));
      await user.click(screen.getByRole('button', { name: 'Apri nel lettore' }));
      expect(screen.getByTestId('where')).toHaveTextContent('/');
      expect(appStore.getState().searchTrigger).toMatchObject({ act_type: 'codice civile', article: '1453', version: 'vigente' });
    });

    it('is not offered for an anchor whose address names no article', async () => {
      renderSession([card('a', { ancore: [{ normaKey: 'x', articleId: 'y', urn: 'non è un indirizzo', isPrimary: true }] })]);
      await show();
      expect(screen.queryByRole('region', { name: 'Articoli' })).not.toBeInTheDocument();
    });
  });

  it('says a card left the review, and shows the next question', async () => {
    renderSession([card('a'), card('b')]);
    await show();
    review.mockRejectedValueOnce({ status: 404, message: 'Scheda non trovata', data: {} });
    await userEvent.setup().click(screen.getByRole('button', { name: /Bene/ }));
    expect(await screen.findByText('Domanda b?')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Questa scheda non è più da ripassare.');
    expect(screen.queryByText('Non registrato: riprova')).not.toBeInTheDocument();
    await show();
    expect(screen.queryByText('Questa scheda non è più da ripassare.')).not.toBeInTheDocument();
  });

  it('says it on the end screen too, when the card that left was the last', async () => {
    renderSession([card('a')]);
    await show();
    review.mockRejectedValueOnce({ status: 404, message: 'Scheda non trovata', data: {} });
    await userEvent.setup().click(screen.getByRole('button', { name: /Bene/ }));
    expect(await screen.findByText('Nessuna scheda da ripassare per ora.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Questa scheda non è più da ripassare.');
  });

  describe('a pass for practice', () => {
    it('shows the grade names alone, with a line saying nothing is recorded', async () => {
      renderSession([card('a'), card('b')]);
      const user = userEvent.setup();
      await show();
      expect(screen.queryByText('Ripasso di pratica: non registrato')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /Di nuovo/ }));
      await show();
      await user.click(screen.getByRole('button', { name: /Bene/ }));
      // «a» is back for its second pass.
      await screen.findByText('Domanda a?');
      await show();
      expect(screen.getByText('Ripasso di pratica: non registrato')).toBeInTheDocument();
      const buttons = within(screen.getByRole('group', { name: 'Come è andata?' })).getAllByRole('button');
      expect(buttons.map((b) => b.textContent)).toEqual(['Di nuovo', 'Difficile', 'Bene', 'Facile']);
    });
  });

  describe('focus', () => {
    it('goes to the question when a card is shown, to the answer when it is revealed, to the next question after a grade', async () => {
      renderSession([card('a'), card('b')]);
      const question = await screen.findByRole('heading', { name: 'Domanda a?' });
      await waitFor(() => expect(question).toHaveFocus());
      await show();
      const answer = screen.getByRole('group', { name: 'Risposta' });
      await waitFor(() => expect(answer).toHaveFocus());
      expect(answer).toHaveTextContent('Risposta a.');
      await userEvent.setup().click(screen.getByRole('button', { name: /Bene/ }));
      const next = await screen.findByRole('heading', { name: 'Domanda b?' });
      await waitFor(() => expect(next).toHaveFocus());
    });

    it('goes back to the question when the same card comes straight back', async () => {
      renderSession([card('a')]);
      await show();
      await userEvent.setup().click(screen.getByRole('button', { name: /Di nuovo/ }));
      const question = await screen.findByRole('heading', { name: 'Domanda a?' });
      await waitFor(() => expect(question).toHaveFocus());
    });
  });

  it('lets a long answer scroll: space is the page’s once the answer is shown', async () => {
    renderSession([card('a')]);
    await screen.findByText('Domanda a?');
    expect(fireEvent.keyDown(document.body, { key: ' ' })).toBe(false);
    await screen.findByText('Risposta a.');
    expect(fireEvent.keyDown(document.body, { key: ' ' })).toBe(true);
  });

  it('does not grade the next card with a key pressed after the previous grade went through', async () => {
    let finish: (value: Awaited<ReturnType<typeof studiaService.review>>) => void = () => {};
    review.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderSession([card('a'), card('b')]);
    await screen.findByText('Domanda a?');
    fireEvent.keyDown(document.body, { key: ' ' });
    await screen.findByText('Risposta a.');
    fireEvent.keyDown(document.body, { key: '3' });
    finish({ registrata: true, prossimoRipasso: '2026-10-15', scheduledDays: 3 });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    fireEvent.keyDown(document.body, { key: '3' });
    expect(await screen.findByText('Domanda b?')).toBeInTheDocument();
    expect(review).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Risposta b.')).not.toBeInTheDocument();
  });

  describe('the end', () => {
    async function gradeAll(grades: Array<1 | 2 | 3 | 4>) {
      const user = userEvent.setup();
      const labels = { 1: /Di nuovo/, 2: /Difficile/, 3: /Bene/, 4: /Facile/ };
      for (const rating of grades) {
        await user.click(await screen.findByRole('button', { name: /Mostra risposta/ }));
        await user.click(screen.getByRole('button', { name: labels[rating] }));
      }
    }

    it('says how many were reviewed, how many again, and when the next ones are due', async () => {
      review.mockResolvedValue({ registrata: true, prossimoRipasso: '2026-10-12', scheduledDays: 1 });
      renderSession([card('a'), card('b'), card('c')]);
      // a «Di nuovo», b «Bene», c «Bene», then a again «Bene» (not sent).
      await gradeAll([1, 3, 3, 3]);
      expect(await screen.findByText('Hai ripassato 3 schede, 1 da rifare. Le prossime: domani.')).toBeInTheDocument();
      expect(review).toHaveBeenCalledTimes(3);
      await userEvent.setup().click(screen.getByRole('button', { name: 'Torna al ripasso' }));
      expect(await screen.findByText('Landing')).toBeInTheDocument();
    });

    it('uses the singular for one card', async () => {
      renderSession([card('a')]);
      await gradeAll([1, 3]);
      expect(await screen.findByText('Hai ripassato 1 scheda, 1 da rifare. Le prossime: domani.')).toBeInTheDocument();
    });

    it('says «nessuna da rifare» when every card went well', async () => {
      review.mockResolvedValue({ registrata: true, prossimoRipasso: '2026-10-19', scheduledDays: 8 });
      renderSession([card('a'), card('b')]);
      await gradeAll([3, 3]);
      expect(await screen.findByText('Hai ripassato 2 schede, nessuna da rifare. Le prossime: 8 giorni.')).toBeInTheDocument();
    });

    it('shows today’s goal and the streak as they now stand', async () => {
      progress.mockResolvedValue(progressAnswer(11, true, 6));
      renderSession([card('a')]);
      await gradeAll([3]);
      expect(await screen.findByRole('img', { name: 'Obiettivo di oggi: 11 di 10 ripassi, raggiunto' })).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Serie: 6 giorni di fila, record 9' })).toBeInTheDocument();
    });

    it('does not claim a review when the session was empty', async () => {
      renderSession([]);
      expect(await screen.findByText('Nessuna scheda da ripassare per ora.')).toBeInTheDocument();
    });
  });

  it('offers a retry when the session cannot be read', async () => {
    session.mockRejectedValueOnce(new Error('down'));
    render(
      <MemoryRouter initialEntries={['/studia/ripasso/sessione']}>
        <Routes><Route path="/studia/ripasso/sessione" element={<ReviewSession />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Non riesco a leggere le schede da ripassare.');
    session.mockResolvedValue({ conteggi: { dovute: 1, nuove: 0 }, cards: [card('a')] });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText('Domanda a?')).toBeInTheDocument();
  });
});

describe('the goal of the day in the session (Studia progress spec §6.4)', () => {
  const closing = { registrata: true, prossimoRipasso: '2026-10-21', scheduledDays: 2, oggi: { giorno: '2026-10-19', ripassi: 10, obiettivo: 10, raggiunto: true, appenaRaggiunto: true, serie: 3 } };
  const open = { registrata: true, prossimoRipasso: '2026-10-21', scheduledDays: 2, oggi: { giorno: '2026-10-19', ripassi: 9, obiettivo: 10, raggiunto: false, appenaRaggiunto: false, serie: 2 } };

  it('celebrates on the grade that closes the goal, remembers the day at once, says it to a screen reader, and is gone in 1.5 s', async () => {
    review.mockResolvedValueOnce(open).mockResolvedValueOnce(closing);
    renderSession([card('a'), card('b'), card('c')]);
    const user = userEvent.setup();
    await show();
    await user.click(screen.getByRole('button', { name: /Bene/ }));
    expect(screen.queryByText('Serie di 3 giorni')).not.toBeInTheDocument();
    await show();
    await user.click(screen.getByRole('button', { name: /Bene/ }));

    expect(await screen.findByText('Serie di 3 giorni')).toBeInTheDocument();
    expect(localStorage.getItem(CELEBRATED_KEY)).toBe('2026-10-19');
    expect(screen.getByText('Obiettivo di oggi raggiunto · serie di 3 giorni')).toBeInTheDocument();
    expect(SESSION_NOTICE_MS).toBeLessThanOrEqual(1500);
    await waitFor(() => expect(screen.queryByText('Serie di 3 giorni')).not.toBeInTheDocument(), { timeout: SESSION_NOTICE_MS + 1000 });
  });

  it('leaves the keys to the review while it plays: space reveals, a number grades', async () => {
    review.mockResolvedValueOnce(closing);
    renderSession([card('a'), card('b')]);
    await show();
    await userEvent.setup().click(screen.getByRole('button', { name: /Bene/ }));
    expect(await screen.findByText('Serie di 3 giorni')).toBeInTheDocument();

    expect(await screen.findByText('Domanda b?')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(await screen.findByText('Risposta b.')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: '3' });
    await waitFor(() => expect(review).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('session-celebration')).toBeInTheDocument();
  });

  it('sits in the page over the header row, never fixed over the card', async () => {
    review.mockResolvedValueOnce(closing);
    renderSession([card('a'), card('b')]);
    await show();
    await userEvent.setup().click(screen.getByRole('button', { name: /Bene/ }));
    const notice = await screen.findByTestId('session-celebration');
    expect(notice.className).toContain('absolute');
    expect(notice.className).not.toContain('fixed');
    expect(notice.className).toContain('pointer-events-none');
  });

  it('does not celebrate twice in a day on this browser', async () => {
    localStorage.setItem(CELEBRATED_KEY, '2026-10-19');
    review.mockResolvedValueOnce(closing);
    renderSession([card('a'), card('b')]);
    await show();
    await userEvent.setup().click(screen.getByRole('button', { name: /Bene/ }));
    expect(await screen.findByText('Obiettivo di oggi raggiunto · serie di 3 giorni')).toBeInTheDocument();
    expect(screen.queryByText('Serie di 3 giorni')).not.toBeInTheDocument();
  });
});
