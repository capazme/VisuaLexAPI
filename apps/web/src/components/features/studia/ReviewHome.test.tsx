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
});

describe('ReviewHome', () => {
  it('says what is on today, how far the goal is, and offers to start', async () => {
    progress.mockResolvedValue(answer(18, 20));
    renderHome();
    expect(await screen.findByText('Oggi: 18 da ripassare, 20 nuove')).toBeInTheDocument();
    expect(progress).toHaveBeenCalledWith(undefined);
    expect(screen.getByRole('img', { name: 'Obiettivo di oggi: 6 di 10 ripassi' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Serie: 4 giorni di fila, record 9' })).toBeInTheDocument();
    expect(screen.getByText('Ancora 4 ripassi per tenere viva la serie.')).toBeInTheDocument();
    const start = screen.getByRole('button', { name: 'Inizia' });
    expect(start).toBeEnabled();
    await userEvent.setup().click(start);
    expect(screen.getByTestId('where')).toHaveTextContent('/studia/ripasso/sessione');
    expect(screen.getByTestId('where').textContent).not.toContain('materia');
  });

  it('draws the statistics: the cards by state as three numbers, and «Tutti i progressi» leads to the page of the data', async () => {
    progress.mockResolvedValue(answer(3, 0));
    renderHome();
    const band = await screen.findByRole('region', { name: 'I tuoi progressi' });
    const numbers = within(band).getAllByRole('definition').map((dd) => dd.textContent);
    expect(numbers).toEqual(['3', '5', '2']);
    expect(within(band).getAllByRole('term').map((dt) => dt.textContent)).toEqual(['Nuove', 'In apprendimento', 'Consolidate']);
    // The long calendar and the coming days live on /studia/progressi (G3): no sheet repeats them here.
    expect(screen.queryByRole('heading', { name: 'Il tuo andamento' })).toBeNull();
    expect(within(band).queryByRole('button', { name: 'Il tuo mese' })).toBeNull();
    await userEvent.setup().click(within(band).getByRole('link', { name: 'Tutti i progressi' }));
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
    await screen.findByText('Oggi: 18 da ripassare, 20 nuove');
    const chips = screen.getByRole('group', { name: 'Materia' });
    expect(within(chips).getByRole('button', { name: 'Tutte le materie' })).toHaveAttribute('aria-pressed', 'true');

    progress.mockResolvedValue(answer(2, 5));
    await userEvent.setup().click(within(chips).getByRole('button', { name: 'Diritto penale' }));
    expect(await screen.findByText('Oggi in Diritto penale: 2 da ripassare, 5 nuove')).toBeInTheDocument();
    expect(progress).toHaveBeenLastCalledWith('DIRITTO_PENALE');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('DIRITTO_PENALE');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Inizia' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/studia/ripasso/sessione?materia=DIRITTO_PENALE');
    unmount();

    renderHome();
    await screen.findByText('Oggi in Diritto penale: 2 da ripassare, 5 nuove');
    expect(progress).toHaveBeenLastCalledWith('DIRITTO_PENALE');
  });

  it('ignores a remembered value that is not a subject', async () => {
    localStorage.setItem(STORAGE_KEY, 'DIRITTO_ALIENO');
    progress.mockResolvedValue(answer(1, 1));
    renderHome();
    await screen.findByText('Oggi: 1 da ripassare, 1 nuova');
    expect(progress).toHaveBeenCalledWith(undefined);
  });

  it('says the day is done, with the next day that has cards, and offers no start when nothing is due and nothing is new', async () => {
    progress.mockResolvedValue(answer(0, 0, { raggiunto: true }));
    renderHome();
    expect(await screen.findByText('Hai finito per oggi.')).toBeInTheDocument();
    // `prossimi` has 2 cards each day after today.
    expect(screen.getByText('Le prossime schede: domani.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Inizia|Continua)$/ })).toBeNull();
  });

  it('starts with new cards alone', async () => {
    progress.mockResolvedValue(answer(0, 7));
    renderHome();
    await screen.findByText('Oggi: 7 nuove');
    expect(screen.getByRole('button', { name: 'Inizia' })).toBeEnabled();
  });

  it('speaks of the first day of the streak to someone who has none yet', async () => {
    progress.mockResolvedValue(answer(18, 20, { ripassi: 0 }, 0));
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
    await screen.findByText('Oggi: 5 da ripassare, 5 nuove');
    progress.mockResolvedValue(answer(0, 0, { ripassi: 2 }));
    await userEvent.setup().click(within(screen.getByRole('group', { name: 'Materia' })).getByRole('button', { name: 'Diritto penale' }));
    expect(await screen.findByText('Niente da ripassare in questa materia, per oggi.')).toBeInTheDocument();
    // The goal is the whole day's, from the day's read (6 of 10), whatever the subject's counts say.
    expect(screen.getByText('Ancora 4 ripassi per tenere viva la serie.')).toBeInTheDocument();
    expect(screen.queryByText(/^Finisci le schede di oggi/)).toBeNull();
    // The way on: back to every subject.
    progress.mockResolvedValue(answer(5, 5));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ripassa tutte le materie' }));
    expect(await screen.findByText('Oggi: 5 da ripassare, 5 nuove')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Materia' })).getByRole('button', { name: 'Tutte le materie' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('holds the panels’ places while the first read travels, and stops pulsing when it fails', async () => {
    let fail: (reason: unknown) => void = () => {};
    progress.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    const { container } = renderHome();
    expect(screen.getByText('Carico i tuoi progressi…')).toBeInTheDocument();
    expect(container.querySelectorAll('.motion-safe\\:animate-pulse').length).toBeGreaterThan(2);
    fail(new Error('down'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Non riesco a leggere i tuoi progressi.');
    expect(container.querySelectorAll('.motion-safe\\:animate-pulse')).toHaveLength(0);
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('says what the road is missing when the progress cannot be read, and draws it once read again', async () => {
    progress.mockRejectedValueOnce(new Error('down'));
    renderHome();
    const alert = await screen.findByRole('alert');
    const road = screen.getByRole('region', { name: 'Il percorso' });
    expect(road).toHaveTextContent('Non riesco a leggere il tuo percorso: le materie tornano appena riesco a leggerle.');
    expect(within(road).queryByRole('list')).toBeNull();
    // Said once, by the missions: the road's line is no second alert.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    progress.mockResolvedValue(answer(1, 0));
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByRole('list', { name: 'Il percorso' })).toBeInTheDocument();
    expect(screen.queryByText(/Non riesco a leggere il tuo percorso/)).toBeNull();
  });

  it('tells someone with no card yet where to begin', async () => {
    const empty = answer(0, 0, { ripassi: 0 }, 0);
    empty.stati = { nuove: 0, apprendimento: 0, consolidate: 0 };
    progress.mockResolvedValue(empty);
    renderHome();
    expect(await screen.findByText('Non hai ancora schede da ripassare.')).toBeInTheDocument();
    // «Le mie schede» has no way to write a card yet (G4): the text says how to start from an article.
    expect(screen.getByText(/apri un articolo dalla/)).toHaveTextContent('«+ Nuova scheda» sotto il testo');
    expect(screen.getByRole('link', { name: 'Ricerca' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('button', { name: 'Inizia' })).toBeNull();
    // A first-time user: the ring at zero, the first day of the streak, a road with nothing started.
    expect(screen.getByRole('img', { name: 'Obiettivo di oggi: 0 di 10 ripassi' })).toBeInTheDocument();
  });

  it('says so, keeps the start usable, and reads again on request, when the progress cannot be read', async () => {
    progress.mockRejectedValueOnce(new Error('down'));
    renderHome();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Non riesco a leggere i tuoi progressi.');
    expect(screen.getByRole('button', { name: 'Inizia' })).toBeEnabled();
    progress.mockResolvedValue(answer(1, 0));
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText('Oggi: 1 da ripassare')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('reads again after a setting changed', async () => {
    progress.mockResolvedValue(answer(3, 0));
    renderHome();
    await screen.findByText('Oggi: 3 da ripassare');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Impostazioni dello studio' }));
    progress.mockResolvedValue(answer(3, 12));
    savePreferences.mockResolvedValue({ nuoveAlGiorno: 20, ripassiAlGiorno: 10, materieComunita: ['DIRITTO_CIVILE'] });
    await user.click(await screen.findByRole('button', { name: /^Schede della comunità · / }));
    await user.click(screen.getByRole('switch', { name: 'Diritto civile' }));
    expect(savePreferences).toHaveBeenCalledWith({ materieComunita: ['DIRITTO_CIVILE'] });
    expect(await screen.findByText('Oggi: 3 da ripassare, 12 nuove')).toBeInTheDocument();
    expect(progress).toHaveBeenCalledTimes(2);
  });

  it('never lets a slow answer for a subject chosen before overwrite the one that came after', async () => {
    const pending: Array<(value: Progressi) => void> = [];
    progress.mockResolvedValueOnce(answer(1, 1));
    renderHome();
    await screen.findByText('Oggi: 1 da ripassare, 1 nuova');
    progress.mockImplementation(() => new Promise((resolve) => { pending.push(resolve); }));
    const user = userEvent.setup();
    const chips = screen.getByRole('group', { name: 'Materia' });
    await user.click(within(chips).getByRole('button', { name: 'Diritto penale' }));
    await user.click(within(chips).getByRole('button', { name: 'Diritto civile' }));
    expect(pending).toHaveLength(2);
    // The newer request answers first, the older one after.
    pending[1](answer(7, 7));
    expect(await screen.findByText('Oggi in Diritto civile: 7 da ripassare, 7 nuove')).toBeInTheDocument();
    pending[0](answer(9, 9));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText('Oggi in Diritto civile: 7 da ripassare, 7 nuove')).toBeInTheDocument();
    expect(screen.queryByText('Oggi in Diritto civile: 9 da ripassare, 9 nuove')).not.toBeInTheDocument();
  });

  describe('the celebration (Studia progress spec §6.4)', () => {
    const CELEBRATED_KEY = 'visualex.studia.festeggiato';
    beforeEach(() => {
      localStorage.removeItem(CELEBRATED_KEY);
    });
    afterEach(() => {
      localStorage.removeItem(CELEBRATED_KEY);
    });

    it('plays once when the goal was met today, stamps the band, and remembers the day', async () => {
      progress.mockResolvedValue(answer(0, 0, { ripassi: 12, raggiunto: true }, 5));
      renderHome();
      expect(await screen.findByTestId('goal-stamp')).toHaveTextContent('Obiettivo raggiunto');
      expect(screen.getByTestId('goal-stamp')).toHaveTextContent('19 ottobre 2026 · giorno 5');
      await waitFor(() => expect(localStorage.getItem(CELEBRATED_KEY)).toBe('2026-10-19'));
    });

    it('keeps the stamp at rest, without a new burst, once the day was celebrated', async () => {
      localStorage.setItem(CELEBRATED_KEY, '2026-10-19');
      progress.mockResolvedValue(answer(0, 0, { ripassi: 12, raggiunto: true }, 5));
      const { container } = renderHome();
      expect(await screen.findByTestId('goal-stamp')).toBeInTheDocument();
      expect(container.querySelector('canvas')).toBeNull();
    });

    it('does not celebrate a day that counted with nothing reviewed', async () => {
      progress.mockResolvedValue(answer(0, 0, { ripassi: 0, raggiunto: true }, 5));
      const { container } = renderHome();
      expect(await screen.findByTestId('goal-stamp')).toBeInTheDocument();
      expect(container.querySelector('canvas')).toBeNull();
      expect(localStorage.getItem(CELEBRATED_KEY)).toBeNull();
    });

    it('marks the day as the burst begins, so leaving halfway does not replay it', async () => {
      vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(fakeContext());
      progress.mockResolvedValue(answer(0, 0, { ripassi: 12, raggiunto: true }, 5));
      const { container, unmount } = renderHome();
      await screen.findByTestId('goal-stamp');
      expect(container.querySelector('canvas')).not.toBeNull();
      // The day is written by the burst's mount effect, which React runs just after the canvas is in the page:
      // waited for, not read at once (a loaded machine reads between the two). The burst is still on (1.5 s).
      await waitFor(() => expect(localStorage.getItem(CELEBRATED_KEY)).toBe('2026-10-19'));
      expect(container.querySelector('canvas')).not.toBeNull();
      unmount();

      const again = renderHome();
      expect(await screen.findByTestId('goal-stamp')).toBeInTheDocument();
      expect(again.container.querySelector('canvas')).toBeNull();
    });

    it('keeps the burst through a new read (a subject chosen halfway), and takes the canvas away after 1.5 s', async () => {
      vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(fakeContext());
      progress.mockResolvedValue(answer(0, 0, { ripassi: 12, raggiunto: true }, 5));
      const { container } = renderHome();
      await screen.findByTestId('goal-stamp');
      const canvas = container.querySelector('canvas');
      expect(canvas).not.toBeNull();
      await userEvent.setup().click(within(screen.getByRole('group', { name: 'Materia' })).getByRole('button', { name: 'Diritto penale' }));
      expect(container.querySelector('canvas')).toBe(canvas);
      await waitFor(() => expect(container.querySelector('canvas')).toBeNull(), { timeout: 3000 });
    });

    it('moves nothing under reduced motion: no canvas, the stamp at rest, the day still marked', async () => {
      const original = window.matchMedia;
      window.matchMedia = ((query: string) => ({
        matches: query.includes('reduce'), media: query, onchange: null, addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
      try {
        progress.mockResolvedValue(answer(0, 0, { ripassi: 12, raggiunto: true }, 5));
        const { container } = renderHome();
        await screen.findByTestId('goal-stamp');
        await waitFor(() => expect(container.querySelector('canvas')).toBeNull());
        expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
        expect(localStorage.getItem(CELEBRATED_KEY)).toBe('2026-10-19');
      } finally {
        window.matchMedia = original;
      }
    });

    it('shows no stamp before the goal', async () => {
      progress.mockResolvedValue(answer(3, 0));
      renderHome();
      await screen.findByText('Oggi: 3 da ripassare');
      expect(screen.queryByTestId('goal-stamp')).not.toBeInTheDocument();
    });
  });

  it('holds the study settings, closed, behind the gear of the strip', async () => {
    progress.mockResolvedValue(answer(1, 1));
    renderHome();
    expect(await screen.findByRole('button', { name: 'Impostazioni dello studio' })).toHaveAttribute('aria-expanded', 'false');
  });

  describe('«Oggi» (Gymnasium spec §5.1)', () => {
    it('keeps the reading order — missions, statistics, list, subjects — and from `xl` sets the statistics in a sticky column of their own (G6)', async () => {
      progress.mockResolvedValue(answer(18, 8));
      renderHome();
      const missions = await screen.findByRole('region', { name: 'Le missioni di oggi' });
      const stats = screen.getByRole('region', { name: 'I tuoi progressi' });
      const list = screen.getByRole('region', { name: 'Tutte le missioni' });
      const subjects = screen.getByRole('region', { name: 'Cosa ripassi' });
      const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      expect(follows(missions, stats) && follows(stats, list) && follows(list, subjects)).toBe(true);
      // The grid places them; the document keeps the order on every width.
      expect(stats.parentElement).toHaveClass('xl:col-start-2', 'xl:row-span-full', 'xl:sticky', 'xl:self-start');
      for (const left of [missions.parentElement!, list.parentElement!]) expect(left).toHaveClass('xl:col-start-1');
      expect(stats.parentElement?.parentElement?.className).toMatch(/xl:grid-cols-\[minmax\(0,7fr\)_minmax\(0,5fr\)\]/);
      // Below `xl` the chips follow the list, in the flow.
      expect(stats.parentElement).not.toContainElement(subjects);
    });

    it('draws «Cosa ripassi» under the statistics from `xl`, in their column, once (G6)', async () => {
      const real = window.matchMedia;
      window.matchMedia = ((query: string) => ({
        matches: query === '(min-width: 1280px)', media: query, onchange: null,
        addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
      try {
        progress.mockResolvedValue(answer(18, 8));
        renderHome();
        const stats = await screen.findByRole('region', { name: 'I tuoi progressi' });
        const subjects = screen.getAllByRole('region', { name: 'Cosa ripassi' });
        expect(subjects).toHaveLength(1);
        expect(stats.parentElement).toContainElement(subjects[0]);
        // In the document after the statistics, before the list.
        const list = screen.getByRole('region', { name: 'Tutte le missioni' });
        expect(subjects[0].compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      } finally {
        window.matchMedia = real;
      }
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
      expect(await screen.findByText('Oggi: 18 da ripassare, 8 nuove')).toBeInTheDocument();
      // ceil(26 × 20 / 60) = 9.
      expect(screen.getByText('circa 9 minuti')).toBeInTheDocument();
      // The one primary button of the page.
      expect(screen.getAllByRole('button', { name: /^(Inizia|Continua)$/ })).toHaveLength(1);
    });

    it('stamps the day and offers «Continua» once the goal is met with cards left', async () => {
      localStorage.setItem('visualex.studia.festeggiato', '2026-10-19');
      progress.mockResolvedValue(answer(4, 2, { ripassi: 12, raggiunto: true }, 5));
      renderHome();
      expect(await screen.findByRole('button', { name: 'Continua' })).toBeEnabled();
      expect(screen.getByTestId('goal-stamp')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Inizia' })).toBeNull();
      expect(screen.getByText('circa 2 minuti')).toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole('button', { name: 'Continua' }));
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
      expect(await screen.findByText('Le prossime schede: giovedì 22 ottobre.')).toBeInTheDocument();
      unmount();
      const none = answer(0, 0, { raggiunto: true });
      none.stati = { nuove: 0, apprendimento: 0, consolidate: 6 };
      none.prossimi = none.prossimi.map((day) => ({ ...day, schede: 0 }));
      progress.mockResolvedValue(none);
      renderHome();
      expect(await screen.findByText('Nessuna scheda in programma nei prossimi 14 giorni.')).toBeInTheDocument();
    });

    it('starts the session from «Inizia» when the progress cannot be read', async () => {
      progress.mockRejectedValue(new Error('down'));
      renderHome();
      expect(await screen.findByRole('alert')).toHaveTextContent('Non riesco a leggere i tuoi progressi.');
      expect(screen.getByText('Puoi ripassare lo stesso: il ripasso legge le sue schede.')).toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole('button', { name: 'Inizia' }));
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

    it('lets the band scroll with the page while the settings are open (G6)', async () => {
      progress.mockResolvedValue(answer(1, 1));
      renderHome();
      const user = userEvent.setup();
      const stats = await screen.findByRole('region', { name: 'I tuoi progressi' });
      expect(stats.parentElement).toHaveClass('xl:sticky');
      await user.click(screen.getByRole('button', { name: 'Impostazioni dello studio' }));
      expect(stats.parentElement).not.toHaveClass('xl:sticky');
    });

    it('says «Oggi» once over the action: no label above the sentence that starts with it', async () => {
      progress.mockResolvedValue(answer(12, 8));
      renderHome();
      const card = await screen.findByRole('region', { name: 'Le missioni di oggi' });
      expect(within(card).getByText('Oggi: 12 da ripassare, 8 nuove')).toBeInTheDocument();
      expect(within(card).getAllByRole('heading').map((h) => h.textContent)).toEqual(['Le missioni di oggi']);
      expect(within(card).queryByText(/^oggi$/i)).toBeNull();
    });

    it('draws the streak and the goal, small, in the statistics', async () => {
      progress.mockResolvedValue(answer(3, 0));
      renderHome();
      expect(await screen.findByRole('img', { name: 'Obiettivo di oggi: 6 di 10 ripassi' })).toHaveTextContent('6 di 10');
      expect(screen.getByRole('img', { name: 'Serie: 4 giorni di fila, record 9' })).toHaveTextContent('4');
    });

    it('draws one stop a subject, by the cards still open, and «Ripassa» starts a session on it', async () => {
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
      const road = await screen.findByRole('list', { name: 'Il percorso' });
      const stops = within(road).getAllByRole('listitem');
      expect(stops.map((li) => li.querySelector('p')?.textContent)).toEqual([
        'Diritto penale', 'Diritto civile', 'Diritto processuale civile', 'Diritto amministrativo', 'Diritto processuale penale',
      ]);
      expect(stops[1]).toHaveTextContent('0 nuove · 2 in apprendimento · 400 consolidate');
      expect(stops[1]).toHaveTextContent('210 ripassi negli ultimi 30 giorni');
      // A subject with no card has nothing to start.
      expect(stops[3]).toHaveTextContent('Nessuna scheda, per ora.');
      expect(within(stops[3]).queryByRole('button')).toBeNull();
      await userEvent.setup().click(within(stops[0]).getByRole('button', { name: 'Ripassa Diritto penale' }));
      expect(screen.getByTestId('where')).toHaveTextContent('/studia/ripasso/sessione?materia=DIRITTO_PENALE');
    });

    it('lays the page in the order fixed: the missions, the statistics, the full list, then the chips and the road', async () => {
      progress.mockResolvedValue(answer(3, 0));
      renderHome();
      const order = ['Le missioni di oggi', 'I tuoi progressi', 'Tutte le missioni', 'Cosa ripassi', 'Il percorso'];
      const headings = await Promise.all(order.map((name) => screen.findByRole('heading', { name })));
      for (let i = 1; i < headings.length; i++) {
        expect(headings[i - 1].compareDocumentPosition(headings[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
      // One type language: no small capitals in the headings.
      for (const heading of headings) expect(heading.className).not.toMatch(/small-caps/);
    });
  });

  describe('the institutes on the road (Gymnasium spec §5.2, G5)', () => {
    const tappa = (materia: TappaIstituto['materia'], istituto: string, dovute: number): TappaIstituto => ({
      materia, istituto, nuove: 1, apprendimento: dovute, consolidate: 0, dovute,
    });
    const road = () => screen.findByRole('list', { name: 'Il percorso' });
    const stopOf = async (label: string) =>
      within(await road()).getAllByRole('listitem').find((li) => li.querySelector('p')?.textContent === label)!;

    it('reads the road by institute once, for every subject, and says each subject’s cards due', async () => {
      progress.mockResolvedValue(answer(7, 0));
      percorso.mockResolvedValue([
        tappa('DIRITTO_CIVILE', 'Risoluzione per inadempimento', 3),
        tappa('DIRITTO_CIVILE', 'Mora del debitore', 4),
        tappa('DIRITTO_PENALE', 'Furto', 0),
      ]);
      renderHome();
      const civile = await stopOf('Diritto civile');
      expect(await within(civile).findByText('7 da ripassare')).toBeInTheDocument();
      expect(await stopOf('Diritto penale')).toHaveTextContent('Niente da ripassare');
      expect(percorso).toHaveBeenCalledTimes(1);
      expect(percorso).toHaveBeenCalledWith();
    });

    it('opens a subject on its institutes, and a tap starts the session narrowed to one', async () => {
      progress.mockResolvedValue(answer(7, 0));
      percorso.mockResolvedValue([
        tappa('DIRITTO_CIVILE', 'Risoluzione per inadempimento', 3),
        tappa('DIRITTO_CIVILE', 'Mora del debitore', 4),
        tappa('DIRITTO_PENALE', 'Furto', 2),
      ]);
      renderHome();
      const civile = await stopOf('Diritto civile');
      const toggle = await within(civile).findByRole('button', { name: 'Istituti di Diritto civile (2)' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('list', { name: 'Istituti di Diritto civile' })).toBeNull();
      const user = userEvent.setup();
      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const institutes = screen.getByRole('list', { name: 'Istituti di Diritto civile' });
      expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toContainElement(institutes);
      expect(within(institutes).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
        'Ripassa Mora del debitore: 4 da ripassare',
        'Ripassa Risoluzione per inadempimento: 3 da ripassare',
      ]);
      await user.click(within(institutes).getByRole('button', { name: /Risoluzione per inadempimento/ }));
      expect(screen.getByTestId('where')).toHaveTextContent('/studia/ripasso/sessione?materia=DIRITTO_CIVILE&istituto=Risoluzione+per+inadempimento');
    });

    it('opens the subject the chips chose on its institutes', async () => {
      localStorage.setItem(STORAGE_KEY, 'DIRITTO_PENALE');
      progress.mockResolvedValue(answer(2, 0));
      percorso.mockResolvedValue([tappa('DIRITTO_PENALE', 'Furto', 2), tappa('DIRITTO_CIVILE', 'Mora del debitore', 1)]);
      renderHome();
      expect(await screen.findByRole('list', { name: 'Istituti di Diritto penale' })).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Istituti di Diritto civile' })).toBeNull();
    });

    it('opens a subject chosen later on its institutes, and leaves open what the reader opened', async () => {
      progress.mockResolvedValue(answer(3, 0));
      percorso.mockResolvedValue([tappa('DIRITTO_PENALE', 'Furto', 2), tappa('DIRITTO_CIVILE', 'Mora del debitore', 1)]);
      renderHome();
      const civile = await stopOf('Diritto civile');
      const user = userEvent.setup();
      await user.click(await within(civile).findByRole('button', { name: /^Istituti di Diritto civile/ }));
      expect(screen.queryByRole('list', { name: 'Istituti di Diritto penale' })).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Diritto penale' }));
      expect(await screen.findByRole('list', { name: 'Istituti di Diritto penale' })).toBeInTheDocument();
      expect(screen.getByRole('list', { name: 'Istituti di Diritto civile' })).toBeInTheDocument();
    });

    it('holds the cards due in place while the read travels, and the missions do not wait on it', async () => {
      progress.mockResolvedValue(answer(3, 0));
      percorso.mockReturnValue(new Promise(() => {}));
      renderHome();
      expect(await screen.findByRole('button', { name: 'Inizia' })).toBeEnabled();
      const stops = await road();
      expect(stops.querySelectorAll('.motion-safe\\:animate-pulse').length).toBeGreaterThan(0);
      expect(within(stops).queryByText(/da ripassare$/)).toBeNull();
    });

    it('keeps «Inizia» and the subjects when the read fails, and reads it again on request', async () => {
      progress.mockResolvedValue(answer(3, 0));
      percorso.mockRejectedValueOnce(new Error('down'));
      renderHome();
      const civile = await stopOf('Diritto civile');
      expect(screen.getByRole('button', { name: 'Inizia' })).toBeEnabled();
      expect(within(civile).getByRole('button', { name: 'Ripassa Diritto civile' })).toBeEnabled();
      // No alert of its own: the line of the cards due is left out, and the institutes say it when opened.
      expect(screen.queryByRole('alert')).toBeNull();
      expect(civile).not.toHaveTextContent('da ripassare');
      const user = userEvent.setup();
      await user.click(within(civile).getByRole('button', { name: 'Istituti di Diritto civile' }));
      expect(screen.getByText('Non riesco a leggere gli istituti di questa materia.')).toBeInTheDocument();
      percorso.mockResolvedValue([tappa('DIRITTO_CIVILE', 'Mora del debitore', 1)]);
      await user.click(screen.getByRole('button', { name: 'Riprova gli istituti di Diritto civile' }));
      expect(await screen.findByRole('button', { name: 'Ripassa Mora del debitore: 1 da ripassare' })).toBeInTheDocument();
      expect(percorso).toHaveBeenCalledTimes(2);
    });

    it('reads the institutes again with the missions’ «Riprova» and after a setting changed', async () => {
      progress.mockRejectedValueOnce(new Error('down'));
      renderHome();
      const alert = await screen.findByRole('alert');
      progress.mockResolvedValue(answer(3, 0));
      const user = userEvent.setup();
      await user.click(within(alert).getByRole('button', { name: 'Riprova' }));
      await road();
      expect(percorso).toHaveBeenCalledTimes(2);
      await user.click(screen.getByRole('button', { name: 'Impostazioni dello studio' }));
      savePreferences.mockResolvedValue({ nuoveAlGiorno: 20, ripassiAlGiorno: 10, materieComunita: ['DIRITTO_CIVILE'] });
      await user.click(await screen.findByRole('button', { name: /^Schede della comunità · / }));
      await user.click(screen.getByRole('switch', { name: 'Diritto civile' }));
      await waitFor(() => expect(percorso).toHaveBeenCalledTimes(3));
    });

    it('offers no institutes for a subject with no card', async () => {
      const data = answer(0, 0);
      data.materie[2] = { materia: 'DIRITTO_AMMINISTRATIVO', nuove: 0, apprendimento: 0, consolidate: 0, ripassi30: 0 };
      progress.mockResolvedValue(data);
      renderHome();
      const amministrativo = await stopOf('Diritto amministrativo');
      expect(amministrativo).toHaveTextContent('Nessuna scheda, per ora.');
      expect(within(amministrativo).queryByRole('button')).toBeNull();
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

    it('gives the three of the day with their counts and «2 di 3», «Inizia» on the first', async () => {
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
      // Past the goal the count stops at it; the ring keeps the real count.
      expect(rows[2]).toHaveTextContent('10 di 10');
      // Each with its points, earned ones in ink with a «+» (G1c), said in words.
      expect(rows[0]).toHaveTextContent('20 XP');
      expect(rows[0]).toHaveTextContent('vale 20 punti');
      expect(rows[2]).toHaveTextContent('+10 XP');
      expect(rows[2]).toHaveTextContent('10 punti guadagnati');
      expect(screen.getByRole('img', { name: 'Obiettivo di oggi: 11 di 10 ripassi, raggiunto' })).toBeInTheDocument();
      expect(rows[2]).toHaveTextContent('compiuta');
      expect(within(card).getByText('1 di 3')).toBeInTheDocument();
      expect(within(rows[0]).getByRole('button', { name: 'Continua' })).toBeInTheDocument();
      expect(within(rows[2]).getByTestId('goal-stamp')).toBeInTheDocument();
      localStorage.removeItem('visualex.studia.festeggiato');
    });

    it('opens the study settings from a mission, which sets its target, and takes the focus there (G6)', async () => {
      progress.mockResolvedValue(midDay());
      renderHome();
      const user = userEvent.setup();
      const goal = await screen.findByRole('button', { name: 'Cambia l’obiettivo' });
      expect(goal).toHaveAttribute('aria-controls', 'studia-impostazioni');
      await user.click(goal);
      const panel = screen.getByRole('region', { name: 'Impostazioni dello studio' });
      await waitFor(() => expect(panel).toHaveFocus());
      expect(screen.getByRole('button', { name: 'Impostazioni dello studio' })).toHaveAttribute('aria-expanded', 'true');
      expect(screen.queryByRole('dialog')).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Cambia le nuove al giorno' }));
      expect(screen.getByRole('region', { name: 'Impostazioni dello studio' })).toBeInTheDocument();
    });

    it('says when a mission has nothing to do today, offers the community cards, and leaves it out of the summary', async () => {
      const data = answer(4, 0, { ripassi: 3 });
      data.missioni = serverMissions({ nuove: { stato: 'vuota', progresso: undefined } });
      progress.mockResolvedValue(data);
      renderHome();
      const card = await screen.findByRole('region', { name: 'Le missioni di oggi' });
      expect(within(card).getByText('Nessuna scheda nuova da imparare oggi.')).toBeInTheDocument();
      expect(within(card).getByRole('button', { name: 'Accendi le schede della comunità' })).toBeInTheDocument();
      expect(within(card).getByText('0 di 2')).toBeInTheDocument();
      // It opens the settings at the community's subjects, already open (G6).
      await userEvent.setup().click(within(card).getByRole('button', { name: 'Accendi le schede della comunità' }));
      const panel = screen.getByRole('region', { name: 'Impostazioni dello studio' });
      expect(await within(panel).findByRole('button', { name: 'Schede della comunità · 0 di 5' })).toHaveAttribute('aria-expanded', 'true');
      expect(within(panel).getAllByRole('switch')).toHaveLength(5);
    });

    it('says that the daily quota stops «Impara 5», and offers to change it (L-27 choice 5)', async () => {
      const data = midDay();
      data.missioni = serverMissions({ nuove: { motivo: 'quota', progresso: { fatte: 1, di: 5 } } });
      progress.mockResolvedValue(data);
      renderHome();
      const row = (await screen.findByRole('list', { name: 'Missioni di oggi' })).querySelector('[data-missione="nuove"]') as HTMLElement;
      expect(row).toHaveTextContent('Le nuove al giorno che hai scelto non bastano: alzale per arrivare a 5.');
      expect(within(row).getByRole('button', { name: 'Cambia le nuove al giorno' })).toBeInTheDocument();
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
      await screen.findByText('Oggi: 5 da ripassare, 5 nuove');
      const user = userEvent.setup();
      const chips = screen.getByRole('group', { name: 'Materia' });
      progress.mockResolvedValue(answer(2, 3));
      await user.click(within(chips).getByRole('button', { name: 'Diritto penale' }));
      await screen.findByText('Oggi in Diritto penale: 2 da ripassare, 3 nuove');
      await user.click(within(chips).getByRole('button', { name: 'Tutte le materie' }));
      let answerCivile: (value: Progressi) => void = () => {};
      progress.mockImplementation(() => new Promise((resolve) => { answerCivile = resolve; }));
      await user.click(within(chips).getByRole('button', { name: 'Diritto civile' }));
      // Penale's answer is not drawn under Civile's name: the action waits, «Inizia» with it.
      expect(screen.queryByText(/^Oggi in Diritto civile/)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Inizia' })).toBeNull();
      answerCivile(answer(7, 1));
      expect(await screen.findByText('Oggi in Diritto civile: 7 da ripassare, 1 nuova')).toBeInTheDocument();
    });

    it('says so inside the first mission when the subject’s read fails, and keeps «Inizia»', async () => {
      progress.mockResolvedValue(answer(5, 5));
      renderHome();
      await screen.findByText('Oggi: 5 da ripassare, 5 nuove');
      progress.mockRejectedValue(new Error('down'));
      await userEvent.setup().click(within(screen.getByRole('group', { name: 'Materia' })).getByRole('button', { name: 'Diritto penale' }));
      const alert = await screen.findByRole('alert');
      expect(alert.closest('li')).toHaveAttribute('data-missione', 'dovute');
      expect(screen.getByRole('button', { name: 'Inizia' })).toBeEnabled();
      // The missions above are the day's, still drawn.
      expect(screen.getByRole('list', { name: 'Missioni di oggi' })).toBeInTheDocument();
    });

    it('keeps the missions the whole day’s when a subject narrows the action', async () => {
      progress.mockResolvedValue(midDay());
      renderHome();
      const card = await screen.findByRole('region', { name: 'Le missioni di oggi' });
      progress.mockResolvedValue(answer(2, 5, { ripassi: 9 }));
      await userEvent.setup().click(within(screen.getByRole('group', { name: 'Materia' })).getByRole('button', { name: 'Diritto penale' }));
      expect(await within(card).findByText('Oggi in Diritto penale: 2 da ripassare, 5 nuove')).toBeInTheDocument();
      expect(within(card).getAllByRole('listitem')[0]).toHaveTextContent('7 di 17');
    });
  });

  describe('the statistics (Gymnasium spec §5.1)', () => {
    it('leaves the subject chosen for «Progressi» to open on: one choice for the area', async () => {
      progress.mockResolvedValue(answer(5, 5));
      renderHome();
      await screen.findByText('Oggi: 5 da ripassare, 5 nuove');
      progress.mockResolvedValue(answer(2, 3));
      await userEvent.setup().click(within(screen.getByRole('group', { name: 'Materia' })).getByRole('button', { name: 'Diritto penale' }));
      await screen.findByText('Oggi in Diritto penale: 2 da ripassare, 3 nuove');
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
    it('lists the day, the week and the long run as the server decides them; only «caso» is «In arrivo» (G1c)', async () => {
      const data = answer(3, 0);
      data.missioni = serverMissions({ 'materia-ferma': { stato: 'aperta', progresso: { fatte: 2, di: 5 }, materia: 'DIRITTO_PENALE' } });
      progress.mockResolvedValue(data);
      renderHome();
      const list = await screen.findByRole('region', { name: 'Tutte le missioni' });
      for (const group of ['Giornaliere', 'Settimanali', 'A lungo termine']) {
        expect(within(list).getByRole('heading', { name: group })).toBeInTheDocument();
      }
      const coming = within(list).getAllByText('In arrivo', { selector: 'span' });
      expect(coming).toHaveLength(1);
      expect(coming[0].closest('li')).toHaveAttribute('data-missione', 'caso');
      // A mission still to come shows no points: it cannot be earned.
      expect(coming[0].closest('li')).not.toHaveTextContent('XP');
      expect(within(list).getByText('Proponi una scheda')).toBeInTheDocument();
      expect(within(list).getByText('Una settimana di serie')).toBeInTheDocument();
      expect(within(list).getByText('Consolida 50 schede')).toBeInTheDocument();
      const stale = list.querySelector('[data-missione="materia-ferma"]') as HTMLElement;
      expect(stale).toHaveTextContent('2 di 5');
      expect(stale).toHaveTextContent('Diritto penale');
      expect(stale).toHaveTextContent('15 XP');
      expect(list.querySelector('[data-missione="settimana"]')).toHaveTextContent('3 di 7');
      // «caso» aside, a `vuota` keeps what it counted beside «Niente oggi».
      expect(list.querySelector('[data-missione="materia-ferma"]')).not.toHaveTextContent('Niente oggi');
      expect(list.querySelector('[data-missione="consolida"]')).toHaveTextContent('100 XP');
      // Today's three are above, in «Le missioni di oggi», and only there (G6).
      expect(within(list).getByText(/Le tre di oggi sono qui sopra/)).toBeInTheDocument();
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

describe('the motions of «Oggi» (S2)', () => {
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

  it('draws the new tally mark and lands the count only for what grew since this browser drew it', async () => {
    localStorage.setItem(SEEN, JSON.stringify({ serie: 3, giorno: '2026-10-19', ripassi: 7, missioni: [] }));
    progress.mockResolvedValue(answer(10, 8, { ripassi: 9 }, 4));
    const { unmount } = renderHome();
    const tally = await screen.findByTestId('streak-tally');
    expect(tally).toHaveAttribute('data-marks', '4');
    const ring = within(screen.getByRole('img', { name: /^Obiettivo di oggi: 9 di 10/ }));
    const landing = ring.getByTestId('goal-count-landing');
    expect(landing).toHaveClass('vlx-digit-land', 'absolute');
    // Its place is held at the final weight, unseen, so « di 10» does not move while it lands.
    const [held] = ring.getAllByText('9').filter((el) => el !== landing);
    expect(held).toHaveClass('invisible', 'font-semibold');
    unmount();

    // Seen now: the next visit draws them at rest.
    renderHome();
    const again = within(await screen.findByRole('img', { name: /^Obiettivo di oggi: 9 di 10/ }));
    expect(again.getByText('9')).not.toHaveClass('vlx-digit-land');
    expect(again.queryByTestId('goal-count-landing')).toBeNull();
  });
});
