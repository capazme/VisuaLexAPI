import { describe, expect, it, vi } from 'vitest';
import { HIDDEN_SCROLLBAR } from '../../../../constants/interactions';
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
    expect(describeDay({ giorno: '2026-10-14', day: calendario[0], column: 0, row: 0 }, today)).toBe('mercoledì 14 ottobre: 40 ripassi, 6 nuove, 3 sbagliate, obiettivo raggiunto');
    expect(describeDay({ giorno: '2026-10-15', day: calendario[1], column: 0, row: 0 }, today)).toBe('giovedì 15 ottobre: giorno di riposo, la serie regge');
    expect(describeDay({ giorno: '2026-10-16', day: null, column: 0, row: 0 }, today)).toBe('venerdì 16 ottobre: nessun ripasso');
    expect(describeDay({ giorno: today, day: day(today, { ripassi: 1, nuove: 1, sbagliate: 1, valido: false }), column: 0, row: 0 }, today)).toBe('Oggi, mercoledì 21 ottobre: 1 ripasso, 1 nuova, 1 sbagliata');
    // A day with nothing to do that counted (the queue was empty).
    expect(describeDay({ giorno: '2026-10-17', day: day('2026-10-17', { ripassi: 0 }), column: 0, row: 0 }, today)).toBe('sabato 17 ottobre: niente da ripassare, obiettivo raggiunto');
  });

  it('is one tab stop that sums up the range, and the arrows walk the days and the weeks', async () => {
    render(<ActivityCalendar calendario={calendario} today={today} weeks={12} />);
    const grid = screen.getByRole('group', { name: 'Calendario dei ripassi dal 3 agosto 2026 a oggi: 44 ripassi in 2 giorni' });
    await userEvent.setup().tab();
    expect(grid).toHaveFocus();
    const readout = () => document.getElementById(grid.getAttribute('aria-describedby')!)!.textContent;
    expect(readout()).toBe('Passa sopra un giorno o toccalo per i dettagli; con la tastiera, le frecce ti spostano tra i giorni.');
    fireEvent.keyDown(grid, { key: 'ArrowUp' }); // from today, the day before
    // After the first day studied (14 October), a day that did not count says so.
    expect(readout()).toBe('martedì 20 ottobre: 4 ripassi, obiettivo non raggiunto');
    fireEvent.keyDown(grid, { key: 'ArrowLeft' }); // a week back
    expect(readout()).toBe('martedì 13 ottobre: nessun ripasso');
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(readout()).toBe('mercoledì 14 ottobre: 40 ripassi, 6 nuove, 3 sbagliate, obiettivo raggiunto');
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
  it('marks each day by its state, a shape for each, and says a missed day only after the first one studied', () => {
    // 2026-10-21 is a Wednesday: Thursday to Sunday are still to come.
    const { container } = render(<ActivityCalendar calendario={calendario} today={today} weeks={12} />);
    const state = (giorno: string) => container.querySelector(`[data-day="${giorno}"]`)?.getAttribute('data-stato');
    expect(state('2026-10-13')).toBe('vuoto'); // before the first day studied
    expect(state('2026-10-14')).toBe('fatto');
    expect(state('2026-10-15')).toBe('riposo');
    expect(state('2026-10-16')).toBe('saltato');
    expect(state('2026-10-20')).toBe('saltato'); // reviews under the goal
    expect(state(today)).toBe('oggi');
    expect(['2026-10-22', '2026-10-25'].map(state)).toEqual(['futuro', 'futuro']);
    expect(describeDay({ giorno: '2026-10-16', day: null, column: 0, row: 0 }, today, '2026-10-14')).toBe('venerdì 16 ottobre: nessun ripasso, giorno saltato');
    expect(describeDay({ giorno: '2026-10-13', day: null, column: 0, row: 0 }, today, '2026-10-14')).toBe('martedì 13 ottobre: nessun ripasso');
  });

  it('writes its legend in words', () => {
    render(<ActivityCalendar calendario={calendario} today={today} weeks={12} />);
    const legend = within(screen.getByRole('list', { name: 'Legenda del calendario' })).getAllByRole('listitem');
    // What a screen reader says: the drawn «meno ▢▢▢▢▢ più ripassi» is hidden, a sentence stands for it.
    const spoken = (item: HTMLElement) => {
      const copy = item.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('[aria-hidden]').forEach((hidden) => hidden.remove());
      return copy.textContent;
    };
    expect(legend.map(spoken)).toEqual(['Più scuro il colore, più ripassi', 'giorno fatto', 'di riposo', 'saltato', 'oggi', 'a venire']);
  });

  it('never chooses a day still to come: End stops at today, and they do not answer a pointer', () => {
    const { container } = render(<ActivityCalendar calendario={calendario} today={today} weeks={12} />);
    const grid = screen.getByRole('group', { name: /Calendario dei ripassi/ });
    fireEvent.pointerEnter(container.querySelector('[data-day="2026-10-24"]')!);
    expect(screen.getByText('Passa sopra un giorno o toccalo per i dettagli; con la tastiera, le frecce ti spostano tra i giorni.')).toBeInTheDocument();
    fireEvent.keyDown(grid, { key: 'End' });
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(document.getElementById(grid.getAttribute('aria-describedby')!)!.textContent).toBe('Oggi, mercoledì 21 ottobre: nessun ripasso');
  });

  it('says nothing is missed for a newcomer, and counts nothing before the first day', () => {
    const { container } = render(<ActivityCalendar calendario={[]} today={today} weeks={12} />);
    // Not even in the legend.
    expect(within(screen.getByRole('list', { name: 'Legenda del calendario' })).queryByText('saltato')).toBeNull();
    expect(screen.getByRole('group', { name: 'Calendario dei ripassi dal 3 agosto 2026 a oggi: ancora nessun ripasso' })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-stato="saltato"]')).toHaveLength(0);
    fireEvent.click(container.querySelector('[data-day="2026-10-16"]')!);
    expect(screen.getByText('venerdì 16 ottobre: nessun ripasso')).toBeInTheDocument();
  });

  it('keeps the day chosen, not its place, when the calendar changes width', () => {
    const { container, rerender } = render(<ActivityCalendar calendario={calendario} today={today} weeks={26} />);
    fireEvent.click(container.querySelector('[data-day="2026-10-14"]')!);
    rerender(<ActivityCalendar calendario={calendario} today={today} weeks={12} />);
    expect(screen.getByText(/^mercoledì 14 ottobre: 40 ripassi/)).toBeInTheDocument();
  });

  it('rims a day\'s mark with the ground on a subject\'s hue, and says a subject\'s empty day as such', () => {
    const counted = [...calendario, day('2026-10-19', { ripassi: 0 })];
    const { container } = render(<ActivityCalendar calendario={counted} today={today} weeks={12} hue="hsl(var(--category-civil))" narrowed />);
    // The 14th is tinted (40 reviews) and counted: its dot has a rim; the 19th counted with other subjects, untinted.
    expect(container.querySelector('[data-day="2026-10-14"] [data-halo]')).not.toBeNull();
    expect(container.querySelector('[data-day="2026-10-19"] [data-halo]')).toBeNull();
    fireEvent.click(container.querySelector('[data-day="2026-10-19"]')!);
    expect(screen.getByText('lunedì 19 ottobre: nessun ripasso in questa materia, obiettivo raggiunto')).toBeInTheDocument();
    // A missed day of the subject's calendar says the subject too; the 16th has no row at all.
    fireEvent.click(container.querySelector('[data-day="2026-10-16"]')!);
    expect(screen.getByText('venerdì 16 ottobre: nessun ripasso in questa materia, giorno saltato')).toBeInTheDocument();
  });

  it('reads a day of 9999 reviews whole, and a sum of five digits grouped', () => {
    const busy = [day('2026-10-19', { ripassi: 9999 }), day('2026-10-20', { ripassi: 2346 })];
    const { container } = render(<ActivityCalendar calendario={busy} today={today} weeks={12} />);
    expect(screen.getByRole('group', { name: /12\.345 ripassi in 2 giorni$/ })).toBeInTheDocument();
    fireEvent.click(container.querySelector('[data-day="2026-10-19"]')!);
    expect(screen.getByText('lunedì 19 ottobre: 9999 ripassi, obiettivo raggiunto')).toBeInTheDocument();
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

  it('rounds the three shares to add up to 100, and never writes «0%» for a state with cards', () => {
    // 1, 1 and 1 would round to 33 each (99): the largest remainder gives the first the point left.
    const { rerender } = render(<CardStatesBar stati={{ nuove: 1, apprendimento: 1, consolidate: 1 }} />);
    expect(screen.getAllByRole('definition').map((dd) => dd.textContent)).toEqual(['134%', '133%', '133%']);
    // 1 of 400 rounds to none: «<1%», and the other two still add up to 100.
    rerender(<CardStatesBar stati={{ nuove: 1, apprendimento: 200, consolidate: 199 }} />);
    expect(screen.getAllByRole('definition').map((dd) => dd.textContent)).toEqual(['1<1%', '20050%', '19950%']);
    expect(screen.getByRole('button', { name: 'Nuove: 1 scheda (<1%)' })).toBeInTheDocument();
  });

  it('writes the three states by name, count and share, not by colour alone', () => {
    render(<CardStatesBar stati={{ nuove: 1, apprendimento: 2, consolidate: 1 }} />);
    expect(screen.getAllByRole('term').map((dt) => dt.textContent)).toEqual(['Nuove', 'In apprendimento', 'Consolidate']);
    expect(screen.getAllByRole('definition').map((dd) => dd.textContent)).toEqual(['125%', '250%', '125%']);
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

  it('writes its scale beside the drawing, each label on its own line, and marks today', () => {
    const { container } = render(<DueForecast prossimi={prossimi} />);
    // The tallest bar is 30: the scale is 0, 15 and 30, outside the SVG.
    const scale = [...container.querySelectorAll('.text-right span.absolute')].map((label) => label.textContent);
    expect(scale).toEqual(['0', '15', '30']);
    expect(container.querySelector('svg')!.textContent).toBe('');
    expect(screen.getByText('oggi')).toHaveClass('font-semibold');
  });

  it('draws a day with nothing due as a hollow mark, not a gap', () => {
    const empty = prossimi.map((d, i) => ({ ...d, schede: i === 3 ? 0 : d.schede }));
    const { container } = render(<DueForecast prossimi={empty} />);
    expect(container.querySelector('[data-day="2026-10-22"] [data-empty]')).not.toBeNull();
    expect(container.querySelectorAll('[data-empty]')).toHaveLength(1);
    fireEvent.click(container.querySelector('[data-day="2026-10-22"]')!);
    expect(screen.getByText('gio 22: 0 schede da ripassare')).toBeInTheDocument();
  });

  it('keeps a scale of four digits whole', () => {
    const { container } = render(<DueForecast prossimi={prossimi.map((d, i) => ({ ...d, schede: i === 0 ? 9999 : 0 }))} />);
    expect([...container.querySelectorAll('.text-right span.absolute')].map((label) => label.textContent)).toEqual(['0', '5000', '10.000']);
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
    expect(screen.getByRole('button', { name: /Diritto penale/ })).not.toHaveClass('opacity-50');
    expect(screen.getByRole('button', { name: /Diritto civile/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.setup().click(screen.getByRole('button', { name: /Diritto civile/ }));
    expect(onSelect).toHaveBeenLastCalledWith(undefined);
  });

  it('orders the subjects as «Oggi»\'s road, each with its three states in words and its reviews of 30 days', () => {
    render(<SubjectProgress materie={materie} selected={undefined} onSelect={vi.fn()} />);
    const names = screen.getAllByRole('button').map((b) => b.textContent!.match(/^Diritto [a-z ]+?(?=\d|Nessuna)/)?.[0]);
    // Open cards (new plus in learning) first, then by name.
    expect(names).toEqual(['Diritto civile', 'Diritto processuale civile', 'Diritto amministrativo', 'Diritto processuale penale', 'Diritto penale']);
    const civil = screen.getByRole('button', { name: /Diritto civile/ });
    expect(civil).toHaveTextContent('20 nuove · 28 in apprendimento · 104 consolidate');
    expect(screen.getByRole('button', { name: /Diritto penale/ })).toHaveTextContent('Nessun ripasso negli ultimi 30 giorni');
    expect(screen.queryByText(/da ripassare/)).toBeNull();
  });

  it('offers «Tutte le materie» and the five subjects as chips, one pressed', async () => {
    const onSelect = vi.fn();
    render(<SubjectChips selected="DIRITTO_PENALE" onSelect={onSelect} />);
    const group = screen.getByRole('group', { name: 'Materia' });
    expect(within(group).getAllByRole('button')).toHaveLength(6);
    // A phone's sideways row with no bar drawn: in dark mode it showed light (theme.test.ts checks the CSS).
    expect(group).toHaveClass(...HIDDEN_SCROLLBAR.split(' '));
    expect(within(group).getByRole('button', { name: 'Diritto penale' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Tutte le materie' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.setup().click(within(group).getByRole('button', { name: 'Tutte le materie' }));
    expect(onSelect).toHaveBeenCalledWith(undefined);
  });
});
