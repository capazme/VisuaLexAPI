import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ActivityCalendar } from './progress/ActivityCalendar';
import { DueForecast } from './progress/DueForecast';
import { GoalStamp } from './progress/Celebration';

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
  it.each(SOURCES)('%s writes no text size under 11 px, but for the session’s compact stamp', (file) => {
    let source = readFileSync(join(DIR, file), 'utf8');
    // The compact stamp is the session's notice (G2), not drawn on «Oggi».
    if (file.endsWith('Celebration.tsx')) source = source.replace(/compact \? 'text-\[\d+px\]'/g, '');
    expect(sizes(source).filter((px) => px < 11)).toEqual([]);
    expect(source).not.toMatch(/<text\b/);
  });

  it('draws the calendar and the coming days with their labels as the interface’s text', () => {
    const days = Array.from({ length: 14 }, (_, i) => ({ giorno: `2026-10-${String(19 + i).padStart(2, '0')}`, schede: i }));
    const { container } = render(
      <>
        <ActivityCalendar calendario={[]} today="2026-10-19" weeks={12} />
        <DueForecast prossimi={days} />
      </>,
    );
    expect(container.querySelectorAll('svg text')).toHaveLength(0);
    const labels = [...container.querySelectorAll('span.absolute')];
    expect(labels.map((l) => l.textContent)).toEqual(expect.arrayContaining(['L', 'M', 'V', 'D', 'oggi']));
    for (const label of labels) expect(label.closest('.text-xs')).not.toBeNull();
  });

  it('writes the stamp’s date at 12 px on «Oggi»', () => {
    const { getByTestId } = render(<GoalStamp giorno="2026-10-19" serie={5} press={false} />);
    expect(getByTestId('goal-stamp').innerHTML).not.toMatch(/text-\[(?:[0-9]|10)px\]/);
  });
});
