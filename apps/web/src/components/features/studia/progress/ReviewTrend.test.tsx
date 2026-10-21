import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { GiornoAttivita } from '../../../../types/studia';
import { addDays } from './layout';
import { ReviewTrend, type ReviewTrendProps } from './ReviewTrend';
import type { TrendPeriod } from './trend';

const TODAY = '2026-10-21';
const day = (giorno: string, ripassi: number, over: Partial<GiornoAttivita> = {}): GiornoAttivita => ({ giorno, ripassi, nuove: 0, sbagliate: 0, valido: ripassi >= 10, riposo: false, ...over });
// Twelve reviews a day for the last two weeks, five a day the two before: the 30 days grow on the 30 before.
const calendario = [
  ...Array.from({ length: 14 }, (_, i) => day(addDays(TODAY, -i), 12)),
  day(addDays(TODAY, -16), 0, { riposo: true, valido: false }),
  ...Array.from({ length: 10 }, (_, i) => day(addDays(TODAY, -40 - i), 20)),
];

const chart = () => screen.getByRole('group', { name: /^Ripassi / });
/** The page's part: it keeps the period. */
function Trend(props: Omit<ReviewTrendProps, 'period' | 'onPeriod' | 'intro'>) {
  const [period, setPeriod] = useState<TrendPeriod>('30g');
  return <ReviewTrend {...props} period={period} onPeriod={setPeriod} intro={false} />;
}
const renderTrend = (props: Partial<ReviewTrendProps> = {}) => render(<Trend calendario={calendario} today={TODAY} obiettivo={10} {...props} />);

describe('ReviewTrend (G7)', () => {
  it('opens on 30 days: their total, their change on the 30 before, the goal line', () => {
    renderTrend();
    expect(screen.getByRole('tab', { name: '30 giorni' })).toHaveAttribute('aria-selected', 'true');
    expect(chart()).toHaveAccessibleName('Ripassi al giorno negli ultimi 30 giorni: 168 ripassi in tutto; obiettivo 10 al giorno');
    // Over whole days: 156 up to yesterday against 200 in the 29 before: down, in ink, never in red.
    const change = screen.getByText('−22% sui 30 giorni prima');
    expect(change).toHaveClass('text-slate-600');
    expect(change.className).not.toMatch(/red/);
    expect(screen.getByText('obiettivo')).toBeInTheDocument();
    expect(document.querySelector('[data-goal]')).not.toBeNull();
  });

  it('says a rise in green, and nothing when the period before had no reviews', () => {
    const { rerender } = render(<Trend calendario={[day(addDays(TODAY, -1), 12), day(addDays(TODAY, -8), 6)]} today={TODAY} obiettivo={10} />);
    fireEvent.click(screen.getByRole('tab', { name: '7 giorni' }));
    // Green that reads at 14 px: 4.5:1 (green 700; dark: green 400).
    expect(screen.getByText('+100% sui 7 giorni prima')).toHaveClass('text-green-700');
    rerender(<Trend calendario={[day(TODAY, 12)]} today={TODAY} obiettivo={10} />);
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
    // A fifth darker on the light card (`--vlx-trend-shade`), the wash in the hue itself.
    expect((document.querySelector('[data-line]') as SVGElement).style.stroke).toBe('color-mix(in oklab, hsl(var(--category-civil)), var(--vlx-trend-shade))');
  });

  it('speaks the day to a screen reader from the keyboard only, not under a moving pointer', () => {
    // jsdom has no PointerEvent: a mouse event with a pointer type stands for it.
    class TestPointerEvent extends MouseEvent {
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerType = init.pointerType ?? 'mouse';
      }
    }
    Object.defineProperty(window, 'PointerEvent', { configurable: true, value: TestPointerEvent });
    renderTrend();
    const group = chart();
    const readout = document.getElementById(group.getAttribute('aria-describedby')!)!;
    fireEvent.pointerMove(group.querySelector('rect[fill="transparent"]')!, { clientX: 0, pointerType: 'mouse' });
    expect(screen.getByText(/^mar 22 set · /)).toBeInTheDocument();
    expect(readout).toBeEmptyDOMElement();
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(readout).toHaveTextContent(/^mercoledì 23 settembre/);
    Reflect.deleteProperty(window, 'PointerEvent');
  });

  it('puts the goal\'s name at the end of its line, in the margin, over no point', () => {
    renderTrend();
    const label = screen.getByText('obiettivo');
    expect(label.style.left).toBe(`${44 + (640 - 44 - 64) + 6}px`);
  });

  it('draws to the card\'s real width when it is measured after the opening began (G7, the review)', async () => {
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1166 });
    try {
      const { container } = render(<ReviewTrend calendario={calendario} today={TODAY} obiettivo={10} period="30g" onPeriod={() => {}} intro />);
      const clip = () => container.querySelector('[id$="-drawn"] rect')!;
      // 1166 less the margins (44 and 64), and the 8 px past the line's caps.
      await waitFor(() => expect(parseFloat(clip().getAttribute('width') ?? '0')).toBe(1066), { timeout: 3000 });
    } finally {
      if (width) Object.defineProperty(HTMLElement.prototype, 'clientWidth', width);
    }
  });

  it('counts the total up on opening only: back on the same period, the value is there at once', async () => {
    function Page() {
      const [period, setPeriod] = useState<TrendPeriod>('30g');
      return <ReviewTrend calendario={calendario} today={TODAY} obiettivo={10} period={period} onPeriod={setPeriod} intro />;
    }
    render(<Page />);
    const total = () => document.querySelector('p.font-serif')!;
    await waitFor(() => expect(total()).toHaveTextContent('168'), { timeout: 3000 });
    fireEvent.click(screen.getByRole('tab', { name: '7 giorni' }));
    fireEvent.click(screen.getByRole('tab', { name: '30 giorni' }));
    expect(total()).toHaveTextContent('168');
  });

  it('names this week, still going, in the six months\' table', () => {
    renderTrend();
    fireEvent.click(screen.getByRole('tab', { name: '6 mesi' }));
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('19 ottobre 2026 · in corso');
    expect(rows[2]).not.toHaveTextContent('in corso');
  });
});
