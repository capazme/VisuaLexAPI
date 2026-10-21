import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { GiornoAttivita } from '../../../../types/studia';
import { addDays } from './layout';
import { ReviewTrend } from './ReviewTrend';

const TODAY = '2026-10-21';
const day = (giorno: string, ripassi: number, over: Partial<GiornoAttivita> = {}): GiornoAttivita => ({ giorno, ripassi, nuove: 0, sbagliate: 0, valido: ripassi >= 10, riposo: false, ...over });
// Twelve reviews a day for the last two weeks, five a day the two before: the 30 days grow on the 30 before.
const calendario = [
  ...Array.from({ length: 14 }, (_, i) => day(addDays(TODAY, -i), 12)),
  day(addDays(TODAY, -16), 0, { riposo: true, valido: false }),
  ...Array.from({ length: 10 }, (_, i) => day(addDays(TODAY, -40 - i), 20)),
];

const chart = () => screen.getByRole('group', { name: /^Ripassi / });
const renderTrend = (props: Partial<Parameters<typeof ReviewTrend>[0]> = {}) => render(<ReviewTrend calendario={calendario} today={TODAY} obiettivo={10} {...props} />);

describe('ReviewTrend (G7)', () => {
  it('opens on 30 days: their total, their change on the 30 before, the goal line', () => {
    renderTrend();
    expect(screen.getByRole('tab', { name: '30 giorni' })).toHaveAttribute('aria-selected', 'true');
    expect(chart()).toHaveAccessibleName('Ripassi al giorno negli ultimi 30 giorni: 168 ripassi in tutto; obiettivo 10 al giorno');
    // 168 against 200: down, in ink, never in red.
    const change = screen.getByText('−16% sui 30 giorni prima');
    expect(change).toHaveClass('text-slate-600');
    expect(change.className).not.toMatch(/red/);
    expect(screen.getByText('obiettivo')).toBeInTheDocument();
    expect(document.querySelector('[data-goal]')).not.toBeNull();
  });

  it('says a rise in green, and nothing when the period before had no reviews', () => {
    const { rerender } = render(<ReviewTrend calendario={[day(TODAY, 12), day(addDays(TODAY, -8), 6)]} today={TODAY} obiettivo={10} />);
    fireEvent.click(screen.getByRole('tab', { name: '7 giorni' }));
    expect(screen.getByText('+100% sui 7 giorni prima')).toHaveClass('text-green-600');
    rerender(<ReviewTrend calendario={[day(TODAY, 12)]} today={TODAY} obiettivo={10} />);
    expect(screen.queryByText(/giorni prima/)).toBeNull();
  });

  it('switches period by its tabs, with the arrows too; six months go by week with seven days\' goal', () => {
    renderTrend();
    const thirty = screen.getByRole('tab', { name: '30 giorni' });
    fireEvent.keyDown(thirty, { key: 'ArrowRight' });
    const six = screen.getByRole('tab', { name: '6 mesi' });
    expect(six).toHaveAttribute('aria-selected', 'true');
    expect(six).toHaveFocus();
    expect(chart()).toHaveAccessibleName(/^Ripassi a settimana negli ultimi 6 mesi: 368 ripassi in tutto; obiettivo 70 a settimana$/);
    expect(screen.queryByText(/prima$/)).toBeNull();
    fireEvent.keyDown(six, { key: 'Home' });
    expect(screen.getByRole('tab', { name: '7 giorni' })).toHaveAttribute('aria-selected', 'true');
  });

  it('moves the cursor by the arrows, Home and End, and says the day for a screen reader', () => {
    renderTrend();
    const group = chart();
    fireEvent.keyDown(group, { key: 'End' });
    const readout = document.getElementById(group.getAttribute('aria-describedby')!)!;
    expect(readout).toHaveTextContent('Oggi, mercoledì 21 ottobre: 12 ripassi, obiettivo raggiunto');
    expect(screen.getByText('mer 21 ott · 12 ripassi · obiettivo raggiunto')).toBeInTheDocument();
    fireEvent.keyDown(group, { key: 'Home' });
    expect(readout).toHaveTextContent(/^martedì 22 settembre: nessun ripasso/);
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(readout).toHaveTextContent(/^mercoledì 23 settembre/);
  });

  it('says a rest as a rest under the cursor', () => {
    renderTrend();
    const group = chart();
    fireEvent.keyDown(group, { key: 'End' });
    for (let i = 0; i < 16; i += 1) fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(screen.getByText('lun 5 ott · 0 ripassi · giorno di riposo')).toBeInTheDocument();
  });

  it('marks the days not done under the axis', () => {
    renderTrend();
    // In the 30 days, after the first day studied (−49): −29 … −14 not done, but −16, a rest.
    expect(document.querySelectorAll('[data-missed]')).toHaveLength(15);
  });

  it('keeps the numbers in a table under «Vedi i numeri»', () => {
    renderTrend();
    const table = screen.getByRole('table', { name: 'Ripassi al giorno negli ultimi 30 giorni' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(31);
    expect(rows[1]).toHaveTextContent('mer 21 ott12obiettivo raggiunto');
  });

  it('draws one subject in its hue', () => {
    renderTrend({ hue: 'hsl(var(--category-civil))', narrowed: true });
    expect(document.querySelector('[data-line]')).toHaveStyle({ stroke: 'hsl(var(--category-civil))' });
  });
});
