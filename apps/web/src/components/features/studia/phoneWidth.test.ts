import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Gymnasium never scrolls sideways on a phone (G8b). The page is measured in a browser (390 and 320 px, «Oggi» with full
 * data: `.vlx-page`'s scrollWidth equals its clientWidth); here, the three causes found, kept from coming back:
 * - a grid with no columns below `xl`: its implicit track grows to its widest content, «Le tue materie»'s strip;
 * - a strip that scrolls sideways and is not `relative`: an absolute piece inside it (a card's `sr-only` words) takes
 *   the nearest positioned box beyond it as its own, the strip clips none of them, and the page widens to the last;
 * - a subject's name cut short.
 */
// This folder, wherever the suite runs from (as `motion.guard.test.ts` finds `src`).
const DIR = __dirname;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [path] : [];
  });
}

/** A strip that scrolls: `overflow(-x)-auto` or `-scroll`, at any width (`md:overflow-x-auto` too). */
const SCROLLS = /(?:^|\s)(?:[a-z0-9-]+:)*overflow(?:-x)?-(?:auto|scroll)(?=\s|$)/;

/** Every class string of a file that makes a strip scroll: a quoted string, or a `cn(…)` call's strings together. */
function scrollingClasses(source: string): string[] {
  const calls = [...source.matchAll(/cn\(([\s\S]*?)\)/g)].map((m) => [...m[1].matchAll(/(['"`])([^'"`]*)\1/g)].map((q) => q[2]).join(' '));
  const strings = [...source.matchAll(/className="([^"]*)"/g)].map((m) => m[1]);
  return [...calls, ...strings].filter((classes) => SCROLLS.test(classes));
}

describe('Gymnasium on a phone', () => {
  it.each(sources(DIR).map((path) => relative(DIR, path)))('%s: every strip that scrolls sideways is the box of what it holds', (file) => {
    for (const classes of scrollingClasses(readFileSync(join(DIR, file), 'utf8'))) expect(classes).toMatch(/(?:^|\s)relative(?:\s|$)/);
  });

  it('gives «Oggi»\'s grids a column below xl, so no implicit track grows', () => {
    const home = readFileSync(join(DIR, 'ReviewHome.tsx'), 'utf8');
    // Every grid «Oggi» lays out declares its columns (below `xl` one, `grid-cols-1`).
    const grids = [...home.matchAll(/className=\{cn\('([^']*)'/g)].map((m) => m[1]).filter((classes) => /(?:^|\s)grid(?:\s|$)/.test(classes));
    expect(grids.length).toBeGreaterThanOrEqual(2);
    for (const classes of grids) expect(classes).toMatch(/(?:^|\s)grid-cols-1(?:\s|$)/);
  });

  it('never cuts a subject\'s name in «Le tue materie»', () => {
    const list = readFileSync(join(DIR, 'progress/SubjectList.tsx'), 'utf8');
    const name = list.match(/<span data-subject-name className="([^"]+)"/)![1];
    expect(name).not.toMatch(/truncate|line-clamp|whitespace-nowrap/);
    expect(name).toContain('break-words');
  });
});
