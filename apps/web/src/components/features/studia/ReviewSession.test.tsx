import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('../../../services/studiaService', () => ({
  studiaService: { session: vi.fn(), review: vi.fn(), progress: vi.fn(), percorso: vi.fn() },
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
import { GRADE_NOTE_MS } from './useGradeNote';
import { LESSON_PRIMARY } from './lessonStyles';
import { ReviewSession } from './ReviewSession';
import { xpFields } from './__fixtures__/xp';

const session = vi.mocked(studiaService.session);
const review = vi.mocked(studiaService.review);
const progress = vi.mocked(studiaService.progress);
const percorso = vi.mocked(studiaService.percorso);

const CELEBRATED_KEY = 'visualex.studia.festeggiato';

/** The dashboard's read as the end screen asks it: today's goal and the streak. */
const progressAnswer = (ripassi: number, raggiunto: boolean, serie: number): Progressi => ({
  oggi: { giorno: '2026-10-19', ripassi, obiettivo: 10, raggiunto, dovute: 0, nuove: 0 },
  serie: { attuale: serie, record: 9, ultimiGiorni: ['13', '14', '15', '16', '17', '18', '19'].map((d) => ({ giorno: `2026-10-${d}`, stato: 'fatto' as const })) },
  stati: { nuove: 0, apprendimento: 1, consolidate: 0 },
  materie: [],
  calendario: [],
  prossimi: [],
  ...xpFields(),
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
/** The first card graded, «Bene», and the next one drawn: «Interrompi» asks only from one card graded on (U1c). */
const gradeFirst = async (next: string) => {
  await show();
  await userEvent.setup().click(screen.getByRole('button', { name: /Bene/ }));
  await screen.findByText(`Domanda ${next}?`);
};

beforeEach(() => {
  setDesktop(true);
  session.mockReset();
  review.mockReset();
  review.mockResolvedValue({ registrata: true, prossimoRipasso: '2026-10-12', scheduledDays: 1 });
  progress.mockReset();
  progress.mockResolvedValue(progressAnswer(3, false, 2));
  percorso.mockReset();
  percorso.mockResolvedValue([]);
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

  it('asks for the session of one institute of the subject, spelt as the road gave it (G5)', async () => {
    const istituto = 'Risoluzione per inadempimento (art. 1453 c.c.) & 50% «diffida»';
    renderSession([card('a')], `/studia/ripasso/sessione?${new URLSearchParams({ materia: 'DIRITTO_CIVILE', istituto })}`);
    await screen.findByText('Domanda a?');
    expect(session).toHaveBeenCalledWith('DIRITTO_CIVILE', istituto);
  });

  it('ignores an institute without its subject, which the server would refuse', async () => {
    renderSession([card('a')], '/studia/ripasso/sessione?istituto=Mora');
    await screen.findByText('Domanda a?');
    expect(session).toHaveBeenCalledWith(undefined);
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
    // Over the 44 px floor: the grades are the lesson's targets, pressed a hundred times a session.
    buttons.forEach((b) => expect(b).toHaveClass('min-h-[56px]'));
  });

  it('holds the one action in the bar at the foot on every width, over the phone\'s safe edge (Gymnasium spec §5.4)', async () => {
    renderSession([card('a')]);
    const reveal = await screen.findByRole('button', { name: /Mostra risposta/ });
    const bar = screen.getByTestId('lesson-bar');
    expect(bar).toContainElement(reveal);
    // The last of the lesson's rows, in the flow of its frame: never fixed, never put back in the page from md up.
    expect(bar).toHaveClass('shrink-0', 'pb-[max(0.75rem,env(safe-area-inset-bottom))]', Z_INDEX.pinnedBar);
    expect(bar.className).not.toMatch(/\bfixed\b|md:static/);
    expect(reveal).toHaveClass('min-h-[48px]');
    expect(within(reveal).getByText('Spazio')).toBeInTheDocument();
    await show();
    expect(bar).toContainElement(screen.getByRole('group', { name: 'Come è andata?' }));
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
      renderSession([card('z'), card('a')]);
      await gradeFirst('a');
      fireEvent.keyDown(document.body, { key: 'Escape' });
      const dialog = await screen.findByRole('alertdialog', { name: 'Interrompere il ripasso?' });
      // What happens, with the session's count (U1c).
      expect(within(dialog).getByText('Hai ripassato 1 scheda: resta registrata. L’altra ti aspetta in «Oggi».')).toBeInTheDocument();
      // The dialog has the keyboard: space behind it shows nothing.
      fireEvent.keyDown(document.body, { key: ' ' });
      expect(screen.queryByText('Risposta a.')).not.toBeInTheDocument();
      await waitFor(() => expect(dialog).toHaveAttribute('data-ready'));
      await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Interrompi' }));
      expect(await screen.findByText('Landing')).toBeInTheDocument();
    });

    it('keeps the session when the user goes on', async () => {
      renderSession([card('z'), card('a')]);
      await gradeFirst('a');
      await userEvent.setup().click(screen.getByRole('button', { name: 'Interrompi' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Interrompere il ripasso?' });
      await waitFor(() => expect(dialog).toHaveAttribute('data-ready'));
      await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Continua il ripasso' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(screen.getByText('Domanda a?')).toBeInTheDocument();
    });

    it('makes going on the evident action: filled, on the right, the focus on it, Esc going on (U1c)', async () => {
      renderSession([card('z'), card('a')]);
      await gradeFirst('a');
      await userEvent.setup().click(screen.getByRole('button', { name: 'Interrompi' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Interrompere il ripasso?' });
      const [first, second] = within(dialog).getAllByRole('button');
      expect(first).toHaveAccessibleName('Interrompi');
      expect(second).toHaveAccessibleName('Continua il ripasso');
      // No red: stopping destroys nothing.
      expect(first.className).not.toMatch(/\bbg-red-/);
      await waitFor(() => expect(second).toHaveFocus());
      await userEvent.setup().keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(screen.getByText('Domanda a?')).toBeInTheDocument();
    });

    it('gives the focus back to the card on going on, so Space shows the answer and does not ask again', async () => {
      renderSession([card('z'), card('a')]);
      await gradeFirst('a');
      const user = userEvent.setup();
      await user.keyboard('{Escape}');
      const dialog = await screen.findByRole('alertdialog', { name: 'Interrompere il ripasso?' });
      await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Continua il ripasso' })).toHaveFocus());
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(screen.getByRole('heading', { name: 'Domanda a?' })).toHaveFocus();
      await user.keyboard(' ');
      expect(await screen.findByText('Risposta a.')).toBeInTheDocument();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    it('counts the cards graded, a «Di nuovo» too, its grade saved', async () => {
      renderSession([card('a'), card('b'), card('c')]);
      const user = userEvent.setup();
      await show();
      await user.click(screen.getByRole('button', { name: /Di nuovo/ }));
      await screen.findByText('Domanda b?');
      await show();
      await user.click(screen.getByRole('button', { name: /Bene/ }));
      await screen.findByText('Domanda c?');
      await user.click(screen.getByRole('button', { name: 'Interrompi' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Interrompere il ripasso?' });
      expect(dialog).toHaveTextContent('Hai ripassato 2 schede: restano registrate.');
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
      renderSession([card('z'), card('a')]);
      await gradeFirst('a');
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
      await userEvent.setup().click(screen.getByRole('button', { name: 'Torna a Oggi' }));
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

describe('the points of a grade in the session (G1c)', () => {
  const level = { livello: 2, totale: 120, nelLivello: 20, perIlProssimo: 125, oggi: 30 };
  const earning = { registrata: true, prossimoRipasso: '2026-10-21', scheduledDays: 2, xp: { crediti: [{ missione: 'dovute' as const, punti: 20 }], livello: level, nuovoLivello: false } };
  const nothing = { registrata: true, prossimoRipasso: '2026-10-21', scheduledDays: 2, xp: { crediti: [], livello: level, nuovoLivello: false } };
  afterEach(() => localStorage.removeItem('visualex.studia.visto'));

  it('shows «+20 XP» under the bar and says it politely, without holding the next card', async () => {
    review.mockResolvedValueOnce(earning);
    renderSession([card('a'), card('b')]);
    await show();
    await userEvent.setup().click(screen.getByRole('button', { name: /Bene/ }));
    // The next card is there at once, the chip beside the bar.
    expect(await screen.findByText('Domanda b?')).toBeInTheDocument();
    expect(screen.getByTestId('xp-gain')).toHaveTextContent('+20 XP');
    expect(screen.getByTestId('xp-gain').closest('header')).not.toBeNull();
    await waitFor(() => expect(screen.getByText('Hai guadagnato 20 punti.')).toBeInTheDocument());
    // The lesson showed it: «Oggi» will not show it again.
    expect(JSON.parse(localStorage.getItem('visualex.studia.visto')!)).toMatchObject({ xp: 120, livello: 2 });
  });

  it('waits for the goal’s notice when the same grade closes the goal, and never stands over it', async () => {
    const closing = { ...earning, oggi: { giorno: '2026-10-19', ripassi: 10, obiettivo: 10, raggiunto: true, appenaRaggiunto: true, serie: 3 } };
    review.mockResolvedValueOnce(closing);
    renderSession([card('a'), card('b')]);
    await show();
    await userEvent.setup().click(screen.getByRole('button', { name: /Bene/ }));
    expect(await screen.findByText('Serie di 3 giorni')).toBeInTheDocument();
    expect(screen.queryByTestId('xp-gain')).toBeNull();
    // The notice gone, the chip comes, in the header's row.
    await waitFor(() => expect(screen.queryByText('Serie di 3 giorni')).toBeNull(), { timeout: 3000 });
    const chip = await screen.findByTestId('xp-gain');
    expect(chip).toHaveTextContent('+20 XP');
    expect(chip.parentElement?.className).toContain('inset-y-0');
    expect(chip.parentElement?.className).not.toContain('top-full');
  });

  it('names the level a grade crosses', async () => {
    review.mockResolvedValueOnce({ ...earning, xp: { ...earning.xp, nuovoLivello: true } });
    renderSession([card('a'), card('b')]);
    await show();
    await userEvent.setup().click(screen.getByRole('button', { name: /Bene/ }));
    expect(await screen.findByTestId('xp-gain')).toHaveTextContent('+20 XP · Livello 2');
    await waitFor(() => expect(screen.getByText('Hai guadagnato 20 punti. Sei al livello 2.')).toBeInTheDocument());
  });

  it('shows nothing for a grade that earned nothing, or was not recorded', async () => {
    review.mockResolvedValueOnce(nothing).mockResolvedValueOnce({ registrata: false, prossimoRipasso: '2026-10-21', scheduledDays: 2 });
    renderSession([card('a'), card('b'), card('c')]);
    const user = userEvent.setup();
    await show();
    await user.click(screen.getByRole('button', { name: /Bene/ }));
    await show();
    await user.click(screen.getByRole('button', { name: /Bene/ }));
    expect(await screen.findByText('Domanda c?')).toBeInTheDocument();
    expect(screen.queryByTestId('xp-gain')).toBeNull();
  });
});

describe('the goal of the day in the session (Studia progress spec §6.4)', () => {
  // The grade that closes a goal of 10 also does its mission: the credit comes in the same answer.
  const closing = {
    registrata: true, prossimoRipasso: '2026-10-21', scheduledDays: 2,
    oggi: { giorno: '2026-10-19', ripassi: 10, obiettivo: 10, raggiunto: true, appenaRaggiunto: true, serie: 3 },
    xp: { crediti: [{ missione: 'obiettivo' as const, punti: 10 }], livello: { livello: 2, totale: 130, nelLivello: 30, perIlProssimo: 125, oggi: 10 }, nuovoLivello: false },
  };
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

  it('draws the goal\'s mark beside the words when the grade also does the goal\'s mission (G9)', async () => {
    review.mockResolvedValueOnce(closing);
    renderSession([card('a'), card('b')]);
    await show();
    await userEvent.setup().click(screen.getByRole('button', { name: /Bene/ }));
    const notice = await screen.findByTestId('session-celebration');
    expect(within(notice).getByTestId('goal-mark')).toBeInTheDocument();
    expect(localStorage.getItem(CELEBRATED_KEY)).toBe('2026-10-19');
  });

  it('says a goal of one\'s own under the mission\'s 10 reviews in words alone, and leaves «Oggi» to celebrate the mission (G9)', async () => {
    // A goal of 5 met at the 5th review: the day counts, the mission (10 reviews) is still open, no credit for it.
    const ownGoal = {
      registrata: true, prossimoRipasso: '2026-10-21', scheduledDays: 2,
      oggi: { giorno: '2026-10-19', ripassi: 5, obiettivo: 5, raggiunto: true, appenaRaggiunto: true, serie: 3 },
      xp: { crediti: [], livello: { livello: 2, totale: 120, nelLivello: 20, perIlProssimo: 125, oggi: 0 }, nuovoLivello: false },
    };
    review.mockResolvedValueOnce(ownGoal);
    renderSession([card('a'), card('b')]);
    await show();
    await userEvent.setup().click(screen.getByRole('button', { name: /Bene/ }));
    const notice = await screen.findByTestId('session-celebration');
    expect(within(notice).getByText('Serie di 3 giorni')).toBeInTheDocument();
    expect(within(notice).queryByTestId('goal-mark')).toBeNull();
    // Not celebrated for this browser: «Oggi» writes the mark, the first time, once the mission is done.
    expect(localStorage.getItem(CELEBRATED_KEY)).toBeNull();
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
    // The goal's mark, small, beside the words (G9): the red stamp is gone.
    expect(within(notice).getByTestId('goal-mark')).toBeInTheDocument();
    expect(within(notice).queryByTestId('goal-stamp')).toBeNull();
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

describe('the lesson (Gymnasium spec §5.4)', () => {
  const bar = () => screen.getByRole('progressbar', { name: 'Avanzamento del ripasso' });

  describe('the progress bar', () => {
    it('fills as cards leave the queue, done of done and remaining, and holds still on «Di nuovo»', async () => {
      const user = userEvent.setup();
      renderSession([card('a'), card('b'), card('c'), card('d')]);
      await screen.findByText('Domanda a?');
      expect(bar()).toHaveAttribute('aria-valuenow', '0');
      expect(bar()).toHaveAttribute('aria-valuemax', '4');
      expect(screen.getByTestId('lesson-progress-fill')).toHaveStyle({ width: '0%' });
      // The section's hue, not the ink's near-grey (G8).
      expect(screen.getByTestId('lesson-progress-fill')).toHaveClass('vlx-lesson-ink');

      await show();
      await user.click(screen.getByRole('button', { name: /Bene/ }));
      await screen.findByText('Domanda b?');
      expect(bar()).toHaveAttribute('aria-valuenow', '1');
      expect(bar()).toHaveAttribute('aria-valuetext', '1 di 4 schede');
      expect(screen.getByTestId('lesson-progress-fill')).toHaveStyle({ width: '25%' });

      // «b» goes to the back: nothing left the queue.
      await show();
      await user.click(screen.getByRole('button', { name: /Di nuovo/ }));
      await screen.findByText('Domanda c?');
      expect(bar()).toHaveAttribute('aria-valuenow', '1');
      expect(screen.getByText('Restano 3')).toHaveClass('sr-only');
    });

    it('eases under motion-safe only, so under reduced motion it jumps', async () => {
      renderSession([card('a')]);
      await screen.findByText('Domanda a?');
      const fill = screen.getByTestId('lesson-progress-fill');
      expect(fill).toHaveClass('motion-safe:transition-[width]');
      expect([...fill.classList].filter((c) => /^(transition|duration|ease|animate|delay)/.test(c))).toEqual([]);
    });

    it('runs its head ahead in the section’s hue and lets the ink catch up on a spring, under 400 ms (S2)', async () => {
      const user = userEvent.setup();
      renderSession([card('a'), card('b')]);
      await screen.findByText('Domanda a?');
      const fill = screen.getByTestId('lesson-progress-fill');
      const head = bar().querySelector('.vlx-lesson-head')!;
      expect(head).toHaveClass('motion-safe:transition-[width]', 'motion-safe:duration-150');
      expect(fill).toHaveClass('motion-safe:delay-[70ms]', 'motion-safe:duration-300', 'motion-safe:ease-(--ease-catch)');
      // The ink is drawn over the head: it comes after it.
      expect(head.compareDocumentPosition(fill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      await show();
      await user.click(screen.getByRole('button', { name: /Bene/ }));
      await screen.findByText('Domanda b?');
      expect(head).toHaveStyle({ width: '50%' });
      expect(fill).toHaveStyle({ width: '50%' });
    });

    it('is full at the end, and an empty track before the queue is read', async () => {
      session.mockReturnValueOnce(new Promise(() => {}));
      const { unmount } = render(
        <MemoryRouter initialEntries={['/studia/ripasso/sessione']}>
          <Routes><Route path="/studia/ripasso/sessione" element={<ReviewSession />} /></Routes>
        </MemoryRouter>,
      );
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(screen.getByTestId('lesson-progress-fill')).toHaveStyle({ width: '0%' });
      unmount();

      renderSession([card('a')]);
      await show();
      await userEvent.setup().click(screen.getByRole('button', { name: /Bene/ }));
      await screen.findByText(/Hai ripassato 1 scheda/);
      expect(bar()).toHaveAttribute('aria-valuenow', '1');
      expect(screen.getByTestId('lesson-progress-fill')).toHaveStyle({ width: '100%' });
    });
  });

  describe('the note after a grade', () => {
    it('says when the card comes back, from the interval the button showed, for about a second, without taking focus', async () => {
      renderSession([card('a'), card('b')]);
      await show();
      await userEvent.setup().click(screen.getByRole('button', { name: /Bene/ }));
      const question = await screen.findByRole('heading', { name: 'Domanda b?' });
      expect(screen.getByTestId('grade-note')).toHaveTextContent('Torna tra 8 giorni');
      expect(screen.getByTestId('grade-note')).toHaveClass('motion-safe:animate-vlx-note');
      expect(screen.getByTestId('lesson-bar')).toContainElement(screen.getByTestId('grade-note'));
      expect(document.activeElement).toBe(question);
      await waitFor(() => expect(screen.queryByTestId('grade-note')).not.toBeInTheDocument(), { timeout: GRADE_NOTE_MS + 1000 });
    });

    it('reads the grade given with a key as well', async () => {
      renderSession([card('a'), card('b')]);
      await screen.findByText('Domanda a?');
      fireEvent.keyDown(document.body, { key: ' ' });
      await screen.findByText('Risposta a.');
      fireEvent.keyDown(document.body, { key: '2' });
      await screen.findByText('Domanda b?');
      expect(screen.getByTestId('grade-note')).toHaveTextContent('Torna tra 3 giorni');
    });

    it('says «Torna in coda» for «Di nuovo», and nothing once the lesson is over', async () => {
      const user = userEvent.setup();
      renderSession([card('a'), card('b')]);
      await show();
      await user.click(screen.getByRole('button', { name: /Di nuovo/ }));
      await screen.findByText('Domanda b?');
      expect(screen.getByTestId('grade-note')).toHaveTextContent('Torna in coda');
      await show();
      await user.click(screen.getByRole('button', { name: /Facile/ }));
      await screen.findByText('Domanda a?');
      expect(screen.getByTestId('grade-note')).toHaveTextContent('Torna tra 21 giorni');
      await show();
      await user.click(screen.getByRole('button', { name: 'Bene' }));
      await screen.findByText(/Hai ripassato 2 schede/);
      expect(screen.queryByTestId('grade-note')).not.toBeInTheDocument();
    });

    it('says «Fatta per oggi» on the practice pass that takes the card out, promising no interval', async () => {
      const user = userEvent.setup();
      renderSession([card('a'), card('b')]);
      await show();
      await user.click(screen.getByRole('button', { name: /Di nuovo/ }));
      await show();
      await user.click(screen.getByRole('button', { name: /Di nuovo/ }));
      // «a» again, for practice: «Bene» takes it out, and nothing is recorded.
      await screen.findByText('Domanda a?');
      await show();
      await user.click(screen.getByRole('button', { name: 'Bene' }));
      await screen.findByText('Domanda b?');
      expect(screen.getByTestId('grade-note')).toHaveTextContent('Fatta per oggi');
      expect(review).toHaveBeenCalledTimes(2);
    });

    it('keeps the first grade when a second key is pressed while it travels', async () => {
      let finish: (value: Awaited<ReturnType<typeof studiaService.review>>) => void = () => {};
      review.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
      renderSession([card('a'), card('b')]);
      await screen.findByText('Domanda a?');
      fireEvent.keyDown(document.body, { key: ' ' });
      await screen.findByText('Risposta a.');
      fireEvent.keyDown(document.body, { key: '4' });
      fireEvent.keyDown(document.body, { key: '2' });
      finish({ registrata: true, prossimoRipasso: '2026-11-09', scheduledDays: 21 });
      await screen.findByText('Domanda b?');
      expect(review).toHaveBeenCalledTimes(1);
      expect(review).toHaveBeenCalledWith(expect.objectContaining({ rating: 4 }));
      expect(screen.getByTestId('grade-note')).toHaveTextContent('Torna tra 21 giorni');
    });

    it('takes the grade that went through after one that failed', async () => {
      review.mockRejectedValueOnce(new Error('down'));
      const user = userEvent.setup();
      renderSession([card('a'), card('b')]);
      await show();
      await user.click(screen.getByRole('button', { name: /Facile/ }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Non registrato: riprova');
      expect(screen.queryByTestId('grade-note')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /Difficile/ }));
      await screen.findByText('Domanda b?');
      expect(screen.getByTestId('grade-note')).toHaveTextContent('Torna tra 3 giorni');
    });

    it('says nothing for a card that left the review', async () => {
      review.mockRejectedValueOnce(Object.assign(new Error('gone'), { status: 404 }));
      renderSession([card('a'), card('b')]);
      await show();
      await userEvent.setup().click(screen.getByRole('button', { name: /Bene/ }));
      await screen.findByText('Domanda b?');
      expect(screen.queryByTestId('grade-note')).not.toBeInTheDocument();
    });

    it('ignores a key typed into a field', async () => {
      renderSession([card('a'), card('b')]);
      await show();
      const field = document.createElement('input');
      document.body.appendChild(field);
      fireEvent.keyDown(field, { key: '4' });
      field.remove();
      await userEvent.setup().click(screen.getByRole('button', { name: /Difficile/ }));
      await screen.findByText('Domanda b?');
      expect(screen.getByTestId('grade-note')).toHaveTextContent('Torna tra 3 giorni');
    });

    it('never carries the last note of a lesson into the next one', async () => {
      progress.mockResolvedValue({ ...progressAnswer(3, false, 2), oggi: { ...progressAnswer(3, false, 2).oggi, dovute: 4 } });
      const user = userEvent.setup();
      renderSession([card('a')]);
      await show();
      await user.click(screen.getByRole('button', { name: /Bene/ }));
      session.mockResolvedValue({ conteggi: { dovute: 1, nuove: 0 }, cards: [card('e')] });
      await user.click(await screen.findByRole('button', { name: 'Continua' }));
      await screen.findByText('Domanda e?');
      expect(screen.queryByTestId('grade-note')).not.toBeInTheDocument();
    });

    it('frees itself when a key never reaches the session, and the next grade says its own interval', async () => {
      renderSession([card('a'), card('b')]);
      await show();
      // A handler in the page stops the key before the document hears it.
      const stop = (event: KeyboardEvent) => event.stopPropagation();
      document.body.addEventListener('keydown', stop);
      fireEvent.keyDown(document.body, { key: '4' });
      document.body.removeEventListener('keydown', stop);
      expect(review).not.toHaveBeenCalled();
      await userEvent.setup().click(screen.getByRole('button', { name: /Difficile/ }));
      await screen.findByText('Domanda b?');
      expect(screen.getByTestId('grade-note')).toHaveTextContent('Torna tra 3 giorni');
    });
  });

  it('starts each card at the top of a scroll of its own', async () => {
    renderSession([card('a'), card('b')]);
    const before = (await screen.findByRole('heading', { name: 'Domanda a?' })).closest('.overflow-y-auto');
    await show();
    await userEvent.setup().click(screen.getByRole('button', { name: /Bene/ }));
    const after = (await screen.findByRole('heading', { name: 'Domanda b?' })).closest('.overflow-y-auto');
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });

  describe('closing', () => {
    it('names the button «Interrompi» while a card is on screen, and asks', async () => {
      renderSession([card('z'), card('a')]);
      await gradeFirst('a');
      await userEvent.setup().click(screen.getByRole('button', { name: 'Interrompi' }));
      expect(await screen.findByRole('alertdialog', { name: 'Interrompere il ripasso?' })).toBeInTheDocument();
    });

    // Bill's choice (U1c): with no card graded, stopping loses nothing, so nothing is asked.
    it.each(['the button', 'Esc'])('leaves at once by %s while no card is graded yet', async (how) => {
      renderSession([card('a'), card('b')]);
      await show();
      if (how === 'Esc') fireEvent.keyDown(document.body, { key: 'Escape' });
      else await userEvent.setup().click(screen.getByRole('button', { name: 'Interrompi' }));
      expect(await screen.findByText('Landing')).toBeInTheDocument();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(review).not.toHaveBeenCalled();
    });

    it.each(['the button', 'Esc'])('asks by %s from the first card graded on', async (how) => {
      renderSession([card('a'), card('b'), card('c')]);
      await gradeFirst('b');
      if (how === 'Esc') fireEvent.keyDown(document.body, { key: 'Escape' });
      else await userEvent.setup().click(screen.getByRole('button', { name: 'Interrompi' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Interrompere il ripasso?' });
      expect(dialog).toHaveTextContent('Hai ripassato 1 scheda: resta registrata. Le altre ti aspettano in «Oggi».');
      expect(screen.queryByText('Landing')).not.toBeInTheDocument();
    });

    it('goes back to Oggi at once from the end, by the button or Esc: there is nothing to interrupt', async () => {
      renderSession([]);
      await screen.findByText('Nessuna scheda da ripassare per ora.');
      await userEvent.setup().click(screen.getByRole('button', { name: 'Chiudi' }));
      expect(await screen.findByText('Landing')).toBeInTheDocument();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    it('leaves on Esc from the end', async () => {
      renderSession([]);
      await screen.findByText('Nessuna scheda da ripassare per ora.');
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(await screen.findByText('Landing')).toBeInTheDocument();
    });

    it('can be closed while the cards cannot be read', async () => {
      session.mockRejectedValueOnce(new Error('down'));
      render(
        <MemoryRouter initialEntries={['/studia/ripasso/sessione']}>
          <Routes>
            <Route path="/studia/ripasso" element={<p>Landing</p>} />
            <Route path="/studia/ripasso/sessione" element={<ReviewSession />} />
          </Routes>
        </MemoryRouter>,
      );
      await screen.findByRole('alert');
      await userEvent.setup().click(screen.getByRole('button', { name: 'Chiudi' }));
      expect(await screen.findByText('Landing')).toBeInTheDocument();
    });
  });

  describe('the end', () => {
    it('offers «Torna a Oggi» alone, as the primary action, when nothing is left today', async () => {
      renderSession([card('a')]);
      await show();
      await userEvent.setup().click(screen.getByRole('button', { name: /Bene/ }));
      const sentence = await screen.findByText('Hai ripassato 1 scheda, nessuna da rifare. Le prossime: domani.');
      await screen.findByRole('img', { name: /Obiettivo di oggi/ });
      expect(screen.queryByRole('button', { name: 'Continua' })).not.toBeInTheDocument();
      // One card, centred, holds the sentence, the ring, the streak (with its strip of the last seven days, the week: no
      // second row of it) and the one action (G8).
      const end = screen.getByTestId('lesson-end');
      expect(end).toContainElement(sentence);
      expect(end).toContainElement(screen.getByRole('img', { name: /Obiettivo di oggi/ }));
      expect(end).toContainElement(screen.getByRole('group', { name: /^Serie:/ }));
      expect(within(end).getByRole('list', { name: 'Ultimi sette giorni' })).toBeInTheDocument();
      expect(within(end).queryByRole('list', { name: 'Questa settimana' })).toBeNull();
      expect(within(end).getByRole('button', { name: 'Torna a Oggi' })).toHaveClass(...LESSON_PRIMARY.split(' '));
      expect(screen.getAllByRole('button', { name: 'Torna a Oggi' })).toHaveLength(1);
      expect(screen.queryByTestId('lesson-bar')).toBeNull();
      // Focus goes to how it went.
      expect(document.activeElement).toBe(sentence);
    });

    it('offers «Continua» when the day still has cards, and reads the session again', async () => {
      progress.mockResolvedValue({ ...progressAnswer(3, false, 2), oggi: { ...progressAnswer(3, false, 2).oggi, dovute: 4 } });
      renderSession([card('a')]);
      await show();
      await userEvent.setup().click(screen.getByRole('button', { name: /Bene/ }));
      const more = await screen.findByRole('button', { name: 'Continua' });
      // One primary action: «Torna a Oggi» a quiet link under it, not a second button alike (G8).
      expect(more).toHaveClass(...LESSON_PRIMARY.split(' '));
      expect(screen.getByRole('button', { name: 'Torna a Oggi' })).not.toHaveClass(...LESSON_PRIMARY.split(' '));
      session.mockResolvedValue({ conteggi: { dovute: 1, nuove: 0 }, cards: [card('e')] });
      await userEvent.setup().click(more);
      expect(await screen.findByText('Domanda e?')).toBeInTheDocument();
      expect(session).toHaveBeenCalledTimes(2);
      // A new lesson: its bar starts again.
      expect(bar()).toHaveAttribute('aria-valuenow', '0');
      expect(bar()).toHaveAttribute('aria-valuemax', '1');
    });

    it('counts what is left in the institute of a session narrowed to one, not in its whole subject (G5)', async () => {
      const path = `/studia/ripasso/sessione?${new URLSearchParams({ materia: 'DIRITTO_CIVILE', istituto: 'Mora' })}`;
      // The subject still has cards, in another institute; «Mora» has none.
      progress.mockResolvedValue({ ...progressAnswer(3, false, 2), oggi: { ...progressAnswer(3, false, 2).oggi, dovute: 6, nuove: 2 } });
      percorso.mockResolvedValue([
        { materia: 'DIRITTO_CIVILE', istituto: 'Mora', nuove: 0, apprendimento: 1, consolidate: 0, dovute: 0 },
        { materia: 'DIRITTO_CIVILE', istituto: 'Risoluzione per inadempimento', nuove: 2, apprendimento: 6, consolidate: 0, dovute: 6 },
      ]);
      renderSession([card('a')], path);
      await show();
      await userEvent.setup().click(screen.getByRole('button', { name: /Bene/ }));
      await screen.findByRole('img', { name: /Obiettivo di oggi/ });
      await waitFor(() => expect(percorso).toHaveBeenCalled());
      expect(screen.queryByRole('button', { name: 'Continua' })).not.toBeInTheDocument();
    });

    it('offers «Continua» when the institute itself still has cards due, and reads its session again', async () => {
      const path = `/studia/ripasso/sessione?${new URLSearchParams({ materia: 'DIRITTO_CIVILE', istituto: 'Mora' })}`;
      percorso.mockResolvedValue([{ materia: 'DIRITTO_CIVILE', istituto: 'Mora', nuove: 0, apprendimento: 3, consolidate: 0, dovute: 3 }]);
      renderSession([card('a')], path);
      await show();
      await userEvent.setup().click(screen.getByRole('button', { name: /Bene/ }));
      await userEvent.setup().click(await screen.findByRole('button', { name: 'Continua' }));
      await waitFor(() => expect(session).toHaveBeenCalledTimes(2));
      expect(session).toHaveBeenLastCalledWith('DIRITTO_CIVILE', 'Mora');
    });

    it('counts what is left in the subject of a narrowed session', async () => {
      progress.mockImplementation(async (materia) =>
        materia === 'DIRITTO_PENALE' ? progressAnswer(3, false, 2) : { ...progressAnswer(3, false, 2), oggi: { ...progressAnswer(3, false, 2).oggi, nuove: 5 } },
      );
      renderSession([card('a', { materia: 'DIRITTO_PENALE' })], '/studia/ripasso/sessione?materia=DIRITTO_PENALE');
      await show();
      await userEvent.setup().click(screen.getByRole('button', { name: /Bene/ }));
      await screen.findByRole('img', { name: /Obiettivo di oggi/ });
      await waitFor(() => expect(progress).toHaveBeenCalledWith('DIRITTO_PENALE'));
      expect(screen.queryByRole('button', { name: 'Continua' })).not.toBeInTheDocument();
    });
  });
});

// break-ui (the brief of G2): the longest a card can be by the server's schema (`schemas/lingo/card.ts`: question 2,000,
// answer 4,000, explanation 8,000, an address of 500), a long act as the citation, one card, and 200 in a queue.
describe('the lesson under the worst realistic data', () => {
  const LONG_URN = 'urn:nir:stato:decreto.legge:2020-03-17;18~art103';
  const sentence = 'Il termine per la proposizione del ricorso decorre dalla comunicazione del provvedimento impugnato, salvo che la parte provi di non averne avuto conoscenza senza sua colpa; vedi https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2010-07-02;104~art41. ';
  const longText = (limit: number) => sentence.repeat(Math.ceil(limit / sentence.length)).slice(0, limit).trim();
  const worst = card('w', {
    domanda: longText(2_000),
    risposta: longText(4_000),
    spiegazione: longText(8_000),
    ancore: [
      { normaKey: 'decreto_legge', articleId: 'art_103', urn: LONG_URN, isPrimary: true },
      ...Array.from({ length: 9 }, (_, i) => ({ normaKey: 'codice_civile', articleId: `art_${1453 + i}`, urn: `urn:nir:stato:regio.decreto:1942-03-16;262:2~art${1453 + i}`, isPrimary: false })),
    ],
  });

  it('shows every character of the longest card, wraps what cannot break, and keeps every article reachable', async () => {
    renderSession([worst]);
    const question = await screen.findByRole('heading', { name: worst.domanda });
    expect(question).toHaveClass('break-words', 'whitespace-pre-line');
    await show();
    expect(screen.getByRole('group', { name: 'Risposta' })).toHaveTextContent(worst.risposta.replace(/\s+/g, ' '), { normalizeWhitespace: true });
    expect(screen.getByText(worst.spiegazione as string)).toHaveClass('break-words');
    const anchors = within(screen.getByRole('region', { name: 'Articoli' })).getAllByRole('button');
    expect(anchors).toHaveLength(10);
    anchors.forEach((a) => expect(a).toHaveClass('min-h-[44px]', 'max-w-full'));
    // The grades stay in the bar, under the long card, never pushed off it.
    expect(screen.getByTestId('lesson-bar')).toContainElement(screen.getByRole('group', { name: 'Come è andata?' }));
  });

  it('lets an interval wrap inside its button on the narrowest phone', async () => {
    renderSession([card('a', { anteprima: { '1': 1, '2': 300, '3': 548, '4': 3650 } })]);
    await show();
    const buttons = within(screen.getByRole('group', { name: 'Come è andata?' })).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['domaniDi nuovo', '10 mesiDifficile', '1,5 anniBene', '10 anniFacile']);
    buttons.forEach((b) => expect(b).toHaveClass('min-w-0', 'flex-1', 'text-center'));
  });

  it('counts one card in the singular', async () => {
    renderSession([card('a')]);
    await screen.findByText('Domanda a?');
    expect(bar()).toHaveAttribute('aria-valuetext', '0 di 1 scheda');
    expect(screen.getByText('Resta 1')).toBeInTheDocument();
  });

  it('carries 200 cards: the bar moves by one in 200 and says it in words', async () => {
    const cards = Array.from({ length: 200 }, (_, i) => card(`k${i}`));
    renderSession(cards);
    await screen.findByText('Domanda k0?');
    expect(bar()).toHaveAttribute('aria-valuemax', '200');
    expect(screen.getByText('Restano 200')).toBeInTheDocument();
    await show();
    await userEvent.setup().click(screen.getByRole('button', { name: /Bene/ }));
    await screen.findByText('Domanda k1?');
    expect(bar()).toHaveAttribute('aria-valuetext', '1 di 200 schede');
    expect(screen.getByTestId('lesson-progress-fill')).toHaveStyle({ width: '0.5%' });
  });

  function bar() {
    return screen.getByRole('progressbar', { name: 'Avanzamento del ripasso' });
  }
});
