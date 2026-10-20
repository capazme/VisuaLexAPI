import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * «Contribuisci» (Gymnasium spec §5.5, G4): Le mie schede, Da validare and the reader's row keep their controls at
 * 44 px at every width — no `md:` override shrinks a target on a computer — and no text under 11 px.
 */
// The suite runs from `apps/web`, as `theme.test.ts` assumes.
const DIR = resolve(process.cwd(), 'src/components/features/studia');
const SOURCES = [
  'MyCardsView.tsx',
  'CardGroups.tsx',
  'CardFilters.tsx',
  'CardDetail.tsx',
  'ValidationQueueView.tsx',
  'VoteBar.tsx',
  'ArticleCardsRow.tsx',
  'ArticleCardsPeek.tsx',
];

describe('the targets and the type of «Contribuisci»', () => {
  it.each(SOURCES)('%s keeps its targets at 44 px from `md` up', (file) => {
    const source = readFileSync(join(DIR, file), 'utf8');
    // `md:min-h-0` and its kin are how a target used to drop its 44 px on a computer (a layout's `min-h-0` is not a
    // target): any `md:` minimum or height but 44 px, from a step to an arbitrary value or `auto`.
    expect(source).not.toMatch(/\bmd:(?:min-h|min-w|h)-(?!\[44px\])/);
  });

  it.each(SOURCES)('%s writes no text size under 11 px', (file) => {
    const source = readFileSync(join(DIR, file), 'utf8');
    const sizes = [...source.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map((m) => Number(m[1]));
    expect(sizes.filter((px) => px < 11)).toEqual([]);
  });
});
