import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Inchiostro's colours (Y1), kept from coming back one file at a time: an action and the focus are `primary-*` (toga),
// the rest `slate-*` (ink), a section its hue (`--vlx-section-*`). `blue-*` and `indigo-*` are aliases of toga that
// only hid where the old blue still stood; `purple-*` and `violet-*` are hues of no section.
const src = join(__dirname, '..'); // apps/web/src

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

/** A Tailwind colour utility of a hue that Inchiostro does not have, with any variant before it. */
const HAND_COLOUR = /\b(?:bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|outline|divide|fill|stroke|from|via|to|shadow|placeholder|accent|caret|decoration)-(blue|indigo|purple|violet)-\d/;

/**
 * The colour keys, where a hue tells one kind from another and the user learns it: each says why. Nothing else may
 * write these hues.
 */
const KEYS: Record<string, string> = {
  [join('components', 'features', 'search', 'caseLaw', 'authorityColor.ts')]:
    'the courts: one colour per authority on every row of case law (the Corte costituzionale is violet)',
  [join('components', 'features', 'bulletin', 'SharedEnvironmentCard.tsx')]:
    'the Forum\'s categories: one colour per category, the card\'s stripe and its label',
  [join('components', 'features', 'bulletin', 'SuggestionItemCard.tsx')]:
    'the kinds of a suggestion\'s items: notes, highlights, dossiers, quick norms, aliases (purple)',
  [join('components', 'features', 'bulletin', 'SuggestContentModal.tsx')]:
    'the same kinds counted before a suggestion is sent: the aliases\' purple',
};

describe('Inchiostro\'s colours', () => {
  it('no file writes blue, indigo, purple or violet by hand, outside the colour keys', () => {
    const offenders = sources(src)
      .map((file) => relative(src, file))
      .filter((file) => !(file in KEYS))
      .flatMap((file) => readFileSync(join(src, file), 'utf8').split('\n')
        .map((line, i) => (HAND_COLOUR.test(line) ? `${file}:${i + 1}` : null))
        .filter((hit): hit is string => hit !== null));
    expect(offenders).toEqual([]);
  });

  it('every colour key still uses its hue: a key that no longer needs it leaves the list', () => {
    const stale = Object.keys(KEYS).filter((file) => !HAND_COLOUR.test(readFileSync(join(src, file), 'utf8')));
    expect(stale).toEqual([]);
  });
});
