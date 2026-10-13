import { describe, expect, it, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GiornoAttivita, Progressi } from '../../../../types/studia';
import { ActivityCalendar } from './ActivityCalendar';
import { describeDay } from './layout';
import { CardStatesBar } from './CardStatesBar';
import { DueForecast } from './DueForecast';
import { GoalRing } from './GoalRing';
import { StreakBadge } from './StreakBadge';
import { SubjectChips } from './SubjectChips';
import { SubjectProgress } from './SubjectProgress';

// The pieces of the progress dashboard, direction D (Studia progress spec §6.1, §6.3).

const day = (giorno: string, over: Partial<GiornoAttivita> = {}): GiornoAttivita => ({ giorno, ripassi: 12, nuove: 0, sbagliate: 0, valido: true, riposo: false, ...over });

describe('GoalRing', () => {
  it('names today’s goal, and says when it is reached', () => {
    const { rerender } = render(<GoalRing ripassi={6} obiettivo={10} raggiunto={false} />);
    expect(screen.getByRole('img', { name: 'Obiettivo di oggi: 6 di 10 ripassi' })).toBeInTheDocument();
    expect(screen.getByText('di 10 ripassi')).toBeInTheDocument();
    rerender(<GoalRing ripassi={3} obiettivo={10} raggiunto />);
    expect(screen.getByRole('img', { name: 'Obiettivo di oggi: 3 di 10 ripassi, raggiunto' })).toBeInTheDocument();
  });
});

describe('StreakBadge', () => {
  const week: Progressi['serie']['ultimiGiorni'] = [
    { giorno: '2026-10-13', stato: 'fatto' },
    { giorno: '2026-10-14', stato: 'riposo' },
    { giorno: '2026-10-15', stato: 'fatto' },
    { giorno: '2026-10-16', stato: 'saltato' },
    { giorno: '2026-10-17', stato: 'fatto' },
    { giorno: '2026-10-18', stato: 'fatto' },
    { giorno: '2026-10-19', stato: 'oggi' },
  ];

  it('says the count and the record, and each of the seven days in words', () => {
    render(<StreakBadge attuale={2} record={27} ultimiGiorni={week} />);
    expect(screen.getByRole('group', { name: 'Serie: 2 giorni di fila, record 27' })).toBeInTheDocument();
    const days = within(screen.getByRole('list', { name: 'Ultimi sette giorni' })).getAllByRole('listitem');
    expect(days.map((d) => d.textContent)).toEqual([
      'martedì 13 ottobre: obiettivo raggiunto',
      'mercoledì 14 ottobre: giorno di riposo, la serie regge',
      'giovedì 15 ottobre: obiettivo raggiunto',
      'venerdì 16 ottobre: non fatto',
      'sabato 17 ottobre: obiettivo raggiunto',
      'domenica 18 ottobre: obiettivo raggiunto',
      'lunedì 19 ottobre: oggi, da fare',
    ]);
  });

  it('says one day in the singular', () => {
    render(<StreakBadge attuale={1} record={1} ultimiGiorni={week} />);
    expect(screen.getByRole('group', { name: 'Serie: 1 giorno di fila, record 1' })).toBeInTheDocument();
  });
});

describe('ActivityCalendar', () => {
  const today = '2026-10-21';
  const calendario = [day('2026-10-14', { ripassi: 40, nuove: 6, sbagliate: 3 }), day('2026-10-15', { ripassi: 0, valido: false, riposo: true }), day('2026-10-20', { ripassi: 4, valido: false })];

  it('says each kind of day in words', () => {
    expect(describeDay({ giorno: '2026-10-14', day: calendario[0], column: 0, row: 0 }, today)).toBe('mercoledì 14 ottobre: 40 ripassi · 6 nuove · 3 sbagliate · obiettivo raggiunto');
    expect(describeDay({ giorno: '2026-10-15', day: calendario[1], column: 0, row: 0 }, today)).toBe('giovedì 15 ottobre: giorno di riposo, la serie regge');
    expect(describeDay({ giorno: '2026-10-16', day: null, column: 0, row: 0 }, today)).toBe('venerdì 16 ottobre: nessun ripasso');
    expect(describeDay({ giorno: today, day: day(today, { ripassi: 1, nuove: 1, sbagliate: 1, valido: false }), column: 0, row: 0 }, today)).toBe('Oggi, mercoledì 21 ottobre: 1 ripasso · 1 nuova · 1 sbagliata');
    // A day with nothing to do that counted (the queue was empty).
    expect(describeDay({ giorno: '2026-10-17', day: day('2026-10-17', { ripassi: 0 }), column: 0, row: 0 }, today)).toBe('sabato 17 ottobre: niente da ripassare · obiettivo raggiunto');
  });

  it('is one tab stop that sums up the range, and the arrows walk the days and the weeks', async () => {
    render(<ActivityCalendar calendario={calendario} today={today} weeks={12} />);
    const grid = screen.getByRole('group', { name: 'Calendario dei ripassi dal 3 agosto 2026 a oggi: 44 ripassi in 2 giorni' });
    await userEvent.setup().tab();
    expect(grid).toHaveFocus();
    const readout = () => document.getElementById(grid.getAttribute('aria-describedby')!)!.textContent;
    expect(readout()).toBe('Passa sopra un giorno, o toccalo, per i dettagli.');
    fireEvent.keyDown(grid, { key: 'ArrowUp' }); // from today, the day before
    expect(readout()).toBe('martedì 20 ottobre: 4 ripassi');
    fireEvent.keyDown(grid, { key: 'ArrowLeft' }); // a week back
    expect(readout()).toBe('martedì 13 ottobre: nessun ripasso');
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(readout()).toBe('mercoledì 14 ottobre: 40 ripassi · 6 nuove · 3 sbagliate · obiettivo raggiunto');
    fireEvent.keyDown(grid, { key: 'Home' });
    expect(readout()).toBe('lunedì 3 agosto: nessun ripasso');
    fireEvent.keyDown(grid, { key: 'ArrowUp' }); // held at the first day
    expect(readout()).toBe('lunedì 3 agosto: nessun ripasso');
    fireEvent.keyDown(grid, { key: 'End' });
    expect(readout()).toBe('Oggi, mercoledì 21 ottobre: nessun ripasso');
  });

  it('answers a hover and a tap on a day', () => {
    const { container } = render(<ActivityCalendar calendario={calendario} today={today} weeks={12} />);
    fireEvent.pointerEnter(container.querySelector('[data-day="2026-10-15"]')!);
    expect(screen.getByText('giovedì 15 ottobre: giorno di riposo, la serie regge')).toBeInTheDocument();
    fireEvent.click(container.querySelector('[data-day="2026-10-14"]')!);
    expect(screen.getByText(/mercoledì 14 ottobre: 40 ripassi/)).toBeInTheDocument();
  });
});

describe('CardStatesBar', () => {
  it('sums up, and says a segment’s count and share on hover, tap or focus', async () => {
    render(<CardStatesBar stati={{ nuove: 1, apprendimento: 2, consolidate: 1 }} />);
    expect(screen.getByText('4 schede · 25% consolidate')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'In apprendimento: 2 schede (50%)' }));
    expect(screen.getByText('In apprendimento: 2 schede (50%)', { selector: 'p' })).toBeInTheDocument();
    fireEvent.focus(screen.getByRole('button', { name: 'Nuove: 1 scheda (25%)' }));
    expect(screen.getByText('Nuove: 1 scheda (25%)', { selector: 'p' })).toBeInTheDocument();
  });

  it('draws no segment for an empty state, and says when there is nothing', () => {
    const { rerender } = render(<CardStatesBar stati={{ nuove: 0, apprendimento: 3, consolidate: 0 }} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    rerender(<CardStatesBar stati={{ nuove: 0, apprendimento: 0, consolidate: 0 }} />);
    expect(screen.getByText('Nessuna scheda da studiare, per ora.')).toBeInTheDocument();
  });
});

describe('DueForecast', () => {
  const prossimi = Array.from({ length: 14 }, (_, i) => ({ giorno: `2026-10-${String(19 + i).padStart(2, '0')}`, schede: i === 0 ? 30 : i === 1 ? 1 : 5 }));

  it('says the total and today’s in its name, and a day on the arrows, hover and tap', async () => {
    const { container } = render(<DueForecast prossimi={prossimi} />);
    const chart = screen.getByRole('group', { name: 'Schede da ripassare nei prossimi 14 giorni: 91 schede, 30 schede oggi' });
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(screen.getByText('Oggi: 30 schede da ripassare')).toBeInTheDocument();
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(screen.getByText('Domani: 1 scheda da ripassare')).toBeInTheDocument();
    fireEvent.click(container.querySelector('[data-day="2026-10-21"]')!);
    expect(screen.getByText('mer 21: 5 schede da ripassare')).toBeInTheDocument();
  });
});

describe('the subject filter', () => {
  const materie: Progressi['materie'] = [
    { materia: 'DIRITTO_CIVILE', nuove: 20, apprendimento: 28, consolidate: 104, ripassi30: 310 },
    { materia: 'DIRITTO_PENALE', nuove: 0, apprendimento: 0, consolidate: 0, ripassi30: 0 },
    { materia: 'DIRITTO_AMMINISTRATIVO', nuove: 1, apprendimento: 0, consolidate: 0, ripassi30: 1 },
    { materia: 'DIRITTO_PROCESSUALE_CIVILE', nuove: 0, apprendimento: 2, consolidate: 2, ripassi30: 0 },
    { materia: 'DIRITTO_PROCESSUALE_PENALE', nuove: 0, apprendimento: 1, consolidate: 0, ripassi30: 0 },
  ];

  it('lists the five subjects, each a button that sets the filter and, pressed again, clears it', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<SubjectProgress materie={materie} selected={undefined} onSelect={onSelect} />);
    const civil = screen.getByRole('button', { name: /Diritto civile/ });
    expect(civil).toHaveTextContent('104 di 152 consolidate · 68%');
    expect(civil).toHaveTextContent('310 ripassi negli ultimi 30 giorni');
    expect(screen.getByRole('button', { name: /Diritto penale/ })).toHaveTextContent('Nessuna scheda');
    expect(screen.getByRole('button', { name: /Diritto amministrativo/ })).toHaveTextContent('1 ripasso negli ultimi 30 giorni');
    await userEvent.setup().click(civil);
    expect(onSelect).toHaveBeenLastCalledWith('DIRITTO_CIVILE');
    rerender(<SubjectProgress materie={materie} selected="DIRITTO_CIVILE" onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: /Diritto civile/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.setup().click(screen.getByRole('button', { name: /Diritto civile/ }));
    expect(onSelect).toHaveBeenLastCalledWith(undefined);
  });

  it('offers «Tutte le materie» and the five subjects as chips, one pressed', async () => {
    const onSelect = vi.fn();
    render(<SubjectChips selected="DIRITTO_PENALE" onSelect={onSelect} />);
    const group = screen.getByRole('group', { name: 'Materia' });
    expect(within(group).getAllByRole('button')).toHaveLength(6);
    expect(within(group).getByRole('button', { name: 'Diritto penale' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Tutte le materie' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.setup().click(within(group).getByRole('button', { name: 'Tutte le materie' }));
    expect(onSelect).toHaveBeenCalledWith(undefined);
  });
});
