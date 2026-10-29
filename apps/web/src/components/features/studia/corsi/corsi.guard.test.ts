import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * «Percorsi» (courses spec §6) keeps its targets at 44 px at every width — no `md:` override shrinks one on a computer,
 * as «Contribuisci», and a small `Button` (32 px from `md`) is raised back — and writes no text under 11 px. The
 * declaration's dialog, `AcceptTextDialog`, is held to the same. The lesson's text is not here: the lesson is the web's PR (b).
 */
const DIR = __dirname;
/** The folder's components, and the dialog «Percorsi» draws its declaration in. */
const SOURCES = [
  ...readdirSync(DIR).filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx')),
  '../AcceptTextDialog.tsx',
];

describe('the targets and the type of «Percorsi»', () => {
  it('finds the folder\'s components', () => {
    expect(SOURCES).toEqual(expect.arrayContaining(['CoursesView.tsx', 'CoursePage.tsx', 'TodayCourses.tsx', '../AcceptTextDialog.tsx']));
  });

  it.each(SOURCES)('%s keeps its targets at 44 px from `md` up', (file) => {
    expect(readFileSync(join(DIR, file), 'utf8')).not.toMatch(/\bmd:(?:min-h|min-w|h)-(?!\[44px\])/);
  });

  it.each(SOURCES)('%s gives every small `Button` its 44 px from `md` too (its own size is 32 px there)', (file) => {
    const buttons = [...readFileSync(join(DIR, file), 'utf8').matchAll(/<Button\b[^>]*>/g)].map((m) => m[0]);
    for (const tag of buttons.filter((t) => /size="sm"/.test(t))) expect(tag).toMatch(/md:min-h-\[44px\]/);
  });

  it.each(SOURCES)('%s writes no text size under 11 px and no `text-xs`', (file) => {
    const source = readFileSync(join(DIR, file), 'utf8');
    const sizes = [...source.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map((m) => Number(m[1]));
    expect(sizes.filter((px) => px < 11)).toEqual([]);
    expect(source).not.toMatch(/\btext-xs\b/);
  });
});
