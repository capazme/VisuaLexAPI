import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Progressi } from '../../../types/studia';

vi.mock('../../../services/studiaService', () => ({
  studiaService: { progress: vi.fn(), preferences: vi.fn(), savePreferences: vi.fn() },
}));

import { studiaService } from '../../../services/studiaService';
import { ReviewHome } from './ReviewHome';

const progress = vi.mocked(studiaService.progress);
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
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  progress.mockReset();
  preferences.mockReset();
  savePreferences.mockReset();
  preferences.mockResolvedValue({ nuoveAlGiorno: 20, ripassiAlGiorno: 10, materieComunita: [] });
  localStorage.removeItem(STORAGE_KEY);
  // jsdom draws nothing: a celebration's burst ends at once, as it does without a canvas.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  localStorage.removeItem(STORAGE_KEY);
  vi.restoreAllMocks();
});

describe('ReviewHome', () => {
  it('says what is on today, how far the goal is, and offers to start', async () => {
    progress.mockResolvedValue(answer(18, 20));
    renderHome();
    expect(await screen.findByText('Oggi: 18 da ripassare · 20 nuove')).toBeInTheDocument();
    expect(progress).toHaveBeenCalledWith(undefined);
    expect(screen.getByRole('img', { name: 'Obiettivo di oggi: 6 di 10 ripassi' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Serie: 4 giorni di fila, record 9' })).toBeInTheDocument();
    expect(screen.getByText('Ancora 4 ripassi per tenere viva la serie.')).toBeInTheDocument();
    const start = screen.getByRole('button', { name: 'Inizia il ripasso' });
    expect(start).toBeEnabled();
    await userEvent.setup().click(start);
    expect(screen.getByTestId('where')).toHaveTextContent('/studia/ripasso/sessione');
    expect(screen.getByTestId('where').textContent).not.toContain('materia');
  });

  it('draws the panels: the calendar, the cards by state, the coming days, the subjects', async () => {
    progress.mockResolvedValue(answer(3, 0));
    renderHome();
    for (const heading of ['Attività', 'Schede per stato', 'Prossimi 14 giorni', 'Per materia']) {
      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    }
    expect(screen.getByText('10 schede · 20% consolidate')).toBeInTheDocument();
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
    await screen.findByText('Oggi: 18 da ripassare · 20 nuove');
    const chips = screen.getByRole('group', { name: 'Materia' });
    expect(within(chips).getByRole('button', { name: 'Tutte le materie' })).toHaveAttribute('aria-pressed', 'true');

    progress.mockResolvedValue(answer(2, 5));
    await userEvent.setup().click(within(chips).getByRole('button', { name: 'Diritto penale' }));
    expect(await screen.findByText('Oggi: 2 da ripassare · 5 nuove')).toBeInTheDocument();
    expect(progress).toHaveBeenLastCalledWith('DIRITTO_PENALE');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('DIRITTO_PENALE');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Inizia il ripasso' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/studia/ripasso/sessione?materia=DIRITTO_PENALE');
    unmount();

    renderHome();
    await screen.findByText('Oggi: 2 da ripassare · 5 nuove');
    expect(progress).toHaveBeenLastCalledWith('DIRITTO_PENALE');
  });

  it('ignores a remembered value that is not a subject', async () => {
    localStorage.setItem(STORAGE_KEY, 'DIRITTO_ALIENO');
    progress.mockResolvedValue(answer(1, 1));
    renderHome();
    await screen.findByText('Oggi: 1 da ripassare · 1 nuove');
    expect(progress).toHaveBeenCalledWith(undefined);
  });

  it('does not offer a start when nothing is due and nothing is new', async () => {
    progress.mockResolvedValue(answer(0, 0, { raggiunto: true }));
    renderHome();
    expect(await screen.findByText('Per oggi hai finito. Le prossime schede tornano domani.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inizia il ripasso' })).toBeDisabled();
  });

  it('starts with new cards alone', async () => {
    progress.mockResolvedValue(answer(0, 7));
    renderHome();
    await screen.findByText('Oggi: 0 da ripassare · 7 nuove');
    expect(screen.getByRole('button', { name: 'Inizia il ripasso' })).toBeEnabled();
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
    await screen.findByText('Oggi: 5 da ripassare · 5 nuove');
    progress.mockResolvedValue(answer(0, 0, { ripassi: 2 }));
    await userEvent.setup().click(within(screen.getByRole('group', { name: 'Materia' })).getByRole('button', { name: 'Diritto penale' }));
    expect(await screen.findByText('Niente da ripassare in questa materia, per oggi.')).toBeInTheDocument();
    expect(screen.getByText('Ancora 8 ripassi per tenere viva la serie.')).toBeInTheDocument();
  });

  it('holds the panels’ places while the first read travels, and stops pulsing when it fails', async () => {
    let fail: (reason: unknown) => void = () => {};
    progress.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    const { container } = renderHome();
    expect(screen.getByText('Carico i tuoi progressi…')).toBeInTheDocument();
    expect(container.querySelectorAll('.motion-safe\\:animate-pulse').length).toBeGreaterThan(2);
    fail(new Error('down'));
    expect(await screen.findByText('I tuoi progressi non sono disponibili, per ora.')).toBeInTheDocument();
    expect(container.querySelectorAll('.motion-safe\\:animate-pulse')).toHaveLength(0);
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('tells someone with no card yet where to begin', async () => {
    const empty = answer(0, 0, { ripassi: 0 }, 0);
    empty.stati = { nuove: 0, apprendimento: 0, consolidate: 0 };
    progress.mockResolvedValue(empty);
    renderHome();
    expect(await screen.findByText('Non hai ancora schede da ripassare.')).toBeInTheDocument();
    expect(screen.getByText(/Scrivi una scheda da «Le mie schede»/)).toBeInTheDocument();
  });

  it('says so, keeps the start usable, and reads again on request, when the progress cannot be read', async () => {
    progress.mockRejectedValueOnce(new Error('down'));
    renderHome();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Non riesco a leggere i tuoi progressi.');
    expect(screen.getByRole('button', { name: 'Inizia il ripasso' })).toBeEnabled();
    progress.mockResolvedValue(answer(1, 0));
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText('Oggi: 1 da ripassare · 0 nuove')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('reads again after a setting changed', async () => {
    progress.mockResolvedValue(answer(3, 0));
    renderHome();
    await screen.findByText('Oggi: 3 da ripassare · 0 nuove');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Impostazioni dello studio' }));
    progress.mockResolvedValue(answer(3, 12));
    savePreferences.mockResolvedValue({ nuoveAlGiorno: 20, ripassiAlGiorno: 10, materieComunita: ['DIRITTO_CIVILE'] });
    await user.click(await screen.findByRole('switch', { name: 'Diritto civile' }));
    expect(savePreferences).toHaveBeenCalledWith({ materieComunita: ['DIRITTO_CIVILE'] });
    expect(await screen.findByText('Oggi: 3 da ripassare · 12 nuove')).toBeInTheDocument();
    expect(progress).toHaveBeenCalledTimes(2);
  });

  it('never lets a slow answer for a subject chosen before overwrite the one that came after', async () => {
    const pending: Array<(value: Progressi) => void> = [];
    progress.mockResolvedValueOnce(answer(1, 1));
    renderHome();
    await screen.findByText('Oggi: 1 da ripassare · 1 nuove');
    progress.mockImplementation(() => new Promise((resolve) => { pending.push(resolve); }));
    const user = userEvent.setup();
    const chips = screen.getByRole('group', { name: 'Materia' });
    await user.click(within(chips).getByRole('button', { name: 'Diritto penale' }));
    await user.click(within(chips).getByRole('button', { name: 'Diritto civile' }));
    expect(pending).toHaveLength(2);
    // The newer request answers first, the older one after.
    pending[1](answer(7, 7));
    expect(await screen.findByText('Oggi: 7 da ripassare · 7 nuove')).toBeInTheDocument();
    pending[0](answer(9, 9));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText('Oggi: 7 da ripassare · 7 nuove')).toBeInTheDocument();
    expect(screen.queryByText('Oggi: 9 da ripassare · 9 nuove')).not.toBeInTheDocument();
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
      expect(localStorage.getItem(CELEBRATED_KEY)).toBe('2026-10-19');
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
      await screen.findByText('Oggi: 3 da ripassare · 0 nuove');
      expect(screen.queryByTestId('goal-stamp')).not.toBeInTheDocument();
    });
  });

  it('holds the study settings, closed, at the bottom', async () => {
    progress.mockResolvedValue(answer(1, 1));
    renderHome();
    expect(await screen.findByRole('button', { name: 'Impostazioni dello studio' })).toHaveAttribute('aria-expanded', 'false');
  });
});
