import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The planner (Opus, wave 1) is drawn in Gymnasium's style: every control 44 px at every width — no `md:` override
 * shrinks a target on a computer — no text under 11 px, and no word that suggests a computed deadline (the deadline is
 * the one the user writes; «termine calcolato» comes with wave 2 and its warning).
 */
// The suite runs from `apps/web`, as `theme.test.ts` assumes.
const DIR = resolve(process.cwd(), 'src/components/features/planner');
const SOURCES = readdirSync(DIR).filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));

describe("the planner's targets, type and words", () => {
  it('reads its files', () => {
    expect(SOURCES).toEqual(expect.arrayContaining(['TaskRow.tsx', 'QuickAddField.tsx', 'TaskDialog.tsx', 'OpusViews.tsx', 'plannerStyles.ts']));
  });

  it.each(SOURCES)('%s keeps its targets at 44 px from `md` up', (file) => {
    const source = readFileSync(join(DIR, file), 'utf8');
    expect(source).not.toMatch(/\bmd:(?:min-h|min-w|h)-(?!\[44px\])/);
  });

  it.each(SOURCES)('%s writes no text size under 11 px', (file) => {
    const source = readFileSync(join(DIR, file), 'utf8');
    const sizes = [...source.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map((m) => Number(m[1]));
    expect(sizes.filter((px) => px < 11)).toEqual([]);
  });

  it.each(SOURCES)('%s says nothing of a computed deadline', (file) => {
    // Comments may explain that nothing computes one; the strings shown to the user may not hint at it.
    const strings = [...readFileSync(join(DIR, file), 'utf8').matchAll(/(['"`»>])([^'"`<\n]*)\1?/g)].map((m) => m[2]);
    expect(strings.filter((text) => /calcolat|calcola il|automaticamente/i.test(text))).toEqual([]);
  });
});
