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
