import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Academia's type and colours (S7b): no text under 12 px, and the colours from the «Inchiostro» tokens — `primary-*`,
 * never a hand-written `blue-`, `indigo-`, `purple-` or `violet-` (Y1). Every MERL-T file the section draws: the hub,
 * the graph, the validation and contribution pages, and the pieces the reader borrows from them. Not the canvas's
 * labels (`graph/shared/graphStyles.ts`'s `labelFontSize`): drawn in the graph's own units, they grow and shrink with
 * its zoom.
 */
// The suite runs from `apps/web`, as `theme.test.ts` assumes.
const ROOT = resolve(process.cwd(), 'src');
const DIR = join(ROOT, 'features/merlt');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const FILES = [...sources(DIR), join(ROOT, 'pages/MerltHubPage.tsx')].map((path) => relative(ROOT, path));

describe('Academia\'s type and colours', () => {
  it('reads the section\'s files', () => {
    expect(FILES).toContain('pages/MerltHubPage.tsx');
    expect(FILES).toContain('features/merlt/graph/page/GraphExplorerPage.tsx');
  });

  it.each(FILES)('%s writes no text under 12 px and no colour outside the tokens', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf8');
    const small = [...source.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map((m) => Number(m[1])).filter((px) => px < 12);
    expect(small).toEqual([]);
    expect(source.match(/\b(?:blue|indigo|purple|violet)-\d/g)).toBeNull();
  });
});
