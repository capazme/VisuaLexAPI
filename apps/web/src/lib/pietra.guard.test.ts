import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Pietra everywhere (D-156, after Inchiostro's Y1), kept from coming back one file at a time. Colours: an action and the
// focus are `primary-*` (toga, warm ink), the rest `slate-*` (ink, warm grey), a section its tile (`--vlx-section-*`, Work's
// ink for all four since LC16, `theme.test.ts`);
// `blue-*` and `indigo-*` are aliases of toga that only hid where the old blue still stood, `purple-*` and `violet-*`
// hues of no section; and the two scales themselves stay warm and near-grey, so the blue cannot come back by value. Sizes: no
// text under 11 px. Elevation: cards `shadow-sm` or a border, menus and popovers `shadow-md`, windows `shadow-lg`, never
// `xl` or `2xl`. Flat paper: no gradient but the loading skeleton's shimmer.
const src = join(__dirname, '..'); // apps/web/src

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

/** A Tailwind colour utility of a hue that Pietra does not have, with any variant before it. */
const HAND_COLOUR = /\b(?:bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|outline|divide|fill|stroke|from|via|to|shadow|placeholder|accent|caret|decoration)-(blue|indigo|purple|violet)-\d/;

/**
 * The colour keys, where a hue tells one kind from another and the user learns it: each says why. Nothing else may
 * write these hues.
 */
const KEYS: Record<string, string> = {
  [join('components', 'features', 'search', 'caseLaw', 'authorityColor.ts')]:
    'the courts: one colour per authority on every row of case law (the Corte costituzionale is violet)',
  [join('components', 'features', 'bulletin', 'SuggestionItemCard.tsx')]:
    'the kinds of a suggestion\'s items: notes, highlights, dossiers, quick norms, aliases (purple)',
  [join('components', 'features', 'bulletin', 'SuggestContentModal.tsx')]:
    'the same kinds counted before a suggestion is sent: the aliases\' purple',
};

/** Every `file:line` of the sources (outside `allowed`) where `pattern` matches. */
function hits(pattern: RegExp, allowed: string[] = []): string[] {
  return sources(src)
    .map((file) => relative(src, file))
    .filter((file) => !allowed.includes(file))
    .flatMap((file) => readFileSync(join(src, file), 'utf8').split('\n')
      .map((line, i) => (pattern.test(line) ? `${file}:${i + 1}` : null))
      .filter((hit): hit is string => hit !== null));
}

describe('Pietra\'s sizes, elevation and paper', () => {
  it('no text is written under 11 px (in px, as a length, or in rem under 0.6875)', () => {
    expect(hits(/\btext-\[(?:length:)?(?:[0-9]|10)(?:\.\d+)?px\]/)).toEqual([]);
    const smallRem = sources(src).map((file) => relative(src, file)).flatMap((file) =>
      [...readFileSync(join(src, file), 'utf8').matchAll(/\btext-\[(?:length:)?(\d*\.?\d+)rem\]/g)]
        .filter((m) => Number(m[1]) < 11 / 16)
        .map((m) => `${file}: ${m[0]}`));
    expect(smallRem).toEqual([]);
  });

  it('no shadow is `xl` or `2xl`', () => {
    expect(hits(/\bshadow-(?:xl|2xl)\b/)).toEqual([]);
  });

  it('no gradient, but the loading skeleton\'s shimmer', () => {
    expect(hits(/\bbg-(?:gradient|linear|radial|conic)-/, [join('components', 'ui', 'Skeleton.tsx')])).toEqual([]);
    // Nor as an arbitrary value, but the comparison's hatch where a side has no comma (a sign, not a shade).
    expect(hits(/\bbg-\[[^\]]*gradient/, [join('components', 'features', 'compare', 'compareParts.tsx')])).toEqual([]);
  });
});

describe('Pietra\'s colours', () => {
  it('no file writes blue, indigo, purple or violet by hand, outside the colour keys', () => {
    expect(hits(HAND_COLOUR, Object.keys(KEYS))).toEqual([]);
  });

  it('the stylesheet\'s `@apply` writes none of them either', () => {
    const css = readFileSync(join(src, 'index.css'), 'utf8').split('\n');
    const applied = css.map((line, i) => (/@apply\b/.test(line) && HAND_COLOUR.test(line) ? `index.css:${i + 1}` : null)).filter(Boolean);
    expect(applied).toEqual([]);
  });

  it('every colour key still uses its hue: a key that no longer needs it leaves the list', () => {
    const stale = Object.keys(KEYS).filter((file) => !HAND_COLOUR.test(readFileSync(join(src, file), 'utf8')));
    expect(stale).toEqual([]);
  });

  // LC17 (A8): in the dark a filled action is light ink with dark text, as «Inizia una ricerca»; the mid grey with
  // white text reads as disabled. The shared bases first: each line that fills with `bg-primary-600` says so.
  it('the shared bases of a filled action are light ink in the dark', () => {
    const bases = [
      join('features', 'merlt', 'hub', 'hubStyles.ts'),
      join('components', 'features', 'search', 'NoteEditBox.tsx'),
      join('components', 'features', 'search', 'AnnexSuggestion.tsx'),
      join('components', 'ui', 'AdvancedExportModal.tsx'),
      join('features', 'merlt', 'graph', 'page', 'AskGraphField.tsx'),
      join('components', 'features', 'dossier', 'dossierStyles.ts'),
    ];
    const grey = bases.flatMap((file) => readFileSync(join(src, file), 'utf8').split('\n')
      .map((line, i) => (/\bbg-primary-600\b/.test(line) && !['dark:bg-toga-400', 'dark:hover:bg-toga-300', 'dark:text-ink-950'].every((c) => line.includes(c)) ? `${file}:${i + 1}` : null))
      .filter(Boolean));
    expect(grey).toEqual([]);
  });

  // LC19: disabled, a filled action is a dull grey slab with dimmed text in the dark (`slate-400` on `slate-700`, 4.73:1),
  // the same everywhere; the light action made transparent read as nearly active. Every line that fills with the light ink
  // and has a disabled state says so, and with `opacity-100` where that state also fades it; the shared bases whose
  // disabled state comes from a constant (`DISABLED`) say it on their fill line.
  it('a disabled filled action is a grey slab with dimmed text in the dark', () => {
    const LIGHT_INK = /dark:bg-toga-400\b|dark:bg-primary-400\b|\$\{INK_BG\}/;
    const SLAB = ['dark:disabled:bg-slate-700', 'dark:disabled:text-slate-400'];
    const bases = [
      join('components', 'ui', 'buttonStyles.ts'),
      join('components', 'ui', 'IconButton.tsx'),
      join('components', 'ui', 'FeedbackModal.tsx'),
      join('components', 'ui', 'AdvancedExportModal.tsx'),
    ];
    const off = sources(src).map((file) => relative(src, file)).flatMap((file) => readFileSync(join(src, file), 'utf8').split('\n')
      .map((line, i) => {
        if (!LIGHT_INK.test(line) || /^\s*(\/\/|\*)/.test(line)) return null;
        // A chosen option (`? '…'`) is no action.
        if (/^\s*\?\s*['"`]/.test(line)) return null;
        if (!/\bdisabled:/.test(line) && !bases.includes(file)) return null;
        const needs = /\bdisabled:opacity-/.test(line) || bases.includes(file) ? [...SLAB, 'dark:disabled:opacity-100'] : SLAB;
        return needs.every((c) => line.includes(c)) ? null : `${file}:${i + 1}`;
      })
      .filter(Boolean));
    expect(off).toEqual([]);
  });

  // LC19: the chosen option of a group of filters or tabs has one look in the dark, the light ink with dark text
  // (`dark:bg-toga-400 dark:text-ink-950`, LC17), not a grey or tinted fill nor an outline. These groups had another.
  // Left on purpose, and not listed: page tabs marked by a line under them, single toggles, cards to choose from, the
  // highlighted row of a list.
  it('the chosen option of these groups is the light ink in the dark', () => {
    const groups = [
      join('components', 'ui', 'SettingsModal.tsx'),
      join('components', 'ui', 'AdvancedExportModal.tsx'),
      join('components', 'features', 'planner', 'OpusPage.tsx'),
      join('components', 'features', 'search', 'FindWindow.tsx'),
      join('components', 'features', 'search', 'QuickNormsManager.tsx'),
      join('components', 'features', 'search', 'NotesPeekPanel.tsx'),
      join('components', 'features', 'search', 'MoveProposalBar.tsx'),
      join('components', 'features', 'compare', 'CompareView.tsx'),
      join('components', 'features', 'compare', 'CompareBody.tsx'),
      join('components', 'features', 'rassegne', 'RassegnePanel.tsx'),
      join('features', 'merlt', 'graph', 'page', 'AskGraphField.tsx'),
      join('features', 'merlt', 'qa', 'QaDeliberationPanel.tsx'),
    ];
    // A chosen branch (`? '…'`, or `x === y ? '…'` on one line) whose dark fill is a grey or a tint.
    const OTHER = /\?\s*['"`][^'"`]*\bdark:bg-(?:slate-(?:600|700|900)|primary-9[05]0)\b/;
    const other = groups.flatMap((file) => readFileSync(join(src, file), 'utf8').split('\n')
      .map((line, i) => (OTHER.test(line) ? `${file}:${i + 1}` : null))
      .filter(Boolean));
    expect(other).toEqual([]);
  });
});

describe('Pietra\'s scales', () => {
  // Every value `index.css` gives a step of ink or toga, the light ones in `@theme` and the dark ones in `.dark`. The
  // values set (D-156) have a hue of 67.6–91.5 and a chroma of 0.019 at most; the bounds leave a small margin. A
  // step with no chroma (white) has no hue to check.
  const steps = [...readFileSync(join(src, 'index.css'), 'utf8')
    .matchAll(/--color-(ink|toga)-(\d+):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/g)]
    .map((m) => ({ step: `${m[1]}-${m[2]}`, chroma: Number(m[4]), hue: Number(m[5]) }));

  it('reads every step of both scales', () => {
    for (const scale of ['ink', 'toga']) {
      for (const n of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) {
        expect(steps.map((s) => s.step), `${scale}-${n}`).toContain(`${scale}-${n}`);
      }
    }
  });

  it('keeps ink and toga warm and near-grey, so no step turns blue again', () => {
    const cold = steps.filter((s) => s.chroma > 0.025 || (s.chroma > 0.001 && (s.hue < 60 || s.hue > 100)));
    expect(cold).toEqual([]);
  });
});
