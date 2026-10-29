import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * «Percorsi» (courses spec §6) keeps its targets at 44 px at every width — no `md:` override shrinks one on a computer,
 * as «Contribuisci» — and writes no text under 11 px. The lesson's text is not here: the lesson is the web's PR (b).
 */
const DIR = __dirname;
const SOURCES = readdirSync(DIR).filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'));

describe('the targets and the type of «Percorsi»', () => {
  it('finds the folder\'s components', () => {
    expect(SOURCES).toEqual(expect.arrayContaining(['CoursesView.tsx', 'CoursePage.tsx', 'TodayCourses.tsx']));
  });

  it.each(SOURCES)('%s keeps its targets at 44 px from `md` up', (file) => {
    expect(readFileSync(join(DIR, file), 'utf8')).not.toMatch(/\bmd:(?:min-h|min-w|h)-(?!\[44px\])/);
  });

  it.each(SOURCES)('%s writes no text size under 11 px and no `text-xs`', (file) => {
    const source = readFileSync(join(DIR, file), 'utf8');
    const sizes = [...source.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map((m) => Number(m[1]));
    expect(sizes.filter((px) => px < 11)).toEqual([]);
    expect(source).not.toMatch(/\btext-xs\b/);
  });
});
