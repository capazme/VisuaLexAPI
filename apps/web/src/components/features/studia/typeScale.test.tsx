import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ReviewTrend } from './progress/ReviewTrend';
import { DueForecast } from './progress/DueForecast';
import { GoalMark } from './progress/GoalMark';

/**
 * «Oggi» has no text under 11 px and one type language (Gymnasium spec §5.1, G1b): every label is the interface's
 * text, never SVG text in a drawing scaled to its width, which would shrink with it.
 */
// The suite runs from `apps/web`, as `theme.test.ts` assumes.
const DIR = resolve(process.cwd(), 'src/components/features/studia');
const SOURCES = [
  ...readdirSync(join(DIR, 'missions')).map((f) => join('missions', f)),
  ...readdirSync(join(DIR, 'progress')).map((f) => join('progress', f)),
  'ReviewHome.tsx',
  'StudiaPage.tsx',
].filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'));

/** The pixel sizes written as arbitrary values: `text-[10px]`. */
const sizes = (source: string) => [...source.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map((m) => Number(m[1]));

describe('the type scale of «Oggi»', () => {
  it.each(SOURCES)('%s writes no text size under 11 px, the session’s compact stamp included (Y1)', (file) => {
    const source = readFileSync(join(DIR, file), 'utf8');
    expect(sizes(source).filter((px) => px < 11)).toEqual([]);
    expect(source).not.toMatch(/<text\b/);
  });

  it('draws the trend and the coming days with their labels as the interface’s text', () => {
    const days = Array.from({ length: 14 }, (_, i) => ({ giorno: `2026-10-${String(19 + i).padStart(2, '0')}`, schede: i }));
    const { container } = render(
      <>
        <ReviewTrend calendario={[]} today="2026-10-19" obiettivo={10} period="30g" onPeriod={() => {}} intro={false} />
        <DueForecast prossimi={days} />
      </>,
    );
    expect(container.querySelectorAll('svg text')).toHaveLength(0);
    // The labels laid over the drawings (the periods' pill is a span with no words).
    const labels = [...container.querySelectorAll('span.absolute')].filter((l) => l.textContent);
    expect(labels.map((l) => l.textContent)).toEqual(expect.arrayContaining(['obiettivo', '0', '15', 'oggi']));
    for (const label of labels) expect(label.closest('.text-xs')).not.toBeNull();
  });

  it('draws the goal\'s mark with no text in it: its date and day are the interface\'s words beside it (G9)', () => {
    const { getByTestId } = render(<GoalMark size={112} label="Obiettivo raggiunto" />);
    const mark = getByTestId('goal-mark');
    expect(mark.querySelectorAll('text')).toHaveLength(0);
    expect(mark.textContent).toBe('');
  });
});
