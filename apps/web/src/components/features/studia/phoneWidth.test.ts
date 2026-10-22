import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Gymnasium never scrolls sideways on a phone (G8b). The page is measured in a browser (390 and 320 px, «Oggi» with full
 * data: `.vlx-page`'s scrollWidth equals its clientWidth); here, the three causes found, kept from coming back:
 * - a grid with no columns below `xl`: its implicit track grows to its widest content, «Le tue materie»'s strip;
 * - a strip that scrolls sideways and is not `relative`: an absolute piece inside it (a card's `sr-only` words) takes
 *   the nearest positioned box beyond it as its own, the strip clips none of them, and the page widens to the last;
 * - a subject's name cut short.
 */
// The suite runs from `apps/web`, as `theme.test.ts` assumes.
const DIR = resolve(process.cwd(), 'src/components/features/studia');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [path] : [];
  });
}

/** Every class string of a file: the quoted strings that carry Tailwind classes. */
const classStrings = (source: string) => [...source.matchAll(/(['"`])((?:(?!\1).)*?\b(?:overflow-x-auto|grid)\b(?:(?!\1).)*?)\1/g)].map((m) => m[2]);

describe('Gymnasium on a phone', () => {
  it.each(sources(DIR).map((path) => relative(DIR, path)))('%s: every strip that scrolls sideways is the box of what it holds', (file) => {
    const strips = classStrings(readFileSync(join(DIR, file), 'utf8')).filter((classes) => /(?:^|\s)overflow-x-auto(?:\s|$)/.test(classes));
    for (const classes of strips) expect(classes).toMatch(/(?:^|\s)relative(?:\s|$)/);
  });

  it('gives «Oggi»\'s grids a column below xl, so no implicit track grows', () => {
    const home = readFileSync(join(DIR, 'ReviewHome.tsx'), 'utf8');
    expect(home).toMatch(/'relative grid grid-cols-1 gap-6 pb-8'/);
    expect(home).toMatch(/'grid min-w-0 grid-cols-1 gap-6'/);
  });

  it('never cuts a subject\'s name in «Le tue materie»', () => {
    const list = readFileSync(join(DIR, 'progress/SubjectList.tsx'), 'utf8');
    const name = list.match(/<span data-subject-name className="([^"]+)"/)![1];
    expect(name).not.toMatch(/truncate|line-clamp|whitespace-nowrap/);
    expect(name).toContain('[overflow-wrap:anywhere]');
  });
});
