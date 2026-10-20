import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Materia, Progressi } from '../../../../types/studia';

vi.mock('../../../../services/studiaService', () => ({ studiaService: { progress: vi.fn() } }));
const desktop = vi.hoisted(() => ({ value: true }));
vi.mock('../../../../hooks/useIsDesktop', () => ({ useIsDesktop: () => desktop.value }));

import { studiaService } from '../../../../services/studiaService';
import { ProgressPage } from './ProgressPage';

const progress = vi.mocked(studiaService.progress);
const STORAGE_KEY = 'visualex.studia.ripasso.materia';
const SUBJECTS: Materia[] = ['DIRITTO_CIVILE', 'DIRITTO_PENALE', 'DIRITTO_AMMINISTRATIVO', 'DIRITTO_PROCESSUALE_CIVILE', 'DIRITTO_PROCESSUALE_PENALE'];

/** A progress answer: some history, or none at all for a newcomer. */
function answer(over: { reviews?: number; newcomer?: boolean; stati?: Progressi['stati'] } = {}): Progressi {
  const newcomer = over.newcomer ?? false;
  return {
    oggi: { giorno: '2026-10-19', ripassi: newcomer ? 0 : 6, obiettivo: 10, raggiunto: false, dovute: newcomer ? 0 : 4, nuove: 0 },
    serie: {
      attuale: newcomer ? 0 : 13,
      record: newcomer ? 0 : 27,
      ultimiGiorni: ['13', '14', '15', '16', '17', '18', '19'].map((d, i) => ({ giorno: `2026-10-${d}`, stato: i === 6 ? 'oggi' : newcomer ? 'saltato' : 'fatto' })),
    },
    stati: over.stati ?? (newcomer ? { nuove: 0, apprendimento: 0, consolidate: 0 } : { nuove: 3, apprendimento: 5, consolidate: 2 }),
    materie: SUBJECTS.map((materia, i) => ({ materia, nuove: 0, apprendimento: newcomer ? 0 : i, consolidate: 0, ripassi30: newcomer ? 0 : 100 * i })),
    calendario: newcomer ? [] : [{ giorno: '2026-10-12', ripassi: over.reviews ?? 14, nuove: 0, sbagliate: 0, valido: true, riposo: false }],
    prossimi: Array.from({ length: 14 }, (_, i) => ({ giorno: `2026-10-${19 + i}`, schede: newcomer ? 0 : i + 1 })),
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/studia/progressi']}>
      <ProgressPage />
    </MemoryRouter>,
  );
}

const calendar = () => screen.getByRole('group', { name: /^Calendario dei ripassi/ });

beforeEach(() => {
  progress.mockReset();
  desktop.value = true;
  localStorage.removeItem(STORAGE_KEY);
});
afterEach(() => localStorage.removeItem(STORAGE_KEY));

describe('ProgressPage (Gymnasium spec §5.3)', () => {
  it('reads the progress once, and draws the summary and the four blocks in order, one column', async () => {
    progress.mockResolvedValue(answer());
    renderPage();
    expect(screen.getByRole('heading', { level: 2, name: 'I tuoi progressi' })).toBeInTheDocument();
    const summary = await screen.findByRole('region', { name: 'Riepilogo' });
    expect(within(summary).getByRole('img', { name: 'Serie: 13 giorni di fila, record 27' })).toBeInTheDocument();
    expect(within(summary).getByRole('img', { name: 'Obiettivo di oggi: 6 di 10 ripassi' })).toBeInTheDocument();
    // 0 + 100 + 200 + 300 + 400, every subject's reviews of the last 30 days.
    expect(summary).toHaveTextContent('1000ripassi negli ultimi 30 giorni');
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Il tuo calendario', 'Le schede per stato', 'I prossimi 14 giorni', 'Per materia']);
    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith(undefined);
    // No points and no level: the server will keep them.
    expect(document.body.textContent).not.toMatch(/punti|livello|\bXP\b/i);
  });

  it('spans 26 weeks on a computer and 12 on a phone', async () => {
    progress.mockResolvedValue(answer());
    const { unmount } = renderPage();
    await screen.findByRole('region', { name: 'Riepilogo' });
    expect(calendar()).toHaveAccessibleName(/^Calendario dei ripassi dal 27 aprile 2026 a oggi/);
    unmount();
    desktop.value = false;
    renderPage();
    await screen.findByRole('region', { name: 'Riepilogo' });
    expect(calendar()).toHaveAccessibleName(/^Calendario dei ripassi dal 3 agosto 2026 a oggi/);
  });

  it('greets a newcomer: the first day begins today, nothing missed, nothing counted before it', async () => {
    progress.mockResolvedValue(answer({ newcomer: true }));
    const { container } = renderPage();
    expect(await screen.findByText('Il primo giorno comincia oggi')).toBeInTheDocument();
    expect(screen.getByText('Il primo giorno comincia oggi: qui si segnano i giorni in cui ripassi.')).toBeInTheDocument();
    expect(calendar()).toHaveAccessibleName('Calendario dei ripassi dal 27 aprile 2026 a oggi: ancora nessun ripasso');
    expect(container.querySelectorAll('[data-stato="saltato"]')).toHaveLength(0);
    expect(screen.getByText('Nessuna scheda da studiare, per ora.')).toBeInTheDocument();
    expect(screen.getAllByText('Nessuna scheda')).toHaveLength(5);
  });

  it('greets nobody as new who has a record: back after more than 26 weeks', async () => {
    progress.mockResolvedValue({ ...answer({ newcomer: true }), serie: { ...answer({ newcomer: true }).serie, record: 12 } });
    renderPage();
    await screen.findByRole('region', { name: 'Riepilogo' });
    expect(screen.queryByText(/^Il primo giorno comincia oggi: qui/)).toBeNull();
  });

  it('never shows a subject\'s answer under another, and dims the subject\'s blocks while it reads again', async () => {
    let settle: (value: Progressi) => void = () => {};
    progress.mockImplementation((materia?: Materia) =>
      materia === 'DIRITTO_CIVILE' ? new Promise((resolve) => (settle = resolve)) : Promise.resolve(answer({ reviews: materia ? 3 : 14 })),
    );
    renderPage();
    await screen.findByRole('group', { name: /: 14 ripassi in 1 giorno$/ });
    const user = userEvent.setup();
    const chips = screen.getByRole('group', { name: 'Materia' });
    await user.click(within(chips).getByRole('button', { name: 'Diritto penale' }));
    await screen.findByRole('group', { name: /: 3 ripassi in 1 giorno$/ });
    // To another subject: its places, not the last subject's numbers.
    await user.click(within(chips).getByRole('button', { name: 'Diritto civile' }));
    expect(screen.queryByRole('group', { name: /Calendario dei ripassi/ })).toBeNull();
    expect(screen.queryByRole('group', { name: /Schede da ripassare/ })).toBeNull();
    settle(answer({ reviews: 7 }));
    expect(await screen.findByRole('group', { name: /: 7 ripassi in 1 giorno$/ })).toBeInTheDocument();
    // A read again of what is on screen (a subject's read failed, «Riprova», then «Tutte le materie» while the day's
    // read travels): the day's last answer stays in the subject's blocks, dimmed.
    progress.mockImplementation((materia?: Materia) => (materia ? Promise.reject({ status: 503 }) : Promise.resolve(answer())));
    await user.click(within(chips).getByRole('button', { name: 'Diritto penale' }));
    const retry = await screen.findByRole('button', { name: 'Riprova' });
    progress.mockImplementation(() => new Promise(() => {}));
    await user.click(retry);
    await user.click(within(chips).getByRole('button', { name: 'Tutte le materie' }));
    for (const name of ['Il tuo calendario', 'Le schede per stato', 'I prossimi 14 giorni']) {
      const block = screen.getByRole('region', { name });
      expect(block).toHaveAttribute('aria-busy', 'true');
      expect(block.querySelector('.opacity-60')).not.toBeNull();
    }
    expect(screen.getByRole('group', { name: /: 14 ripassi in 1 giorno$/ })).toBeInTheDocument();
  });

  it('holds every block at its final size while the first read travels', () => {
    progress.mockReturnValue(new Promise(() => {}));
    renderPage();
    const summary = screen.getByRole('region', { name: 'Riepilogo' });
    expect(summary).toHaveAttribute('aria-busy', 'true');
    for (const name of ['Il tuo calendario', 'Le schede per stato', 'I prossimi 14 giorni', 'Per materia']) {
      expect(screen.getByRole('region', { name })).toHaveAttribute('aria-busy', 'true');
    }
    expect(screen.queryByRole('group', { name: /Calendario dei ripassi/ })).toBeNull();
    expect(document.querySelectorAll('.motion-safe\\:animate-pulse').length).toBeGreaterThan(4);
    // The calendar's place has the drawing's proportions: 22 + 26 weeks × 16 wide, 16 + 7 × 16 tall.
    expect(within(screen.getByRole('region', { name: 'Il tuo calendario' })).getByText('', { selector: '[style*="aspect-ratio"]' })).toHaveStyle({ aspectRatio: '438 / 128' });
  });

  it('says a failed read with «Riprova», no alert, and reads again', async () => {
    progress.mockRejectedValue({ status: 503 });
    renderPage();
    expect(await screen.findByText('Non riesco a leggere i tuoi progressi.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Riepilogo' })).toBeNull();
    progress.mockResolvedValue(answer());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByRole('region', { name: 'Riepilogo' })).toHaveTextContent('1000');
    expect(screen.queryByText('Non riesco a leggere i tuoi progressi.')).toBeNull();
  });

  it('keeps the last answer on screen, dimmed, while a new one comes, and keeps it when that one fails', async () => {
    // The subject «Oggi» left chosen: the day's read answers, the subject's fails.
    localStorage.setItem(STORAGE_KEY, 'DIRITTO_PENALE');
    progress.mockResolvedValueOnce(answer()).mockRejectedValueOnce({ status: 503 });
    renderPage();
    const retry = await screen.findByRole('button', { name: 'Riprova' });
    const summary = screen.getByRole('region', { name: 'Riepilogo' });
    expect(summary).toHaveTextContent('1000');
    // The subject's blocks say they could not be read; the whole day's stay.
    expect(within(screen.getByRole('region', { name: 'Il tuo calendario' })).getByText('I numeri tornano appena riesco a leggerli.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Per materia' })).getAllByRole('button')).toHaveLength(5);
    let failDay: (reason: unknown) => void = () => {};
    progress.mockReturnValueOnce(new Promise((_, reject) => (failDay = reject))).mockReturnValueOnce(new Promise(() => {}));
    await userEvent.setup().click(retry);
    expect(summary).toHaveAttribute('aria-busy', 'true');
    expect(summary).toHaveClass('opacity-60');
    expect(summary).toHaveTextContent('1000');
    failDay({ status: 503 });
    expect(await screen.findByText('Non riesco a leggere i tuoi progressi.')).toBeInTheDocument();
    expect(summary).toHaveTextContent('1000');
    expect(summary).not.toHaveClass('opacity-60');
  });

  it('narrows the calendar, the states and the coming days to the subject chosen, and remembers it for «Oggi» too', async () => {
    progress.mockImplementation(async (materia?: Materia) => (materia ? answer({ reviews: 3, stati: { nuove: 0, apprendimento: 1, consolidate: 0 } }) : answer()));
    renderPage();
    await screen.findByRole('group', { name: /: 14 ripassi in 1 giorno$/ });
    const user = userEvent.setup();
    await user.click(within(screen.getByRole('group', { name: 'Materia' })).getByRole('button', { name: 'Diritto penale' }));
    expect(progress).toHaveBeenLastCalledWith('DIRITTO_PENALE');
    expect(await screen.findByRole('group', { name: /: 3 ripassi in 1 giorno$/ })).toBeInTheDocument();
    expect(screen.getByText('Calendario, schede per stato e prossimi giorni: solo Diritto penale.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Le schede per stato' })).getByText('1 scheda · 0% consolidate')).toBeInTheDocument();
    // The summary and the list of subjects stay the whole day's.
    expect(screen.getByRole('region', { name: 'Riepilogo' })).toHaveTextContent('1000');
    expect(within(screen.getByRole('region', { name: 'Per materia' })).getAllByRole('button')).toHaveLength(5);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('DIRITTO_PENALE');
    // A subject in the list narrows the page the same way; pressed again, it clears.
    const penal = within(screen.getByRole('region', { name: 'Per materia' })).getByRole('button', { name: /Diritto penale/ });
    expect(penal).toHaveAttribute('aria-pressed', 'true');
    await user.click(penal);
    expect(await screen.findByRole('group', { name: /: 14 ripassi in 1 giorno$/ })).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('opens on the subject «Oggi» remembers', async () => {
    localStorage.setItem(STORAGE_KEY, 'DIRITTO_CIVILE');
    progress.mockResolvedValue(answer());
    renderPage();
    await screen.findByRole('region', { name: 'Riepilogo' });
    expect(progress).toHaveBeenCalledWith('DIRITTO_CIVILE');
    expect(within(screen.getByRole('group', { name: 'Materia' })).getByRole('button', { name: 'Diritto civile' })).toHaveAttribute('aria-pressed', 'true');
  });

  describe('the worst case (break-ui): what real data can do to the page', () => {
    /** A year of daily study with one outlier: a day of 9999 reviews, one of 500, a subject with no card, a record of 999. */
    function worst(): Progressi {
      const base = answer();
      return {
        ...base,
        oggi: { ...base.oggi, ripassi: 500, obiettivo: 10, raggiunto: true },
        serie: { ...base.serie, attuale: 365, record: 999 },
        stati: { nuove: 12345, apprendimento: 1, consolidate: 9999 },
        materie: base.materie.map((row, i) => (i === 1 ? { ...row, nuove: 0, apprendimento: 0, consolidate: 0, ripassi30: 0 } : { ...row, nuove: 3000, ripassi30: 3000 * i })),
        calendario: [
          { giorno: '2026-10-12', ripassi: 9999, nuove: 200, sbagliate: 1450, valido: true, riposo: false },
          { giorno: '2026-10-19', ripassi: 500, nuove: 200, sbagliate: 12, valido: true, riposo: false },
        ],
        prossimi: base.prossimi.map((d, i) => ({ ...d, schede: i === 0 ? 9999 : i === 5 ? 0 : 3 })),
      };
    }

    it('writes every number whole or grouped, never NaN or undefined, and keeps each block', async () => {
      progress.mockResolvedValue(worst());
      const { container } = renderPage();
      const summary = await screen.findByRole('region', { name: 'Riepilogo' });
      expect(within(summary).getByRole('img', { name: 'Serie: 365 giorni di fila, record 999' })).toBeInTheDocument();
      expect(within(summary).getByRole('img', { name: 'Obiettivo di oggi: 500 di 10 ripassi, raggiunto' })).toBeInTheDocument();
      // 3000 × (0 + 2 + 3 + 4), every subject's but the empty one.
      expect(summary).toHaveTextContent('27.000ripassi negli ultimi 30 giorni');
      expect(calendar()).toHaveAccessibleName(/: 10\.499 ripassi in 2 giorni$/);
      const states = screen.getByRole('region', { name: 'Le schede per stato' });
      expect(within(states).getAllByRole('definition').map((dd) => dd.textContent)).toEqual(['12.34555%', '1<1%', '999945%']);
      expect(within(states).getByText('22.345 schede · 45% consolidate')).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Schede da ripassare nei prossimi 14 giorni: 10.035 schede, 9999 schede oggi' })).toBeInTheDocument();
      const subjects = within(screen.getByRole('region', { name: 'Per materia' })).getAllByRole('button');
      // The subject with no card goes last, and says so.
      expect(subjects.at(-1)).toHaveTextContent(/^Diritto penaleNessuna schedaNessun ripasso negli ultimi 30 giorni$/);
      expect(document.body.textContent).not.toMatch(/NaN|undefined|Infinity/);
      // A segment of one card among 22.345 is still there to press.
      expect(within(states).getByRole('button', { name: 'In apprendimento: 1 scheda (<1%)' })).toHaveClass('min-w-3');
      expect(container.querySelectorAll('[data-empty]')).toHaveLength(1);
    });

    it('says the busiest day whole, aloud and in the line under the calendar', async () => {
      progress.mockResolvedValue(worst());
      const { container } = renderPage();
      await screen.findByRole('region', { name: 'Riepilogo' });
      fireEvent.click(container.querySelector('[data-day="2026-10-12"]')!);
      expect(screen.getByText('lunedì 12 ottobre: 9999 ripassi, 200 nuove, 1450 sbagliate, obiettivo raggiunto')).toBeInTheDocument();
    });
  });

  // Measured at 1366 px: the chips were 34–36 px and the bar's segments 28 px. As «Contribuisci» (`contribuisci.test.ts`),
  // no `md:` minimum or height but 44 px shrinks a target on a computer, in the files that draw this page's controls.
  it.each(['ProgressPage.tsx', 'SubjectChips.tsx', 'CardStatesBar.tsx', 'SubjectProgress.tsx'])('%s keeps its targets at 44 px from `md` up', (file) => {
    const source = readFileSync(join(resolve(process.cwd(), 'src/components/features/studia/progress'), file), 'utf8');
    expect(source).not.toMatch(/\bmd:(?:min-h|min-w|h)-(?!\[44px\])/);
  });
});
