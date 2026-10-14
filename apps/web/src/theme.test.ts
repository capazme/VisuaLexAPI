import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

/**
 * Tailwind failures are silent: a class whose token the theme never declares
 * generates no CSS, and nothing — not the build, not the linter — says so. That
 * is how `primary-<number>` came to be written 568 times while drawing nothing
 * (tailwind.config.js is a v3-style config, and v4 never loads it without an
 * `@config` directive). These tests compile the real stylesheet and assert the
 * tokens the app spends its classes on actually resolve.
 */
// vitest runs with the frontend package as its root.
const CSS_PATH = resolve(process.cwd(), 'src/index.css');

async function compile(candidates: string[]): Promise<string> {
  const source = `${readFileSync(CSS_PATH, 'utf8')}\n@source inline("${candidates.join(' ')}");\n`;
  const { css } = await postcss([tailwind()]).process(source, { from: CSS_PATH });
  return css;
}

describe('the primary colour scale', () => {
  it('gives every step used by the app a real colour', async () => {
    const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
    const css = await compile(steps.map((s) => `bg-primary-${s}`));

    for (const step of steps) {
      expect(css, `bg-primary-${step} generated no rule`).toContain(`.bg-primary-${step}`);
    }
  }, 30000);

  it('still resolves the unnumbered primary token, which 213 classes rely on', async () => {
    const css = await compile(['bg-primary', 'ring-ring', 'bg-background']);

    expect(css).toContain('.bg-primary');
    expect(css).toContain('.ring-ring');
    expect(css).toContain('.bg-background');
  }, 30000);
});

describe('the reading surface', () => {
  it('compiles the sign rules and the container query that moves them to the margin', async () => {
    const css = await compile(['block']);
    // Room for a sign with notes, four dots and discussions (~7rem) on each side of the 68ch column.
    expect(css).toMatch(/@container\s+vlx-frame\s*\(min-width:\s*calc\(68ch \+ 14rem\)\)/);
    expect(css).toContain('.vlx-sign-dot[data-color="yellow"]');
    expect(css).toContain('.vlx-sign-threads');
    expect(css).toContain('.vlx-thread-focus');
    expect(css).toContain('.vlx-flash');
  }, 30000);

  it('gives the labels of a decision their colour in the light theme and in the dark one', async () => {
    // A `dark:` utility inside a `::before` rule is dropped by the compiler without a word (its
    // selector would end `::before:where(...)`), so the dark colour is a rule of its own.
    const css = await compile(['block']);
    expect(css).toMatch(/\.vlx-decision \.vlx-dec-block::?before\s*\{[^}]*\bcolor:\s*var\(--color-slate-500\)/);
    expect(css).toMatch(/\.dark \.vlx-decision \.vlx-dec-block::?before\s*\{[^}]*\bcolor:\s*var\(--color-slate-400\)/);
  }, 30000);

  it('draws a decision\'s key passages and their labels in both themes, and hides them with the switch', async () => {
    const css = await compile(['block']);
    expect(css).toMatch(/\.vlx-decision \.vlx-key-passage\s*\{[^}]*background-image:\s*linear-gradient/);
    expect(css).toMatch(/\.dark \.vlx-decision \.vlx-key-passage\s*\{[^}]*--key-passage:/);
    expect(css).toMatch(/\.vlx-decision \.vlx-key-head::?before\s*\{[^}]*content:\s*attr\(data-key-label\)/);
    expect(css).toMatch(/\.dark \.vlx-decision \.vlx-key-head::?before\s*\{[^}]*\bcolor:/);
    expect(css).toMatch(/\.key-passages-hidden \.vlx-key-passage\s*\{[^}]*background-image:\s*none/);
    expect(css).toMatch(/\.key-passages-hidden \.vlx-key-head::?before\s*\{[^}]*content:\s*none/);
    // under a highlight (a passage the reader made theirs) it loses its underline and its label
    expect(css).toMatch(/\.vlx-decision \.highlight-mark \.vlx-key-passage\s*\{[^}]*background-image:\s*none/);
    expect(css).toMatch(/\.vlx-decision \.highlight-mark \.vlx-key-head::?before\s*\{[^}]*content:\s*none/);
    // and back with the highlights hidden
    expect(css).toMatch(/\.vlx-decision\.highlights-hidden:not\(\.key-passages-hidden\) \.highlight-mark \.vlx-key-head::?before\s*\{[^}]*content:\s*attr\(data-key-label\)/);
  }, 30000);
});

describe('the page height', () => {
  it('is the dynamic viewport height with 100vh as the fallback declaration before it', async () => {
    const css = await compile(['h-app']);
    expect(css).toMatch(/\.h-app\s*\{\s*height:\s*100vh;\s*height:\s*100dvh;?\s*\}/);
  }, 30000);
});

describe('the practice row\'s columns', () => {
  it('are the page height less the 4 rem of Layout\'s content padding and the search page\'s field, in dynamic viewport units with a 100vh fallback', async () => {
    const css = await compile(['h-app-row']);
    expect(css).toMatch(/\.h-app-row\s*\{\s*height:\s*calc\(100vh - 4rem - var\(--search-bar-height, 0px\)\);\s*height:\s*calc\(100dvh - 4rem - var\(--search-bar-height, 0px\)\);?\s*\}/);
  }, 30000);
});
