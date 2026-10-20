import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { ACTIVE, FOCUS_RING, HIDDEN_SCROLLBAR, HOVER_LIFT, TRANSITION } from './constants/interactions';
import { subjectHue } from './components/features/studia/progress/tokens';
import { MATERIA_LABEL } from './components/features/studia/studiaLabels';
import type { Materia } from './types/studia';

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

describe('the Inchiostro palette', () => {
  it('aliases the Tailwind scales the app writes to ink and toga', async () => {
    const css = await compile(['bg-ink-500', 'bg-toga-600', 'text-slate-500', 'bg-blue-600', 'ring-indigo-500', 'bg-primary-600']);
    expect(css).toContain('.bg-ink-500');
    expect(css).toContain('.bg-toga-600');
    expect(css).toMatch(/--color-slate-500:\s*var\(--color-ink-500\)/);
    expect(css).toMatch(/--color-blue-600:\s*var\(--color-toga-600\)/);
    expect(css).toMatch(/--color-indigo-500:\s*var\(--color-toga-500\)/);
    expect(css).toMatch(/--color-primary-600:\s*var\(--color-toga-600\)/);
  }, 30000);

  it('keeps the contrast of the pairs the app relies on (WCAG 2, from the values in index.css)', () => {
    const source = readFileSync(CSS_PATH, 'utf8');
    const rgb = (name: string): number[] => {
      const m = source.match(new RegExp(`--color-${name}:\\s*oklch\\(([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\)`));
      if (!m) throw new Error(`--color-${name} not found`);
      const [L, C, H] = [Number(m[1]) / 100, Number(m[2]), (Number(m[3]) * Math.PI) / 180];
      const a = C * Math.cos(H), b = C * Math.sin(H);
      const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
      const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
      const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
      return [
        4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
      ].map((v) => Math.min(1, Math.max(0, v)));
    };
    // linear-light sRGB is what OKLab gives back, so luminance needs no gamma step
    const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const ratio = (x: number[], y: number[]) => {
      const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p);
      return (hi + 0.05) / (lo + 0.05);
    };
    const white = [1, 1, 1];
    expect(ratio(rgb('ink-900'), rgb('ink-50'))).toBeGreaterThanOrEqual(15);
    expect(ratio(rgb('ink-600'), rgb('ink-50'))).toBeGreaterThanOrEqual(6.5);
    expect(ratio(rgb('ink-500'), rgb('ink-50'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(rgb('toga-600'), rgb('ink-50'))).toBeGreaterThanOrEqual(6);
    expect(ratio(white, rgb('toga-600'))).toBeGreaterThanOrEqual(6);
    expect(ratio(rgb('ink-400'), rgb('ink-950'))).toBeGreaterThanOrEqual(7);
    expect(ratio(rgb('toga-400'), rgb('ink-950'))).toBeGreaterThanOrEqual(6.5);
  });

  it('keeps the sidebar\'s 11 px texts at AA on its glass, over the page and over the phone\'s backdrop', () => {
    // `SIDEBAR_SMALL_TEXT` (Sidebar.tsx): slate 600 in light, slate 400 in dark (slate is ink). The aside is
    // white/80 (dark: slate-900/80) over the page (slate-50 / slate-950) or, as the phone's drawer, over the
    // backdrop slate-900/50. Browsers composite in gamma sRGB.
    const source = readFileSync(CSS_PATH, 'utf8');
    const linear = (name: string): number[] => {
      const m = source.match(new RegExp(`--color-${name}:\\s*oklch\\(([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\)`));
      if (!m) throw new Error(`--color-${name} not found`);
      const [L, C, H] = [Number(m[1]) / 100, Number(m[2]), (Number(m[3]) * Math.PI) / 180];
      const a = C * Math.cos(H), b = C * Math.sin(H);
      const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
      const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
      const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
      return [
        4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
      ].map((v) => Math.min(1, Math.max(0, v)));
    };
    const gamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
    const unGamma = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const over = (fg: number[], alpha: number, bg: number[]) => fg.map((c, i) => unGamma(alpha * gamma(c) + (1 - alpha) * gamma(bg[i])));
    const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const ratio = (x: number[], y: number[]) => {
      const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p);
      return (hi + 0.05) / (lo + 0.05);
    };
    const backdrop = (page: number[]) => over(linear('ink-900'), 0.5, page);
    const light = [linear('ink-50'), backdrop(linear('ink-50'))].map((under) => over([1, 1, 1], 0.8, under));
    const dark = [linear('ink-950'), backdrop(linear('ink-950'))].map((under) => over(linear('ink-900'), 0.8, under));
    for (const bg of light) expect(ratio(linear('ink-600'), bg)).toBeGreaterThanOrEqual(4.5);
    for (const bg of dark) expect(ratio(linear('ink-400'), bg)).toBeGreaterThanOrEqual(4.5);
    // `SIDEBAR_TOGGLE_TEXT`, the narrow/widen control (desktop only, so over the page): the entries' words' colour.
    expect(ratio(linear('ink-700'), light[0])).toBeGreaterThanOrEqual(7);
    expect(ratio(linear('ink-300'), dark[0])).toBeGreaterThanOrEqual(7);
  });

  it('keeps the user menu\'s services status at AA, and its dot at 3:1 on the bar (ServiceHealthMenuEntry)', () => {
    // Amber and emerald are Tailwind's own scales, read from its theme; the menu is white (dark: slate 800), the
    // bar white/80 over the page (dark: slate-900/80 over slate-950). The dot's white (dark: slate 900) ring
    // keeps it apart from the avatar.
    const source = readFileSync(CSS_PATH, 'utf8') + readFileSync(resolve(process.cwd(), 'node_modules/tailwindcss/theme.css'), 'utf8');
    const linear = (name: string): number[] => {
      const m = source.match(new RegExp(`--color-${name}:\\s*oklch\\(([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\)`));
      if (!m) throw new Error(`--color-${name} not found`);
      const [L, C, H] = [Number(m[1]) / 100, Number(m[2]), (Number(m[3]) * Math.PI) / 180];
      const a = C * Math.cos(H), b = C * Math.sin(H);
      const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
      const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
      const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
      return [
        4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
      ].map((v) => Math.min(1, Math.max(0, v)));
    };
    const gamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
    const unGamma = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const over = (fg: number[], alpha: number, bg: number[]) => fg.map((c, i) => unGamma(alpha * gamma(c) + (1 - alpha) * gamma(bg[i])));
    const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const ratio = (x: number[], y: number[]) => {
      const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p);
      return (hi + 0.05) / (lo + 0.05);
    };
    const white = [1, 1, 1];
    const menuDark = linear('ink-800');
    // A service's state: OK, Degradato or Offline, Controllo; its name; «Ricontrolla».
    for (const fg of ['emerald-700', 'amber-700', 'ink-500', 'ink-600', 'toga-700']) expect(ratio(linear(fg), white), fg).toBeGreaterThanOrEqual(4.5);
    for (const fg of ['emerald-400', 'amber-400', 'ink-400', 'ink-300', 'toga-300']) expect(ratio(linear(fg), menuDark), fg).toBeGreaterThanOrEqual(4.5);
    // The entry's icon beside its phrase, and the dot on the user button.
    for (const fg of ['emerald-600', 'amber-600']) expect(ratio(linear(fg), white), fg).toBeGreaterThanOrEqual(3);
    expect(ratio(linear('amber-600'), over(white, 0.8, linear('ink-50')))).toBeGreaterThanOrEqual(3);
    expect(ratio(linear('amber-400'), over(linear('ink-900'), 0.8, linear('ink-950')))).toBeGreaterThanOrEqual(3);
  });

  it('keeps the marks and labels of Gymnasium\'s «Progressi» apart from what they sit on (ActivityCalendar, DueForecast)', () => {
    const source = readFileSync(CSS_PATH, 'utf8') + readFileSync(resolve(process.cwd(), 'node_modules/tailwindcss/theme.css'), 'utf8');
    // `primary-*` and `slate-*` are aliases (`var(--color-toga-*)`, `var(--color-ink-*)`): followed to the value.
    const linear = (name: string): number[] => {
      const alias = source.match(new RegExp(`--color-${name}:\\s*var\\(--color-([a-z0-9-]+)\\)`));
      if (alias) return linear(alias[1]);
      const m = source.match(new RegExp(`--color-${name}:\\s*oklch\\(([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\)`));
      if (!m) throw new Error(`--color-${name} not found`);
      const [L, C, H] = [Number(m[1]) / 100, Number(m[2]), (Number(m[3]) * Math.PI) / 180];
      const a = C * Math.cos(H), b = C * Math.sin(H);
      const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
      const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
      const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
      return [
        4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
      ].map((v) => Math.min(1, Math.max(0, v)));
    };
    const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const ratio = (x: number[], y: number[]) => {
      const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p);
      return (hi + 0.05) / (lo + 0.05);
    };
    const white = [1, 1, 1];
    // A day's mark (the dot, the dash) is ink on the calendar's pale steps (HEAT_FILL 0–2) and the ground's colour on
    // the deep ones (3–4): 3:1, a graphic that carries the day's state (WCAG 1.4.11).
    for (const step of ['ink-100', 'primary-200', 'primary-400']) expect(ratio(linear('primary-900'), linear(step)), step).toBeGreaterThanOrEqual(3);
    for (const step of ['primary-600', 'primary-900']) expect(ratio(white, linear(step)), step).toBeGreaterThanOrEqual(3);
    for (const step of ['ink-800', 'primary-900', 'primary-700']) expect(ratio(linear('primary-300'), linear(step)), step).toBeGreaterThanOrEqual(3);
    // On a subject's hue the ink mark sits on a rim of the tile's ground (white; dark: slate 900), whatever the hue.
    expect(ratio(linear('primary-900'), white)).toBeGreaterThanOrEqual(3);
    expect(ratio(linear('primary-300'), linear('ink-900'))).toBeGreaterThanOrEqual(3);
    for (const step of ['primary-500', 'primary-300']) expect(ratio(linear('ink-900'), linear(step)), step).toBeGreaterThanOrEqual(3);
    // The days to come and a day with nothing due, dotted on the tile (white; dark: slate 900).
    expect(ratio(linear('ink-500'), white)).toBeGreaterThanOrEqual(3);
    expect(ratio(linear('ink-400'), linear('ink-900'))).toBeGreaterThanOrEqual(3);
    // Today's bar on its tinted column (amber 50; dark: amber 400 at 10% over slate 900, far apart).
    expect(ratio(linear('amber-600'), linear('amber-50'))).toBeGreaterThanOrEqual(3);
    // «oggi» under the coming days, at 12 px: AA.
    expect(ratio(linear('amber-800'), white)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(linear('amber-300'), linear('ink-900'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the entrance utilities', () => {
  it('turn animate-in, fade-in, zoom-in-N and slide-in-from-* into real rules', async () => {
    const css = await compile(['animate-in', 'fade-in', 'fade-in-0', 'zoom-in-95', 'slide-in-from-bottom', 'slide-in-from-top-2', 'slide-in-from-right-10', 'slide-in-from-left-2']);
    expect(css).toMatch(/\.animate-in\s*\{[^}]*animation-name:/);
    // A finished entrance leaves nothing applied (gotcha 22): no «both» fill.
    expect(css).toMatch(/\.animate-in\s*\{[^}]*animation-fill-mode:\s*backwards/);
    expect(css).toMatch(/\.fade-in\s*\{[^}]*--vlx-fade:\s*vlx-enter-fade/);
    expect(css).toMatch(/\.zoom-in-95\s*\{[^}]*--vlx-enter-scale:\s*calc\(95 \* 1%\)/);
    expect(css).toContain('.slide-in-from-bottom');
    expect(css).toContain('.slide-in-from-top-2');
    expect(css).toContain('.slide-in-from-right-10');
    expect(css).toMatch(/\.slide-in-from-left-2\s*\{[^}]*--vlx-enter-x:\s*calc\(2 \* var\(--spacing\) \* -1\)/);
    // Both axes, so a slide nested in another does not inherit the outer one's axis.
    expect(css).toMatch(/\.slide-in-from-top-2\s*\{[^}]*--vlx-enter-x:\s*0/);
  }, 30000);

  it('never last past 200 ms, whatever duration the class writes', async () => {
    const css = await compile(['animate-in', 'duration-300']);
    expect(css).toMatch(/\.animate-in\s*\{[^}]*animation-duration:\s*min\(var\(--tw-duration,\s*180ms\),\s*200ms\)/);
  }, 30000);
});

describe('the lesson of Gymnasium (Gymnasium spec §5.4)', () => {
  it('draws the note after a grade, the bar\'s safe edge, the side panel and the band its classes name', async () => {
    const candidates = [
      'motion-safe:animate-vlx-note',
      'motion-safe:transition-[width]',
      'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
      'pt-[max(0.5rem,env(safe-area-inset-top))]',
      'w-[min(28rem,45%)]',
      'min-h-8',
      'border-current/40',
      'z-[70]',
    ];
    const css = await compile(candidates);
    expect(css).toMatch(/\.motion-safe\\:animate-vlx-note\s*\{\s*@media \(prefers-reduced-motion: no-preference\)\s*\{\s*animation: var\(--animate-vlx-note\)/);
    expect(css).toMatch(/--animate-vlx-note:\s*vlx-note 1000ms/);
    expect(css).toMatch(/@keyframes vlx-note/);
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toContain('env(safe-area-inset-top)');
    expect(css).toMatch(/width:\s*min\(28rem,\s*45%\)/);
    expect(css).toMatch(/\.min-h-8\s*\{/);
    expect(css).toMatch(/\.border-current\\\/40\s*\{/);
    expect(css).toMatch(/z-index:\s*70/);
  }, 30000);
});

describe('the hues of Gymnasium\'s subjects', () => {
  it('each names a variable the stylesheet declares in the light theme and in the dark one', () => {
    // An undeclared variable leaves `hsl(var(--x))` invalid: the chip and the bar draw no colour, silently.
    const source = readFileSync(CSS_PATH, 'utf8');
    for (const materia of Object.keys(MATERIA_LABEL) as Materia[]) {
      const name = /var\((--[\w-]+)\)/.exec(subjectHue(materia))?.[1];
      expect(name, materia).toBeDefined();
      expect(source.match(new RegExp(`${name}:`, 'g')) ?? [], `${materia}: ${name}`).toHaveLength(2);
    }
  });
});

describe('the interaction constants', () => {
  it('move what TRANSITION names, scale and translate included, and never the focus ring', async () => {
    const [property] = TRANSITION.split(' ');
    const css = await compile([property]);
    // The selector as Tailwind escapes it: `[`, `]` and `,` behind a backslash.
    const selector = '.' + property.replace(/[[\],]/g, (c) => `\\${c}`);
    const rule = css.split(`${selector} {`)[1]?.split('}')[0] ?? '';
    // Tailwind v4's scale-* and translate-* write the `scale` and `translate` properties, not `transform`.
    expect(rule).toMatch(/transition-property:[^;]*\btranslate\b[^;]*\bscale\b/);
    expect(rule).not.toMatch(/box-shadow|\ball\b/);
  }, 30000);

  it('press with scale, lift on a fine pointer only, and ring in toga on the paper', async () => {
    const css = await compile([ACTIVE, HOVER_LIFT, ...FOCUS_RING.split(' ')]);
    expect(css).toMatch(/\.active\\:scale-\\\[0\\\.97\\\][^{]*\{\s*&:active\s*\{\s*scale:\s*0\.97/);
    expect(css).toMatch(/pointer\\:fine\\\)\\\]\\:hover\\:-translate-y-px\s*\{\s*@media \(hover:hover\) and \(pointer:fine\)/);
    expect(css).toContain('.focus-visible\\:ring-toga-500');
    expect(css).toContain('.focus-visible\\:ring-offset-background');
  }, 30000);
});

// The services pill, which started after the sidebar, went into the user menu (S1); `Layout` still sets the width.
describe('what would float beside the sidebar', () => {
  it('reads the sidebar\'s drawn width from `--sidebar-width`, 64 px by default', async () => {
    const css = await compile(['lg:left-[calc(var(--sidebar-width,64px)+2rem)]']);
    expect(css).toMatch(/left:\s*calc\(var\(--sidebar-width,\s*64px\) \+ 2rem\)/);
  }, 30000);
});

describe('the scrollbars in dark mode', () => {
  it('give the thumb its dark colour through a selector the browser keeps', async () => {
    const css = await compile([]);
    // `dark:` inside a pseudo-element's rule nests `&:where(.dark, .dark *)` after it, which is invalid.
    expect(css).not.toMatch(/::-webkit-scrollbar[\w-]*(:hover)?\s*\{[^}]*&:where/);
    expect(css).toMatch(/:where\(\.dark, \.dark \*\)::-webkit-scrollbar-thumb\s*\{[^}]*var\(--color-slate-700\)/);
    expect(css).toMatch(/:where\(\.dark, \.dark \*\)::-webkit-scrollbar-thumb:hover\s*\{[^}]*var\(--color-slate-600\)/);
  }, 30000);

  it('draws no bar where HIDDEN_SCROLLBAR says so, in both engines (the subject chips\' row)', async () => {
    const css = await compile(HIDDEN_SCROLLBAR.split(' '));
    expect(css).toMatch(/\.\\\[scrollbar-width\\:none\\\]\s*\{\s*scrollbar-width:\s*none/);
    expect(css).toMatch(/\.\\\[\\&\\:\\:-webkit-scrollbar\\\]\\:hidden\s*\{\s*&::-webkit-scrollbar\s*\{\s*display:\s*none/);
  }, 30000);
});
