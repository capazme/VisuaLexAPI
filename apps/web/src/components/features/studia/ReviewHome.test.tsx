import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import type { Progressi, TappaIstituto } from '../../../types/studia';

vi.mock('../../../services/studiaService', () => ({
  studiaService: { progress: vi.fn(), percorso: vi.fn(), preferences: vi.fn(), savePreferences: vi.fn() },
}));

import { studiaService } from '../../../services/studiaService';
import { appStore } from '../../../store/useAppStore';
import { ReviewHome } from './ReviewHome';
import { serverMissions, xpFields } from './__fixtures__/xp';

const progress = vi.mocked(studiaService.progress);
const percorso = vi.mocked(studiaService.percorso);
const preferences = vi.mocked(studiaService.preferences);
const savePreferences = vi.mocked(studiaService.savePreferences);

const STORAGE_KEY = 'visualex.studia.ripasso.materia';

/** A 2D context that draws nothing, so a burst runs its course in jsdom. */
function fakeContext(): CanvasRenderingContext2D {
  const noop = () => {};
  return { scale: noop, clearRect: noop, save: noop, restore: noop, translate: noop, rotate: noop, fillText: noop, globalAlpha: 1, fillStyle: '', font: '' } as unknown as CanvasRenderingContext2D;
}

/** A dashboard answer: `dovute` and `nuove` today, the goal's state, a little history. */
function answer(dovute: number, nuove: number, over: Partial<Progressi['oggi']> = {}, serie = 4): Progressi {
  return {
    oggi: { giorno: '2026-10-19', ripassi: 6, obiettivo: 10, raggiunto: false, dovute, nuove, ...over },
    serie: {
      attuale: serie,
      record: 9,
      ultimiGiorni: ['13', '14', '15', '16', '17', '18', '19'].map((d, i) => ({ giorno: `2026-10-${d}`, stato: i === 6 ? 'oggi' : 'fatto' })),
    },
    stati: { nuove: 3, apprendimento: 5, consolidate: 2 },
    materie: (['DIRITTO_CIVILE', 'DIRITTO_PENALE', 'DIRITTO_AMMINISTRATIVO', 'DIRITTO_PROCESSUALE_CIVILE', 'DIRITTO_PROCESSUALE_PENALE'] as const).map((materia) => ({
      materia, nuove: 0, apprendimento: 1, consolidate: 1, ripassi30: 2,
    })),
    calendario: [{ giorno: '2026-10-18', ripassi: 12, nuove: 2, sbagliate: 1, valido: true, riposo: false }],
    prossimi: Array.from({ length: 14 }, (_, i) => ({ giorno: `2026-10-${19 + i}`, schede: i === 0 ? dovute : 2 })),
    ...xpFields(),
  };
}

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/studia/ripasso']}>
      <Routes>
        <Route path="/studia/ripasso" element={<ReviewHome />} />
        <Route path="/studia/ripasso/sessione" element={<Where />} />
        <Route path="/studia/progressi" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  progress.mockReset();
  percorso.mockReset();
  // The road's read by institute (G5) answers on its own: nothing by default.
  percorso.mockResolvedValue([]);
  preferences.mockReset();
  savePreferences.mockReset();
  preferences.mockResolvedValue({ nuoveAlGiorno: 20, ripassiAlGiorno: 10, materieComunita: [] });
  localStorage.removeItem(STORAGE_KEY);
  // jsdom draws nothing: a celebration's burst ends at once, as it does without a canvas.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  // Framer Motion restores the scroll after measuring the settings panel's `height: auto`; jsdom has no `scrollTo`.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  localStorage.removeItem(STORAGE_KEY);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The subject filter of «Le tue materie» (G8), which took the chips' place. */
const subjects = () => screen.getByRole('group', { name: 'Materia' });
/** A subject's choice in it: its name first, then what it holds. */
const subjectChoice = (label: string) => within(subjects()).getByRole('button', { name: new RegExp(`^${label}\\b(?! processuale)`) });
/** A subject's row in «Le tue materie», by its name. */
const subjectRow = async (label: string) => {
  const group = await screen.findByRole('group', { name: 'Materia' });
  return within(group).getAllByRole('listitem').find((li) => li.querySelector('[data-subject-name]')?.textContent === label)!;
};
const START = /^(Inizia|Continua) il ripasso$/;
const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

/** A window `width` px wide, for `min-width` queries (jsdom matches none). */
function windowOf(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity);
    return { matches: width >= min, media: query, addEventListener: () => {}, removeEventListener: () => {} };
  });
}

describe('ReviewHome', () => {
  it('says what is on today, how far the goal is, and offers to start', async () => {
    progress.mockResolvedValue(answer(18, 20));
    renderHome();
    expect(await screen.findByText('18 da ripassare, 20 nuove')).toBeInTheDocument();
    expect(screen.getByText('lunedì 19 ottobre')).toBeInTheDocument();
    expect(progress).toHaveBeenCalledWith(undefined);
    expect(screen.getByRole('img', { name: 'Serie: 4 giorni di fila, record 9' })).toBeInTheDocument();
    // The goal is the mission's to say (G8): no ring of it on «Oggi».
    expect(screen.queryByRole('img', { name: /^Obiettivo di oggi/ })).toBeNull();
    expect(screen.getByText('Ancora 4 ripassi per tenere viva la serie.')).toBeInTheDocument();
    const start = screen.getByRole('button', { name: 'Inizia il ripasso' });
    expect(start).toBeEnabled();
    await userEvent.setup().click(start);
    expect(screen.getByTestId('where')).toHaveTextContent('/studia/ripasso/sessione');
    expect(screen.getByTestId('where').textContent).not.toContain('materia');
  });

  it('draws the page without the level and the missions a server without the points (#253) does not send', async () => {
    const bare: Progressi = { ...answer(18, 20) };
    delete bare.livello;
    delete bare.missioni;
    delete bare.crediti;
    progress.mockResolvedValue(bare);
    renderHome();
    expect(await screen.findByText('18 da ripassare, 20 nuove')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inizia il ripasso' })).toBeEnabled();
    // With no mission to say it, the goal's ring is the band's again.
    expect(within(screen.getByRole('region', { name: 'I tuoi progressi' })).getByRole('img', { name: 'Obiettivo di oggi: 6 di 10 ripassi' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tutti i progressi' })).toBeInTheDocument();
    expect(screen.queryByTestId('level-bar')).toBeNull();
    // No «0 di 0» over missions that did not come, and no list of them.
    expect(screen.queryByText(/^0 di 0/)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Le missioni di oggi' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Tutte le missioni' })).toBeNull();
  });

  it('draws the statistics: the cards by state in one line, and «Tutti i progressi» leads to the page of the data', async () => {
    progress.mockResolvedValue(answer(3, 0));
    renderHome();
    const band = await screen.findByRole('region', { name: 'I tuoi progressi' });
    const states = within(band).getByRole('list', { name: 'Le schede per stato' });
    expect(within(states).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['3 nuove', '5 in apprendimento', '2 consolidate']);
    // The long calendar and the coming days live on /studia/progressi (G3): no sheet repeats them here.
    expect(screen.queryByRole('heading', { name: 'Il tuo andamento' })).toBeNull();
    expect(within(band).queryByRole('button', { name: 'Il tuo mese' })).toBeNull();
    // A text link, not a button across the column (G8).
    const all = within(band).getByRole('link', { name: 'Tutti i progressi' });
    expect(all.className).not.toMatch(/\bw-full\b|xl:w-full/);
    await userEvent.setup().click(all);
    expect(screen.getByTestId('where')).toHaveTextContent('/studia/progressi');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says the goal is reached, with the streak', async () => {
    progress.mockResolvedValue(answer(2, 0, { ripassi: 11, raggiunto: true }, 5));
    renderHome();
    expect(await screen.findByText('Obiettivo raggiunto. Serie: 5 giorni.')).toBeInTheDocument();
  });

  it('asks to finish the day when fewer cards are left than the goal wants', async () => {
    progress.mockResolvedValue(answer(1, 1, { ripassi: 2 }));
    renderHome();
    expect(await screen.findByText('Finisci le schede di oggi per tenere viva la serie.')).toBeInTheDocument();
  });

  it('narrows the dashboard to the subject chosen, starts the session on it, and remembers it', async () => {
    progress.mockResolvedValue(answer(18, 20));
    const { unmount } = renderHome();
    await screen.findByText('18 da ripassare, 20 nuove');
    expect(within(subjects()).getByRole('button', { name: 'Tutte le materie' })).toHaveAttribute('aria-pressed', 'true');

    progress.mockResolvedValue(answer(2, 5));
    await userEvent.setup().click(subjectChoice('Diritto penale'));
    expect(await screen.findByText('2 da ripassare, 5 nuove')).toBeInTheDocument();
    expect(screen.getByText('lunedì 19 ottobre · Diritto penale')).toBeInTheDocument();
    expect(subjectChoice('Diritto penale')).toHaveAttribute('aria-pressed', 'true');
    expect(progress).toHaveBeenLastCalledWith('DIRITTO_PENALE');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('DIRITTO_PENALE');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Inizia il ripasso' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/studia/ripasso/sessione?materia=DIRITTO_PENALE');
    unmount();

    renderHome();
    await screen.findByText('lunedì 19 ottobre · Diritto penale');
    expect(await screen.findByText('2 da ripassare, 5 nuove')).toBeInTheDocument();
    expect(progress).toHaveBeenLastCalledWith('DIRITTO_PENALE');
  });

  it('ignores a remembered value that is not a subject', async () => {
    localStorage.setItem(STORAGE_KEY, 'DIRITTO_ALIENO');
    progress.mockResolvedValue(answer(1, 1));
    renderHome();
    await screen.findByText('1 da ripassare, 1 nuova');
    expect(progress).toHaveBeenCalledWith(undefined);
  });

  it('says the day is done, with tomorrow\'s cards, and offers no start when nothing is due and nothing is new', async () => {
    progress.mockResolvedValue(answer(0, 0, { raggiunto: true }));
    renderHome();
    expect(await screen.findByText('Hai finito per oggi.')).toBeInTheDocument();
    // `prossimi` has 2 cards each day after today.
    expect(screen.getByText('Domani: 2 da ripassare.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: START })).toBeNull();
    // New cards wait (3), today's quota used: more of them is a setting.
    const more = screen.getByRole('button', { name: 'Impara altre schede nuove' });
    expect(more).toHaveAttribute('aria-controls', 'studia-impostazioni');
    await userEvent.setup().click(more);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Impostazioni dello studio' })).toHaveFocus());
  });

  it('starts with new cards alone', async () => {
    progress.mockResolvedValue(answer(0, 7));
    renderHome();
    await screen.findByText('7 nuove');
    expect(screen.getByRole('button', { name: 'Inizia il ripasso' })).toBeEnabled();
  });

  it('speaks of the first day of the streak to someone who has none yet', async () => {
    const first = answer(18, 20, { ripassi: 0 }, 0);
    first.serie.record = 0;
    progress.mockResolvedValue(first);
    renderHome();
    expect(await screen.findByText('Il primo giorno comincia oggi')).toBeInTheDocument();
    expect(screen.getByText('Ancora 10 ripassi per il primo giorno della serie.')).toBeInTheDocument();
  });

  it('says a subject has nothing left, and never asks to finish the day from one subject’s counts', async () => {
    progress.mockResolvedValue(answer(5, 5));
    renderHome();
    await screen.findByText('5 da ripassare, 5 nuove');
    progress.mockResolvedValue(answer(0, 0, { ripassi: 2 }));
    await userEvent.setup().click(subjectChoice('Diritto penale'));
    expect(await screen.findByText('Niente da ripassare in questa materia, per oggi.')).toBeInTheDocument();
    // The goal is the whole day's, from the day's read (6 of 10), whatever the subject's counts say.
    expect(screen.getByText('Ancora 4 ripassi per tenere viva la serie.')).toBeInTheDocument();
    expect(screen.queryByText(/^Finisci le schede di oggi/)).toBeNull();
    // The way on: back to every subject.
    progress.mockResolvedValue(answer(5, 5));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ripassa tutte le materie' }));
    expect(await screen.findByText('5 da ripassare, 5 nuove')).toBeInTheDocument();
    expect(within(subjects()).getByRole('button', { name: 'Tutte le materie' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('holds the panels’ places while the first read travels, and stops pulsing when it fails', async () => {
    let fail: (reason: unknown) => void = () => {};
    progress.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    const { container } = renderHome();
    expect(screen.getAllByText('Carico i tuoi progressi…').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.motion-safe\\:animate-pulse').length).toBeGreaterThan(2);
    fail(new Error('down'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Non riesco a leggere i tuoi progressi.');
    expect(container.querySelectorAll('.motion-safe\\:animate-pulse')).toHaveLength(0);
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('says what the subjects are missing when the progress cannot be read, and draws them once read again', async () => {
    progress.mockRejectedValueOnce(new Error('down'));
    renderHome();
    const alert = await screen.findByRole('alert');
    const list = screen.getByRole('region', { name: 'Le tue materie' });
    expect(list).toHaveTextContent('Non riesco a leggere le tue materie: tornano appena riesco a leggerle.');
    expect(within(list).queryByRole('list')).toBeNull();
    // Said once, by the day block: the subjects' line is no second alert.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    progress.mockResolvedValue(answer(1, 0));
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByRole('group', { name: 'Materia' })).toBeInTheDocument();
    expect(screen.queryByText(/Non riesco a leggere le tue materie/)).toBeNull();
  });

  it('tells someone with no card yet where to begin, the community\'s cards as the block\'s button', async () => {
    const empty = answer(0, 0, { ripassi: 0 }, 0);
    empty.stati = { nuove: 0, apprendimento: 0, consolidate: 0 };
    progress.mockResolvedValue(empty);
    renderHome();
    expect(await screen.findByText('Non hai ancora schede da ripassare.')).toBeInTheDocument();
    expect(screen.getByText(/apri un articolo dalla/)).toHaveTextContent('«+ Nuova scheda» sotto il testo');
    expect(screen.getByRole('link', { name: 'Ricerca' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('button', { name: START })).toBeNull();
    // Said once, in the day block: no missions card under it, and so nothing «qui sopra» for the full list to point to.
    expect(screen.queryByRole('region', { name: 'Le missioni di oggi' })).toBeNull();
    expect(await screen.findByRole('region', { name: 'Tutte le missioni' })).toBeInTheDocument();
    expect(screen.queryByText('Le tre di oggi sono qui sopra.')).toBeNull();
    // A button, not a link (G8): it opens the settings at the community's subjects.
    const day = screen.getByRole('region', { name: 'Il ripasso di oggi' });
    await userEvent.setup().click(within(day).getByRole('button', { name: 'Accendi le schede della comunità' }));
    const panel = screen.getByRole('region', { name: 'Impostazioni dello studio' });
    expect(await within(panel).findByRole('button', { name: 'Schede della comunità · 0 di 5' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('says so, keeps the start usable, and reads again on request, when the progress cannot be read', async () => {
    progress.mockRejectedValueOnce(new Error('down'));
    renderHome();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Non riesco a leggere i tuoi progressi.');
    expect(screen.getByRole('button', { name: 'Inizia il ripasso' })).toBeEnabled();
    progress.mockResolvedValue(answer(1, 0));
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText('1 da ripassare')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('reads again after a setting changed', async () => {
    progress.mockResolvedValue(answer(3, 0));
    renderHome();
    await screen.findByText('3 da ripassare');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Impostazioni dello studio' }));
    progress.mockResolvedValue(answer(3, 12));
    savePreferences.mockResolvedValue({ nuoveAlGiorno: 20, ripassiAlGiorno: 10, materieComunita: ['DIRITTO_CIVILE'] });
    await user.click(await screen.findByRole('button', { name: /^Schede della comunità · / }));
    await user.click(screen.getByRole('switch', { name: 'Diritto civile' }));
    expect(savePreferences).toHaveBeenCalledWith({ materieComunita: ['DIRITTO_CIVILE'] });
    expect(await screen.findByText('3 da ripassare, 12 nuove')).toBeInTheDocument();
    expect(progress).toHaveBeenCalledTimes(2);
  });

  it('never lets a slow answer for a subject chosen before overwrite the one that came after', async () => {
    const pending: Array<(value: Progressi) => void> = [];
    progress.mockResolvedValueOnce(answer(1, 1));
    renderHome();
    await screen.findByText('1 da ripassare, 1 nuova');
    progress.mockImplementation(() => new Promise((resolve) => { pending.push(resolve); }));
    const user = userEvent.setup();
    await user.click(subjectChoice('Diritto penale'));
    await user.click(subjectChoice('Diritto civile'));
    expect(pending).toHaveLength(2);
    // The newer request answers first, the older one after.
    pending[1](answer(7, 7));
    expect(await screen.findByText('7 da ripassare, 7 nuove')).toBeInTheDocument();
    expect(screen.getByText('lunedì 19 ottobre · Diritto civile')).toBeInTheDocument();
    pending[0](answer(9, 9));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText('7 da ripassare, 7 nuove')).toBeInTheDocument();
    expect(screen.queryByText('9 da ripassare, 9 nuove')).not.toBeInTheDocument();
  });

  describe('the celebration (Studia progress spec §6.4)', () => {
    const CELEBRATED_KEY = 'visualex.studia.festeggiato';
    beforeEach(() => {
      localStorage.removeItem(CELEBRATED_KEY);
    });
    afterEach(() => {
      localStorage.removeItem(CELEBRATED_KEY);
    });
    /** The goal met today and its mission done, as the server says it (G9: the mark follows the mission). */
    const met = (over: Partial<Progressi['oggi']> = { ripassi: 12, raggiunto: true }, serie = 5): Progressi => ({
      ...answer(0, 0, over, serie),
      missioni: serverMissions({ obiettivo: { stato: 'fatta', progresso: { fatte: 10, di: 10 } } }),
    });
    const dayBlock = () => screen.getByRole('region', { name: 'Il ripasso di oggi' });

    it('plays once when the goal was met today, writes the goal\'s mark in the day block, and remembers the day', async () => {
      progress.mockResolvedValue(met());
      renderHome();
      const mark = await screen.findByTestId('goal-mark');
      // In the day block (G9), never in the missions' rows; its date and day as words beside it.
      expect(dayBlock()).toContainElement(mark);
      expect(mark.closest('li')).toBeNull();
      expect(within(dayBlock()).getByRole('img', { name: 'Obiettivo raggiunto' })).toBe(mark);
      expect(mark.nextElementSibling).toHaveTextContent('19 ottobre 2026 · giorno 5');
      // Written now, once.
      expect(mark).toHaveClass('vlx-goal-mark-draw');
      expect(screen.queryByTestId('goal-stamp')).toBeNull();
      await waitFor(() => expect(localStorage.getItem(CELEBRATED_KEY)).toBe('2026-10-19'));
    });

    it('draws the mark whole, without writing it again or a new burst, once the day was celebrated', async () => {
      localStorage.setItem(CELEBRATED_KEY, '2026-10-19');
      progress.mockResolvedValue(met());
      const { container } = renderHome();
      expect(await screen.findByTestId('goal-mark')).not.toHaveClass('vlx-goal-mark-draw');
      expect(container.querySelector('canvas')).toBeNull();
    });

    // As the server sends it: the queue finished with no review counts the day, and leaves the goal's mission empty.
    it('does not celebrate a day that counted with nothing reviewed', async () => {
      progress.mockResolvedValue({
        ...answer(0, 0, { ripassi: 0, raggiunto: true }, 5),
        missioni: serverMissions({ obiettivo: { stato: 'vuota', progresso: undefined } }),
      });
      const { container } = renderHome();
      await screen.findByRole('region', { name: 'Le missioni di oggi' });
      expect(screen.queryByTestId('goal-mark')).toBeNull();
      expect(container.querySelector('canvas')).toBeNull();
      expect(localStorage.getItem(CELEBRATED_KEY)).toBeNull();
    });

    // The credit stays the whole day: 10 reviews of a goal of 10, the mission done, the goal then raised to 15.
    it('draws no mark and celebrates nothing when the goal was raised past a mission already done', async () => {
      progress.mockResolvedValue({
        ...answer(8, 0, { ripassi: 10, obiettivo: 15, raggiunto: false }, 5),
        missioni: serverMissions({ obiettivo: { stato: 'fatta', progresso: { fatte: 10, di: 10 } } }),
      });
      const { container } = renderHome();
      await screen.findByRole('region', { name: 'Le missioni di oggi' });
      expect(screen.queryByTestId('goal-mark')).toBeNull();
      expect(screen.queryByText(/Obiettivo raggiunto/)).toBeNull();
      expect(screen.getByText('Ancora 5 ripassi per tenere viva la serie.')).toBeInTheDocument();
      expect(container.querySelector('canvas')).toBeNull();
      expect(localStorage.getItem(CELEBRATED_KEY)).toBeNull();
    });

    it('writes the mark once: when the burst is over the writing goes, and a new read does not bring it back', async () => {
      vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(fakeContext());
      progress.mockResolvedValue(met());
      const { container } = renderHome();
      expect(await screen.findByTestId('goal-mark')).toHaveClass('vlx-goal-mark-draw');
      await waitFor(() => expect(container.querySelector('canvas')).toBeNull(), { timeout: 3000 });
      expect(screen.getByTestId('goal-mark')).not.toHaveClass('vlx-goal-mark-draw');
      // A new read (a subject chosen): the mark stays whole.
      await userEvent.setup().click(subjectChoice('Diritto penale'));
      await waitFor(() => expect(progress).toHaveBeenCalledWith('DIRITTO_PENALE'));
      expect(screen.getByTestId('goal-mark')).not.toHaveClass('vlx-goal-mark-draw');
    });

    it('marks the day as the burst begins, so leaving halfway does not replay it', async () => {
      vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(fakeContext());
      progress.mockResolvedValue(met());
      const { container, unmount } = renderHome();
      await screen.findByTestId('goal-mark');
      expect(container.querySelector('canvas')).not.toBeNull();
      // The day is written by the burst's mount effect, which React runs just after the canvas is in the page:
      // waited for, not read at once (a loaded machine reads between the two). The burst is still on (1.5 s).
      await waitFor(() => expect(localStorage.getItem(CELEBRATED_KEY)).toBe('2026-10-19'));
      expect(container.querySelector('canvas')).not.toBeNull();
      unmount();

      const again = renderHome();
      expect(await screen.findByTestId('goal-mark')).toBeInTheDocument();
      expect(again.container.querySelector('canvas')).toBeNull();
    });

    it('keeps the burst through a new read (a subject chosen halfway), and takes the canvas away after 1.5 s', async () => {
      vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(fakeContext());
      progress.mockResolvedValue(met());
      const { container } = renderHome();
      await screen.findByTestId('goal-mark');
      const canvas = container.querySelector('canvas');
      expect(canvas).not.toBeNull();
      await userEvent.setup().click(subjectChoice('Diritto penale'));
      expect(container.querySelector('canvas')).toBe(canvas);
      await waitFor(() => expect(container.querySelector('canvas')).toBeNull(), { timeout: 3000 });
    });

    it('moves nothing under reduced motion: no canvas, the mark whole, the day still marked', async () => {
      const original = window.matchMedia;
      window.matchMedia = ((query: string) => ({
        matches: query.includes('reduce'), media: query, onchange: null, addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
      try {
        progress.mockResolvedValue(met());
        const { container } = renderHome();
        await screen.findByTestId('goal-mark');
        await waitFor(() => expect(container.querySelector('canvas')).toBeNull());
        expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
        expect(localStorage.getItem(CELEBRATED_KEY)).toBe('2026-10-19');
      } finally {
        window.matchMedia = original;
      }
    });

    it('shows no mark before the goal', async () => {
      progress.mockResolvedValue(answer(3, 0));
      renderHome();
      await screen.findByText('3 da ripassare');
      expect(screen.queryByTestId('goal-mark')).not.toBeInTheDocument();
    });

    // G9, the case on Luca's screen: day 3 of the streak, nothing due, nothing new. The server counts the day with the
    // queue finished (`raggiunto`, 0 reviews) and leaves the goal's mission empty: the page never says «Obiettivo
    // raggiunto» for it.
    it('says the day counts, with no mark, no burst and no «0 di 0», when the goal\'s mission is empty', async () => {
      progress.mockResolvedValue({
        ...answer(0, 0, { ripassi: 0, raggiunto: true }, 3),
        missioni: serverMissions({ dovute: { stato: 'vuota' }, nuove: { stato: 'vuota' }, obiettivo: { stato: 'vuota', progresso: undefined } }),
      });
      const { container } = renderHome();
      const missions = await screen.findByRole('region', { name: 'Le missioni di oggi' });
      // Read and seen: the stamp no longer covers it, nor hides it from the eye.
      expect(within(missions).getByText('Hai finito le schede del giorno: il giorno conta. Serie: 3 giorni.')).not.toHaveClass('sr-only');
      expect(within(missions).getByText('Oggi non c\'è nulla da ripassare')).toBeInTheDocument();
      expect(within(missions).queryByText(/0 di 0/)).toBeNull();
      expect(screen.queryByTestId('goal-mark')).toBeNull();
      expect(screen.queryByText(/Obiettivo raggiunto/)).toBeNull();
      expect(container.querySelector('canvas')).toBeNull();
      expect(localStorage.getItem(CELEBRATED_KEY)).toBeNull();
    });

    it('draws no mark for a goal of the user\'s own met under the mission\'s 10 reviews, and says what the points want', async () => {
      progress.mockResolvedValue({
        ...answer(2, 0, { ripassi: 6, obiettivo: 5, raggiunto: true }, 3),
        missioni: serverMissions({ obiettivo: { stato: 'aperta', progresso: { fatte: 6, di: 10 } } }),
      });
      const { container } = renderHome();
      const missions = await screen.findByRole('region', { name: 'Le missioni di oggi' });
      expect(within(missions).getByText('Il giorno conta per la serie; per i punti della missione servono 10 ripassi.')).not.toHaveClass('sr-only');
      // No mark, no burst, nothing celebrated: the goal's mission is still open.
      expect(screen.queryByTestId('goal-mark')).toBeNull();
      expect(screen.queryByText(/Obiettivo raggiunto/)).toBeNull();
      expect(container.querySelector('canvas')).toBeNull();
      expect(localStorage.getItem(CELEBRATED_KEY)).toBeNull();
    });

    it('keeps the mark while a subject\'s read travels, the day\'s goal being the whole day\'s', async () => {
      localStorage.setItem(CELEBRATED_KEY, '2026-10-19');
      localStorage.setItem(STORAGE_KEY, 'DIRITTO_PENALE');
      progress.mockImplementation((materia?: string) => (materia ? new Promise(() => {}) : Promise.resolve(met())));
      renderHome();
      expect(await screen.findByTestId('goal-mark')).toBeInTheDocument();
      expect(dayBlock()).toContainElement(screen.getByTestId('goal-mark'));
    });
  });

  it('holds the study settings, closed, behind the gear of the strip', async () => {
    progress.mockResolvedValue(answer(1, 1));
    renderHome();
    expect(await screen.findByRole('button', { name: 'Impostazioni dello studio' })).toHaveAttribute('aria-expanded', 'false');
  });

  describe('«Oggi» (Gymnasium spec §5.1)', () => {
    it('puts the day first, keeps the reading order — missions, statistics, subjects, list — and from `xl` sets the statistics and the subjects in a sticky column (G6, G8)', async () => {
      progress.mockResolvedValue(answer(18, 8));
      renderHome();
      const day = await screen.findByRole('region', { name: 'Il ripasso di oggi' });
      const missions = await screen.findByRole('region', { name: 'Le missioni di oggi' });
      const stats = screen.getByRole('region', { name: 'I tuoi progressi' });
      const list = screen.getByRole('region', { name: 'Tutte le missioni' });
      const mine = screen.getByRole('region', { name: 'Le tue materie' });
      expect(follows(day, missions) && follows(missions, stats) && follows(stats, mine) && follows(mine, list)).toBe(true);
      // The grid places them; the document keeps the order on every width.
      expect(stats.parentElement).toHaveClass('xl:col-start-2', 'xl:row-span-full', 'xl:sticky', 'xl:self-start');
      expect(stats.parentElement).toContainElement(mine);
      for (const left of [day.parentElement!, missions.parentElement!, list.parentElement!]) expect(left).toHaveClass('xl:col-start-1');
      expect(stats.parentElement?.parentElement?.className).toMatch(/xl:grid-cols-\[minmax\(0,7fr\)_minmax\(0,5fr\)\]/);
    });

    it('sets «Le tue materie» under the day block from `xl` when there is no mission, first for the keyboard too, the statistics alone on the right (G8c)', async () => {
      windowOf(1366);
      const bare: Progressi = { ...answer(18, 8) };
      delete bare.missioni;
      progress.mockResolvedValue(bare);
      const { container } = renderHome();
      const day = await screen.findByRole('region', { name: 'Il ripasso di oggi' });
      const stats = screen.getByRole('region', { name: 'I tuoi progressi' });
      const mine = screen.getByRole('region', { name: 'Le tue materie' });
      expect(stats.parentElement).not.toContainElement(mine);
      expect(mine.parentElement).toHaveClass('xl:col-start-1');
      expect(stats.parentElement).toHaveClass('xl:col-start-2', 'xl:row-span-full');
      expect(follows(day, mine) && follows(mine, stats)).toBe(true);
      // Two rows on the left: no empty third leaving its gaps under the subjects.
      expect(container.querySelector('section')).toHaveClass('xl:grid-rows-[auto_auto_1fr]');
    });

    it('moves nothing below `xl`: one column, the day, the statistics, the subjects (G8c)', async () => {
      windowOf(1024);
      const bare: Progressi = { ...answer(18, 8) };
      delete bare.missioni;
      progress.mockResolvedValue(bare);
      renderHome();
      const stats = await screen.findByRole('region', { name: 'I tuoi progressi' });
      expect(stats.parentElement).toContainElement(screen.getByRole('region', { name: 'Le tue materie' }));
    });

    it('keeps «Le tue materie» in the right column while the first read travels, as the list of missions is still to come (G8c)', async () => {
      windowOf(1366);
      progress.mockReturnValue(new Promise(() => {}));
      renderHome();
      const stats = await screen.findByRole('region', { name: 'I tuoi progressi' });
      expect(stats.parentElement).toContainElement(screen.getByRole('region', { name: 'Le tue materie' }));
    });

    it('keeps «Le tue materie» on the left after a failed read while «Riprova» reads again (G8c)', async () => {
      windowOf(1366);
      progress.mockRejectedValueOnce(new Error('down'));
      renderHome();
      const alert = await screen.findByRole('alert');
      const stats = screen.getByRole('region', { name: 'I tuoi progressi' });
      await waitFor(() => expect(stats.parentElement).not.toContainElement(screen.getByRole('region', { name: 'Le tue materie' })));
      progress.mockReturnValue(new Promise(() => {}));
      await userEvent.setup().click(within(alert).getByRole('button', { name: 'Riprova' }));
      expect(progress).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('region', { name: 'I tuoi progressi' }).parentElement).not.toContainElement(screen.getByRole('region', { name: 'Le tue materie' }));
    });

    it('says the subjects once, in one list: no chips and no road beside them (G8)', async () => {
      progress.mockResolvedValue(answer(18, 8));
      renderHome();
      expect(await screen.findAllByRole('region', { name: 'Le tue materie' })).toHaveLength(1);
      expect(screen.queryByRole('region', { name: 'Cosa ripassi' })).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Il percorso' })).toBeNull();
      expect(screen.getAllByRole('group', { name: 'Materia' })).toHaveLength(1);
    });

    it('stays one column in Focus mode, whose narrower frame would squeeze the band (G6)', async () => {
      const before = appStore.getState().settings;
      appStore.setState({ settings: { ...before, focusMode: true } });
      try {
        progress.mockResolvedValue(answer(18, 8));
        renderHome();
        const stats = await screen.findByRole('region', { name: 'I tuoi progressi' });
        expect(stats.parentElement?.className).not.toMatch(/xl:/);
        expect(stats.parentElement?.parentElement?.className).not.toMatch(/xl:grid-cols/);
      } finally {
        appStore.setState({ settings: before });
      }
    });

    it('says what today costs, «circa N minuti», from the cards due and new', async () => {
      progress.mockResolvedValue(answer(18, 8));
      renderHome();
      expect(await screen.findByText('18 da ripassare, 8 nuove')).toBeInTheDocument();
      // ceil(26 × 20 / 60) = 9.
      expect(screen.getByText('circa 9 minuti')).toBeInTheDocument();
      // The one primary button of the page.
      expect(screen.getAllByRole('button', { name: START })).toHaveLength(1);
    });

    it('names the subjects today\'s cards come from, beside the cost (G8)', async () => {
      const data = answer(9, 2);
      data.materie[1] = { materia: 'DIRITTO_PENALE', nuove: 4, apprendimento: 0, consolidate: 0, ripassi30: 0 };
      progress.mockResolvedValue(data);
      percorso.mockResolvedValue([
        { materia: 'DIRITTO_CIVILE', istituto: 'Mora', nuove: 0, apprendimento: 5, consolidate: 0, dovute: 5 },
        { materia: 'DIRITTO_AMMINISTRATIVO', istituto: 'Silenzio', nuove: 0, apprendimento: 3, consolidate: 0, dovute: 3 },
        { materia: 'DIRITTO_PROCESSUALE_CIVILE', istituto: 'Notifica', nuove: 0, apprendimento: 1, consolidate: 0, dovute: 1 },
      ]);
      renderHome();
      expect(await screen.findByText('circa 4 minuti · Diritto civile, Diritto amministrativo e altre 2')).toBeInTheDocument();
    });

    it('marks the day and offers «Continua il ripasso» once the goal is met with cards left', async () => {
      localStorage.setItem('visualex.studia.festeggiato', '2026-10-19');
      progress.mockResolvedValue({ ...answer(4, 2, { ripassi: 12, raggiunto: true }, 5), missioni: serverMissions({ obiettivo: { stato: 'fatta', progresso: { fatte: 10, di: 10 } } }) });
      renderHome();
      expect(await screen.findByRole('button', { name: 'Continua il ripasso' })).toBeEnabled();
      expect(within(screen.getByRole('region', { name: 'Il ripasso di oggi' })).getByTestId('goal-mark')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Inizia il ripasso' })).toBeNull();
      expect(screen.getByText('circa 2 minuti')).toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole('button', { name: 'Continua il ripasso' }));
      expect(screen.getByTestId('where')).toHaveTextContent('/studia/ripasso/sessione');
      localStorage.removeItem('visualex.studia.festeggiato');
    });

    it('says the day is done with the next day by name, or that none is coming', async () => {
      const later = answer(0, 0, { raggiunto: true });
      // No new card waiting: the next day is the first of `prossimi` with cards.
      later.stati = { nuove: 0, apprendimento: 4, consolidate: 2 };
      later.prossimi = later.prossimi.map((day, i) => ({ ...day, schede: i === 3 ? 6 : 0 }));
      progress.mockResolvedValue(later);
      const { unmount } = renderHome();
      expect(await screen.findByText('Le prossime: giovedì 22 ottobre, 6 da ripassare.')).toBeInTheDocument();
      // Nothing waits: no second action.
      expect(screen.queryByRole('button', { name: 'Impara altre schede nuove' })).toBeNull();
      unmount();
      const none = answer(0, 0, { raggiunto: true });
      none.stati = { nuove: 0, apprendimento: 0, consolidate: 6 };
      none.prossimi = none.prossimi.map((day) => ({ ...day, schede: 0 }));
      progress.mockResolvedValue(none);
      renderHome();
      expect(await screen.findByText('Nessuna scheda in programma nei prossimi 14 giorni.')).toBeInTheDocument();
    });

    it('starts the session from «Inizia il ripasso» when the progress cannot be read', async () => {
      progress.mockRejectedValue(new Error('down'));
      renderHome();
      expect(await screen.findByRole('alert')).toHaveTextContent('Non riesco a leggere i tuoi progressi.');
      expect(screen.getByText('Puoi ripassare lo stesso: il ripasso legge le sue schede.')).toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole('button', { name: 'Inizia il ripasso' }));
      expect(screen.getByTestId('where')).toHaveTextContent('/studia/ripasso/sessione');
    });

    it('opens the study settings inside «I tuoi progressi», with no window, and closes them from the gear or with Esc (G6)', async () => {
      progress.mockResolvedValue(answer(1, 1));
      renderHome();
      const user = userEvent.setup();
      const gear = await screen.findByRole('button', { name: 'Impostazioni dello studio' });
      expect(gear).not.toHaveAttribute('aria-haspopup');
      expect(gear).toHaveAttribute('aria-controls', 'studia-impostazioni');
      await user.click(gear);
      expect(gear).toHaveAttribute('aria-expanded', 'true');
      expect(screen.queryByRole('dialog')).toBeNull();
      const panel = screen.getByRole('region', { name: 'Impostazioni dello studio' });
      expect(panel).toHaveAttribute('id', 'studia-impostazioni');
      expect(screen.getByRole('region', { name: 'I tuoi progressi' })).toContainElement(panel);
      // The content of the settings, open, with no disclosure of its own; the community one level down, closed.
      expect(await within(panel).findByLabelText('Ripassi al giorno')).toBeInTheDocument();
      expect(within(panel).getByRole('button', { name: 'Schede della comunità · 0 di 5' })).toHaveAttribute('aria-expanded', 'false');
      // The gear again closes them.
      await user.click(gear);
      await waitFor(() => expect(screen.queryByRole('region', { name: 'Impostazioni dello studio' })).toBeNull());
      expect(gear).toHaveAttribute('aria-expanded', 'false');
      // Esc inside closes them and gives the focus back to the gear.
      await user.click(gear);
      await user.click(await screen.findByLabelText('Ripassi al giorno'));
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('region', { name: 'Impostazioni dello studio' })).toBeNull());
      expect(gear).toHaveFocus();
    });

    it('lets the right column scroll with the page when it is taller than the window (G8)', async () => {
      const Observer = globalThis.ResizeObserver;
      const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
      globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => window.innerHeight });
      try {
        progress.mockResolvedValue(answer(1, 1));
        renderHome();
        const stats = await screen.findByRole('region', { name: 'I tuoi progressi' });
        // As tall as the window: with 32 px above and below it does not fit, so it is not sticky.
        await waitFor(() => expect(stats.parentElement).not.toHaveClass('xl:sticky'));
        expect(stats.parentElement).toHaveClass('xl:col-start-2');
      } finally {
        globalThis.ResizeObserver = Observer;
        if (height) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', height);
        else delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
      }
    });

    it('lets the right column scroll with the page while the settings are open (G6)', async () => {
      progress.mockResolvedValue(answer(1, 1));
      renderHome();
      const user = userEvent.setup();
      const stats = await screen.findByRole('region', { name: 'I tuoi progressi' });
      expect(stats.parentElement).toHaveClass('xl:sticky');
      await user.click(screen.getByRole('button', { name: 'Impostazioni dello studio' }));
      expect(stats.parentElement).not.toHaveClass('xl:sticky');
    });

    it('says the day alone over the large line — the title says «Oggi» —, and no «Oggi:» before the counts (G8)', async () => {
      progress.mockResolvedValue(answer(12, 8));
      renderHome();
      const day = await screen.findByRole('region', { name: 'Il ripasso di oggi' });
      expect(within(day).getByText('12 da ripassare, 8 nuove')).toHaveClass('font-serif', 'md:text-4xl');
      expect(within(day).getByText('lunedì 19 ottobre')).toBeInTheDocument();
      expect(within(day).queryByText(/^Oggi/)).toBeNull();
      expect(screen.queryByText(/^Oggi:/)).toBeNull();
      // The missions under it carry no action of their own.
      const missions = screen.getByRole('region', { name: 'Le missioni di oggi' });
      expect(within(missions).queryByRole('button', { name: START })).toBeNull();
    });

    it('draws the streak in the statistics, and no ring of the goal, which its mission says (G8)', async () => {
      progress.mockResolvedValue(answer(3, 0));
      renderHome();
      expect(await screen.findByRole('img', { name: 'Serie: 4 giorni di fila, record 9' })).toHaveTextContent('4');
      const band = screen.getByRole('region', { name: 'I tuoi progressi' });
      expect(within(band).queryByRole('img', { name: /^Obiettivo di oggi/ })).toBeNull();
      expect(screen.getByRole('list', { name: 'Missioni di oggi' }).querySelector('[data-missione="obiettivo"]')).toHaveTextContent('0 di 10');
    });

    it('lists one row a subject, by the cards still open, and «Ripassa» starts a session on it', async () => {
      const data = answer(3, 3);
      data.materie = [
        { materia: 'DIRITTO_CIVILE', nuove: 0, apprendimento: 2, consolidate: 400, ripassi30: 210 },
        { materia: 'DIRITTO_PENALE', nuove: 9, apprendimento: 1, consolidate: 0, ripassi30: 1 },
        { materia: 'DIRITTO_AMMINISTRATIVO', nuove: 0, apprendimento: 0, consolidate: 0, ripassi30: 0 },
        { materia: 'DIRITTO_PROCESSUALE_CIVILE', nuove: 2, apprendimento: 0, consolidate: 0, ripassi30: 0 },
        { materia: 'DIRITTO_PROCESSUALE_PENALE', nuove: 0, apprendimento: 0, consolidate: 3, ripassi30: 0 },
      ];
      progress.mockResolvedValue(data);
      renderHome();
      const group = await screen.findByRole('group', { name: 'Materia' });
      const rows = within(group).getAllByRole('listitem');
      // «Tutte le materie» on top, the active choice.
      expect(within(rows[0]).getByRole('button', { name: 'Tutte le materie' })).toHaveAttribute('aria-pressed', 'true');
      const stops = rows.slice(1);
      expect(stops.map((li) => li.querySelector('[data-subject-name]')?.textContent)).toEqual([
        'Diritto penale', 'Diritto civile', 'Diritto processuale civile', 'Diritto amministrativo', 'Diritto processuale penale',
      ]);
      // The states said in words to a screen reader; the reviews of 30 days are «Progressi»' alone (G8).
      expect(stops[1]).toHaveTextContent('0 nuove · 2 in apprendimento · 400 consolidate');
      expect(stops[1]).not.toHaveTextContent('ultimi 30 giorni');
      // A subject with no card has nothing to start.
      expect(stops[3]).toHaveTextContent('Nessuna scheda');
      expect(within(stops[3]).queryByRole('button', { name: /^Ripassa/ })).toBeNull();
      // Every row as wide as «Tutte le materie» (G8: they were 8 px short at 1920): a row from `md`, the choice taking what
      // «Ripassa» leaves — all of it with no card —, never a grid whose empty column keeps its gap.
      for (const stop of stops) {
        expect(stop).toHaveClass('md:flex');
        expect(stop.className).not.toMatch(/md:grid-cols/);
        expect(within(stop).getAllByRole('button')[0]).toHaveClass('md:flex-1');
      }
      await userEvent.setup().click(within(stops[0]).getByRole('button', { name: 'Ripassa Diritto penale' }));
      expect(screen.getByTestId('where')).toHaveTextContent('/studia/ripasso/sessione?materia=DIRITTO_PENALE');
    });

    it('lays the page in the order fixed: the day, the missions, the statistics, the subjects, the full list', async () => {
      progress.mockResolvedValue(answer(3, 0));
      renderHome();
      const order = ['Il ripasso di oggi', 'Le missioni di oggi', 'I tuoi progressi', 'Le tue materie', 'Tutte le missioni'];
      const headings = await Promise.all(order.map((name) => screen.findByRole('heading', { name })));
      for (let i = 1; i < headings.length; i++) {
        expect(headings[i - 1].compareDocumentPosition(headings[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
      // One type language: no small capitals in the headings.
      for (const heading of headings) expect(heading.className).not.toMatch(/small-caps/);
    });
  });

  describe('the institutes of the subjects (Gymnasium spec §5.2, G5)', () => {
    const tappa = (materia: TappaIstituto['materia'], istituto: string, dovute: number): TappaIstituto => ({
      materia, istituto, nuove: 1, apprendimento: dovute, consolidate: 0, dovute,
    });

    it('reads the road by institute once, for every subject, and says each subject’s cards due today', async () => {
      progress.mockResolvedValue(answer(7, 0));
      percorso.mockResolvedValue([
        tappa('DIRITTO_CIVILE', 'Risoluzione per inadempimento', 3),
        tappa('DIRITTO_CIVILE', 'Mora del debitore', 4),
        tappa('DIRITTO_PENALE', 'Furto', 0),
      ]);
      renderHome();
      const civile = await subjectRow('Diritto civile');
      expect(await within(civile).findByText('7 oggi')).toBeInTheDocument();
      // Said «7 da ripassare oggi» to a screen reader; «7 oggi» to the eye.
    expect(within(civile).getByText(', 7 da ripassare oggi')).toHaveClass('sr-only');
      expect(await subjectRow('Diritto penale')).toHaveTextContent('0 oggi');
      expect(percorso).toHaveBeenCalledTimes(1);
      expect(percorso).toHaveBeenCalledWith();
    });

    it('shows the chosen subject\'s institutes, and a tap starts the session narrowed to one', async () => {
      progress.mockResolvedValue(answer(7, 0));
      percorso.mockResolvedValue([
        tappa('DIRITTO_CIVILE', 'Risoluzione per inadempimento', 3),
        tappa('DIRITTO_CIVILE', 'Mora del debitore', 4),
        tappa('DIRITTO_PENALE', 'Furto', 2),
      ]);
      renderHome();
      await subjectRow('Diritto civile');
      expect(screen.queryByRole('list', { name: 'Istituti di Diritto civile' })).toBeNull();
      const user = userEvent.setup();
      await user.click(subjectChoice('Diritto civile'));
      const institutes = await screen.findByRole('list', { name: 'Istituti di Diritto civile' });
      expect(screen.getByRole('region', { name: 'Gli istituti di Diritto civile' })).toContainElement(institutes);
      expect(within(institutes).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
        'Ripassa Mora del debitore: 4 da ripassare',
        'Ripassa Risoluzione per inadempimento: 3 da ripassare',
      ]);
      await user.click(within(institutes).getByRole('button', { name: /Risoluzione per inadempimento/ }));
      expect(screen.getByTestId('where')).toHaveTextContent('/studia/ripasso/sessione?materia=DIRITTO_CIVILE&istituto=Risoluzione+per+inadempimento');
    });

    it('opens on the institutes of the subject remembered', async () => {
      localStorage.setItem(STORAGE_KEY, 'DIRITTO_PENALE');
      progress.mockResolvedValue(answer(2, 0));
      percorso.mockResolvedValue([tappa('DIRITTO_PENALE', 'Furto', 2), tappa('DIRITTO_CIVILE', 'Mora del debitore', 1)]);
      renderHome();
      expect(await screen.findByRole('list', { name: 'Istituti di Diritto penale' })).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Istituti di Diritto civile' })).toBeNull();
    });

    it('follows the subject chosen: its institutes only, and none for every subject', async () => {
      progress.mockResolvedValue(answer(3, 0));
      percorso.mockResolvedValue([tappa('DIRITTO_PENALE', 'Furto', 2), tappa('DIRITTO_CIVILE', 'Mora del debitore', 1)]);
      renderHome();
      await subjectRow('Diritto civile');
      const user = userEvent.setup();
      await user.click(subjectChoice('Diritto civile'));
      expect(await screen.findByRole('list', { name: 'Istituti di Diritto civile' })).toBeInTheDocument();
      await user.click(subjectChoice('Diritto penale'));
      expect(await screen.findByRole('list', { name: 'Istituti di Diritto penale' })).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Istituti di Diritto civile' })).toBeNull();
      await user.click(within(subjects()).getByRole('button', { name: 'Tutte le materie' }));
      expect(screen.queryByRole('list', { name: /^Istituti di/ })).toBeNull();
    });

    it('holds the cards due in place while the read travels, and the day block does not wait on it', async () => {
      progress.mockResolvedValue(answer(3, 0));
      percorso.mockReturnValue(new Promise(() => {}));
      renderHome();
      expect(await screen.findByRole('button', { name: 'Inizia il ripasso' })).toBeEnabled();
      const group = await screen.findByRole('group', { name: 'Materia' });
      expect(group.querySelectorAll('.motion-safe\\:animate-pulse').length).toBeGreaterThan(0);
      expect(within(group).queryByText(/\d+ oggi$/)).toBeNull();
    });

    it('keeps «Inizia il ripasso» and the subjects when the read fails, and reads it again on request', async () => {
      progress.mockResolvedValue(answer(3, 0));
      percorso.mockRejectedValueOnce(new Error('down'));
      renderHome();
      const civile = await subjectRow('Diritto civile');
      expect(screen.getByRole('button', { name: 'Inizia il ripasso' })).toBeEnabled();
      expect(within(civile).getByRole('button', { name: 'Ripassa Diritto civile' })).toBeEnabled();
      // No alert of its own: the cards due are left out, and the institutes say it when shown.
      expect(screen.queryByRole('alert')).toBeNull();
      await waitFor(() => expect(civile.querySelector('.motion-safe\\:animate-pulse')).toBeNull());
      expect(civile).not.toHaveTextContent(/\d oggi/);
      const user = userEvent.setup();
      await user.click(subjectChoice('Diritto civile'));
      expect(await screen.findByText('Non riesco a leggere gli istituti di questa materia.')).toBeInTheDocument();
      percorso.mockResolvedValue([tappa('DIRITTO_CIVILE', 'Mora del debitore', 1)]);
      await user.click(screen.getByRole('button', { name: 'Riprova gli istituti di Diritto civile' }));
      expect(await screen.findByRole('button', { name: 'Ripassa Mora del debitore: 1 da ripassare' })).toBeInTheDocument();
      expect(percorso).toHaveBeenCalledTimes(2);
    });

    it('reads the institutes again with the day block\'s «Riprova» and after a setting changed', async () => {
      progress.mockRejectedValueOnce(new Error('down'));
      renderHome();
      const alert = await screen.findByRole('alert');
      progress.mockResolvedValue(answer(3, 0));
      const user = userEvent.setup();
      await user.click(within(alert).getByRole('button', { name: 'Riprova' }));
      await screen.findByRole('group', { name: 'Materia' });
      expect(percorso).toHaveBeenCalledTimes(2);
      await user.click(screen.getByRole('button', { name: 'Impostazioni dello studio' }));
      savePreferences.mockResolvedValue({ nuoveAlGiorno: 20, ripassiAlGiorno: 10, materieComunita: ['DIRITTO_CIVILE'] });
      await user.click(await screen.findByRole('button', { name: /^Schede della comunità · / }));
      await user.click(screen.getByRole('switch', { name: 'Diritto civile' }));
      await waitFor(() => expect(percorso).toHaveBeenCalledTimes(3));
    });

    it('offers no session and no institutes for a subject with no card', async () => {
      const data = answer(0, 0);
      data.materie[2] = { materia: 'DIRITTO_AMMINISTRATIVO', nuove: 0, apprendimento: 0, consolidate: 0, ripassi30: 0 };
      progress.mockResolvedValue(data);
      renderHome();
      const amministrativo = await subjectRow('Diritto amministrativo');
      expect(amministrativo).toHaveTextContent('Nessuna scheda');
      expect(within(amministrativo).queryByRole('button', { name: /^Ripassa/ })).toBeNull();
      await userEvent.setup().click(subjectChoice('Diritto amministrativo'));
      expect(screen.queryByRole('list', { name: /^Istituti di/ })).toBeNull();
    });
  });

  describe('the missions (Gymnasium spec §5.1)', () => {
    /** Today: 9 reviews so far, 2 of them new cards; 10 due and 8 new still waiting. */
    function midDay(over: Partial<Progressi['oggi']> = {}): Progressi {
      const data = answer(10, 8, { ripassi: 9, ...over });
      data.calendario = [...data.calendario, { giorno: '2026-10-19', ripassi: 9, nuove: 2, sbagliate: 0, valido: false, riposo: false }];
      // The server's missions (G1c): 7 due cards reviewed of 17, 2 new of 5, the goal credited once met.
      data.missioni = serverMissions({
        dovute: { progresso: { fatte: 7, di: 17 } },
        nuove: { progresso: { fatte: 2, di: 5 } },
        obiettivo: data.oggi.raggiunto ? { stato: 'fatta', progresso: { fatte: 10, di: 10 } } : { progresso: { fatte: data.oggi.ripassi, di: 10 } },
      });
      return data;
    }

    it('gives the three of the day as compact rows with their counts and «2 di 3», the action in the day block above', async () => {
      progress.mockResolvedValue(midDay({ ripassi: 11, raggiunto: true }));
      localStorage.setItem('visualex.studia.festeggiato', '2026-10-19');
      renderHome();
      const card = await screen.findByRole('region', { name: 'Le missioni di oggi' });
      const rows = within(within(card).getByRole('list', { name: 'Missioni di oggi' })).getAllByRole('listitem');
      expect(rows.map((row) => row.querySelector('p')?.firstChild?.textContent)).toEqual([
        'Ripassa le schede dovute',
        'Impara 5 schede nuove',
        'Raggiungi l’obiettivo di oggi',
      ]);
      // The server's counts: 7 due cards of 17, 2 new of 5, the goal credited.
      expect(rows[0]).toHaveTextContent('7 di 17');
      expect(rows[1]).toHaveTextContent('2 di 5');
      // Past the goal the count stops at it.
      expect(rows[2]).toHaveTextContent('10 di 10');
      // Each with its points, earned ones in ink with a «+» (G1c), said in words.
      expect(rows[0]).toHaveTextContent('20 XP');
      expect(rows[0]).toHaveTextContent('vale 20 punti');
      expect(rows[2]).toHaveTextContent('+10 XP');
      expect(rows[2]).toHaveTextContent('10 punti guadagnati');
      expect(rows[2]).toHaveTextContent('compiuta');
      expect(within(card).getByText('1 di 3')).toBeInTheDocument();
      // On a phone every row has one shape: the count and the points under the title, whatever its length; beside it
      // from `md` (G8).
      for (const row of rows) {
        const head = row.querySelector('p')!.parentElement!;
        expect(head).toHaveClass('flex-col', 'items-start', 'md:flex-row', 'md:justify-between');
        expect(head.className).not.toMatch(/(^|\s)flex-wrap(\s|$)/);
      }
      // The bar is 4 px (G8); the first row no longer carries the action.
      expect(rows[0].querySelector('.h-1')).not.toBeNull();
      expect(within(rows[0]).queryByRole('button')).toBeNull();
      expect(within(screen.getByRole('region', { name: 'Il ripasso di oggi' })).getByRole('button', { name: 'Continua il ripasso' })).toBeInTheDocument();
      // The goal's mark is the day block's (G9), never the row's: its line is read under it.
      expect(within(rows[2]).queryByTestId('goal-mark')).toBeNull();
      expect(within(screen.getByRole('region', { name: 'Il ripasso di oggi' })).getByTestId('goal-mark')).toBeInTheDocument();
      localStorage.removeItem('visualex.studia.festeggiato');
    });

    it('sends the targets to the settings with one line under the missions, which takes the focus there (G8)', async () => {
      progress.mockResolvedValue(midDay());
      renderHome();
      const user = userEvent.setup();
      const card = await screen.findByRole('region', { name: 'Le missioni di oggi' });
      // Settings, not missions: no «Cambia…» under the bars.
      expect(screen.queryByRole('button', { name: 'Cambia l’obiettivo' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Cambia le nuove al giorno' })).toBeNull();
      const line = within(card).getByRole('button', { name: 'Obiettivo e nuove al giorno: nelle impostazioni' });
      expect(line).toHaveAttribute('aria-controls', 'studia-impostazioni');
      await user.click(line);
      const panel = screen.getByRole('region', { name: 'Impostazioni dello studio' });
      await waitFor(() => expect(panel).toHaveFocus());
      expect(screen.getByRole('button', { name: 'Impostazioni dello studio' })).toHaveAttribute('aria-expanded', 'true');
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('says when a mission has nothing to do today, leaves it out of the summary, and opens the community\'s cards from the settings line', async () => {
      const data = answer(4, 0, { ripassi: 3 });
      data.missioni = serverMissions({ nuove: { stato: 'vuota', progresso: undefined } });
      progress.mockResolvedValue(data);
      renderHome();
      const card = await screen.findByRole('region', { name: 'Le missioni di oggi' });
      expect(within(card).getByText('Nessuna scheda nuova da imparare oggi.')).toBeInTheDocument();
      expect(within(card).queryByRole('button', { name: 'Accendi le schede della comunità' })).toBeNull();
      expect(within(card).getByText('0 di 2')).toBeInTheDocument();
      // No new card to be had: the settings open at the community's subjects, already open (G6).
      await userEvent.setup().click(within(card).getByRole('button', { name: 'Obiettivo e nuove al giorno: nelle impostazioni' }));
      const panel = screen.getByRole('region', { name: 'Impostazioni dello studio' });
      expect(await within(panel).findByRole('button', { name: 'Schede della comunità · 0 di 5' })).toHaveAttribute('aria-expanded', 'true');
      expect(within(panel).getAllByRole('switch')).toHaveLength(5);
    });

    it('says that the daily quota stops «Impara 5» (L-27 choice 5)', async () => {
      const data = midDay();
      data.missioni = serverMissions({ nuove: { motivo: 'quota', progresso: { fatte: 1, di: 5 } } });
      progress.mockResolvedValue(data);
      renderHome();
      const row = (await screen.findByRole('list', { name: 'Missioni di oggi' })).querySelector('[data-missione="nuove"]') as HTMLElement;
      expect(row).toHaveTextContent('Le nuove al giorno che hai scelto non bastano: alzale per arrivare a 5.');
      expect(within(row).queryByRole('button')).toBeNull();
    });

    it('says the day counts for the streak while the mission still wants its 10 reviews', async () => {
      const data = answer(4, 2, { ripassi: 6, obiettivo: 5, raggiunto: true });
      data.missioni = serverMissions({ obiettivo: { progresso: { fatte: 6, di: 10 } } });
      localStorage.setItem('visualex.studia.festeggiato', '2026-10-19');
      progress.mockResolvedValue(data);
      renderHome();
      const row = (await screen.findByRole('list', { name: 'Missioni di oggi' })).querySelector('[data-missione="obiettivo"]') as HTMLElement;
      expect(row).toHaveTextContent('6 di 10');
      expect(row).toHaveTextContent('da fare');
      expect(within(row).getByText('Il giorno conta per la serie; per i punti della missione servono 10 ripassi.')).not.toHaveClass('sr-only');
      localStorage.removeItem('visualex.studia.festeggiato');
    });

    it('never shows one subject’s counts under another’s name while the new read travels', async () => {
      progress.mockResolvedValue(answer(5, 5));
      renderHome();
      await screen.findByText('5 da ripassare, 5 nuove');
      const user = userEvent.setup();
      progress.mockResolvedValue(answer(2, 3));
      await user.click(subjectChoice('Diritto penale'));
      await screen.findByText('2 da ripassare, 3 nuove');
      await user.click(within(subjects()).getByRole('button', { name: 'Tutte le materie' }));
      let answerCivile: (value: Progressi) => void = () => {};
      progress.mockImplementation(() => new Promise((resolve) => { answerCivile = resolve; }));
      await user.click(subjectChoice('Diritto civile'));
      // Penale's answer is not drawn under Civile's name: the block waits, «Inizia il ripasso» with it.
      expect(screen.getByText('lunedì 19 ottobre · Diritto civile')).toBeInTheDocument();
      expect(screen.queryByText('2 da ripassare, 3 nuove')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Inizia il ripasso' })).toBeNull();
      answerCivile(answer(7, 1));
      expect(await screen.findByText('7 da ripassare, 1 nuova')).toBeInTheDocument();
    });

    it('says so in the day block when the subject’s read fails, and keeps «Inizia il ripasso»', async () => {
      progress.mockResolvedValue(answer(5, 5));
      renderHome();
      await screen.findByText('5 da ripassare, 5 nuove');
      progress.mockRejectedValue(new Error('down'));
      await userEvent.setup().click(subjectChoice('Diritto penale'));
      const alert = await screen.findByRole('alert');
      expect(screen.getByRole('region', { name: 'Il ripasso di oggi' })).toContainElement(alert);
      expect(screen.getByRole('button', { name: 'Inizia il ripasso' })).toBeEnabled();
      // The missions under it are the day's, still drawn.
      expect(screen.getByRole('list', { name: 'Missioni di oggi' })).toBeInTheDocument();
    });

    it('keeps the missions the whole day’s when a subject narrows the day block', async () => {
      progress.mockResolvedValue(midDay());
      renderHome();
      const card = await screen.findByRole('region', { name: 'Le missioni di oggi' });
      progress.mockResolvedValue(answer(2, 5, { ripassi: 9 }));
      await userEvent.setup().click(subjectChoice('Diritto penale'));
      expect(await screen.findByText('2 da ripassare, 5 nuove')).toBeInTheDocument();
      expect(within(card).getAllByRole('listitem')[0]).toHaveTextContent('7 di 17');
    });
  });

  describe('the statistics (Gymnasium spec §5.1)', () => {
    it('leaves the subject chosen for «Progressi» to open on: one choice for the area', async () => {
      progress.mockResolvedValue(answer(5, 5));
      renderHome();
      await screen.findByText('5 da ripassare, 5 nuove');
      progress.mockResolvedValue(answer(2, 3));
      await userEvent.setup().click(subjectChoice('Diritto penale'));
      await screen.findByText('2 da ripassare, 3 nuove');
      expect(localStorage.getItem(STORAGE_KEY)).toBe('DIRITTO_PENALE');
      expect(screen.getByRole('link', { name: 'Tutti i progressi' })).toHaveAttribute('href', '/studia/progressi');
    });

    it('draws the current week, Monday to Sunday, with its seven letters', async () => {
      progress.mockResolvedValue(answer(3, 0));
      renderHome();
      const week = await screen.findByRole('list', { name: 'Questa settimana' });
      const days = within(week).getAllByRole('listitem');
      expect(days.map((day) => day.querySelector('span')?.textContent).join('')).toBe('LMMGVSD');
      // 19 October 2026 is a Monday: today first, the rest to come.
      expect(days.map((day) => day.dataset.stato)).toEqual(['oggi', 'futuro', 'futuro', 'futuro', 'futuro', 'futuro', 'futuro']);
      expect(days[0]).toHaveTextContent('lunedì 19 ottobre: oggi, da fare');
    });

    it('shows a first-time user a week with nothing missed', async () => {
      const first = answer(5, 5, { ripassi: 0, giorno: '2026-10-22' }, 0);
      first.serie.record = 0;
      first.serie.ultimiGiorni = ['16', '17', '18', '19', '20', '21', '22'].map((d, i) => ({ giorno: `2026-10-${d}`, stato: i === 6 ? 'oggi' : 'saltato' }));
      // Never studied: the calendar holds no day.
      first.calendario = [];
      progress.mockResolvedValue(first);
      renderHome();
      const days = within(await screen.findByRole('list', { name: 'Questa settimana' })).getAllByRole('listitem');
      expect(days.map((day) => day.dataset.stato)).toEqual(['vuoto', 'vuoto', 'vuoto', 'oggi', 'futuro', 'futuro', 'futuro']);
      expect(screen.getByText('Il primo giorno comincia oggi')).toBeInTheDocument();
    });
  });

  describe('the full list (Gymnasium spec §5.1)', () => {
    it('lists the missions that can be done as the server decides them, and names those still to come in one line (G1c, G8)', async () => {
      const data = answer(3, 0);
      data.missioni = serverMissions({ 'materia-ferma': { stato: 'aperta', progresso: { fatte: 2, di: 5 }, materia: 'DIRITTO_PENALE' } });
      progress.mockResolvedValue(data);
      renderHome();
      const list = await screen.findByRole('region', { name: 'Tutte le missioni' });
      for (const group of ['Giornaliere', 'Settimanali', 'A lungo termine']) {
        expect(within(list).getByRole('heading', { name: group })).toBeInTheDocument();
      }
      // «caso» is still to come: no row, no dotted ring, no points; one quiet line at the foot.
      expect(list.querySelector('[data-missione="caso"]')).toBeNull();
      expect(within(list).queryByText('In arrivo', { selector: 'span' })).toBeNull();
      const soon = within(list).getByText('In arrivo: caso breve');
      expect(soon).toHaveClass('text-slate-500');
      expect(soon.closest('li')).toBeNull();
      expect(within(list).getByText('Proponi una scheda')).toBeInTheDocument();
      expect(within(list).getByText('Una settimana di serie')).toBeInTheDocument();
      expect(within(list).getByText('Consolida 50 schede')).toBeInTheDocument();
      const stale = list.querySelector('[data-missione="materia-ferma"]') as HTMLElement;
      expect(stale).toHaveTextContent('2 di 5');
      expect(stale).toHaveTextContent('Diritto penale');
      expect(stale).toHaveTextContent('15 XP');
      expect(list.querySelector('[data-missione="settimana"]')).toHaveTextContent('3 di 7');
      expect(list.querySelector('[data-missione="materia-ferma"]')).not.toHaveTextContent('Niente oggi');
      expect(list.querySelector('[data-missione="consolida"]')).toHaveTextContent('100 XP');
      // Today's three are above, in «Le missioni di oggi», and only there (G6).
      expect(within(list).getByText('Le tre di oggi sono qui sopra.')).toBeInTheDocument();
      for (const title of ['Ripassa le schede dovute', 'Raggiungi l’obiettivo di oggi']) expect(within(list).queryByText(title)).toBeNull();
      expect(within(list).queryByText(/^Impara \d+ schede nuove$/)).toBeNull();
      // Nothing to tick: no checkbox, no button.
      expect(within(list).queryAllByRole('checkbox')).toEqual([]);
      expect(within(list).queryAllByRole('button')).toEqual([]);
      // The validation mission is a validator's: the server lists it.
      expect(within(list).queryByText('Convalida due schede della comunità')).toBeNull();
    });

    it('offers the validation mission when the server lists it (a validator’s)', async () => {
      const data = answer(3, 0);
      data.missioni = serverMissions({ convalida: { stato: 'vuota', progresso: { fatte: 1, di: 2 } } }, { validator: true });
      progress.mockResolvedValue(data);
      render(
        <MemoryRouter initialEntries={['/studia/ripasso']}>
          <Routes>
            <Route element={<Outlet context={{ validator: true }} />}>
              <Route path="/studia/ripasso" element={<ReviewHome />} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
      const list = await screen.findByRole('region', { name: 'Tutte le missioni' });
      expect(within(list).getByText('Convalida due schede della comunità')).toBeInTheDocument();
      // One vote cast, nothing left to vote on: «1 di 2» stays beside «Niente oggi».
      const convalida = list.querySelector('[data-missione="convalida"]') as HTMLElement;
      expect(convalida).toHaveTextContent('1 di 2');
      expect(convalida).toHaveTextContent('Niente oggi');
    });
  });
});

describe('the motions of «Oggi» (S2, G8)', () => {
  const SEEN = 'visualex.studia.visto';
  afterEach(() => localStorage.removeItem(SEEN));

  /** Today: 9 reviews, 5 of them new cards (the mission of the new ones done), the goal still open. */
  function newOnesDone(): Progressi {
    const data = answer(10, 8, { ripassi: 9 });
    data.calendario = [...data.calendario, { giorno: '2026-10-19', ripassi: 9, nuove: 5, sbagliate: 0, valido: false, riposo: false }];
    data.missioni = serverMissions({ nuove: { stato: 'fatta', progresso: { fatte: 5, di: 5 } } });
    return data;
  }
  const today = () => within(screen.getByRole('list', { name: 'Missioni di oggi' }));
  const order = () => today().getAllByRole('listitem').map((li) => li.getAttribute('data-missione'));

  it('runs the ink of a mission done since it was last drawn, then slides it under the open ones', async () => {
    localStorage.setItem(SEEN, JSON.stringify({ serie: 4, giorno: '2026-10-19', ripassi: 9, missioni: [] }));
    progress.mockResolvedValue(newOnesDone());
    renderHome();
    await screen.findByRole('list', { name: 'Missioni di oggi' });
    expect(order()).toEqual(['dovute', 'nuove', 'obiettivo']);
    const title = today().getByText('Impara 5 schede nuove');
    expect(title).toHaveClass('vlx-mission-inking');
    await waitFor(() => expect(order()).toEqual(['dovute', 'obiettivo', 'nuove']), { timeout: 3000 });
    expect(today().getByText('Impara 5 schede nuove')).toHaveClass('vlx-mission-done');
    expect(JSON.parse(localStorage.getItem(SEEN)!).missioni).toEqual(['nuove']);
  });

  it('draws a mission already seen done at rest, under the open ones, with no ink running', async () => {
    localStorage.setItem(SEEN, JSON.stringify({ serie: 4, giorno: '2026-10-19', ripassi: 9, missioni: ['nuove'] }));
    progress.mockResolvedValue(newOnesDone());
    renderHome();
    await screen.findByRole('list', { name: 'Missioni di oggi' });
    expect(order()).toEqual(['dovute', 'obiettivo', 'nuove']);
    expect(today().getByText('Impara 5 schede nuove')).toHaveClass('vlx-mission-done');
    expect(today().getByText('Impara 5 schede nuove')).not.toHaveClass('vlx-mission-inking');
  });

  it('draws the new tally mark for what grew since this browser drew it, and no landing ring: the goal is the mission\'s (G8)', async () => {
    localStorage.setItem(SEEN, JSON.stringify({ serie: 3, giorno: '2026-10-19', ripassi: 7, missioni: [] }));
    progress.mockResolvedValue(answer(10, 8, { ripassi: 9 }, 4));
    renderHome();
    const tally = await screen.findByTestId('streak-tally');
    expect(tally).toHaveAttribute('data-marks', '4');
    expect(screen.queryByTestId('goal-count-landing')).toBeNull();
    expect(screen.queryByRole('img', { name: /^Obiettivo di oggi/ })).toBeNull();
  });

  it('brings the day block in with the light cascade once its content is drawn, and not under reduced motion', async () => {
    const animate = vi.fn();
    const original = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = animate as unknown as typeof HTMLElement.prototype.animate;
    try {
      progress.mockResolvedValue(answer(3, 0));
      const { unmount } = renderHome();
      await screen.findByText('3 da ripassare');
      const day = screen.getByRole('region', { name: 'Il ripasso di oggi' });
      // Opacity only, one keyframe at the start; the block's children, the first ones a step apart.
      const calls = animate.mock.calls.filter((_, i) => day.contains(animate.mock.contexts[i] as Node));
      expect(calls.length).toBeGreaterThan(2);
      expect(calls[0][0]).toEqual([{ opacity: 0, offset: 0 }]);
      unmount();

      animate.mockClear();
      const real = window.matchMedia;
      window.matchMedia = ((query: string) => ({
        matches: query.includes('reduce'), media: query, onchange: null, addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
      try {
        renderHome();
        await screen.findByText('3 da ripassare');
        const block = screen.getByRole('region', { name: 'Il ripasso di oggi' });
        expect(animate.mock.contexts.some((el) => block.contains(el as Node))).toBe(false);
      } finally {
        window.matchMedia = real;
      }
    } finally {
      HTMLElement.prototype.animate = original;
    }
  });
});
