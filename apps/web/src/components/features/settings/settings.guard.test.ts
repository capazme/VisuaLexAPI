import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(process.cwd(), 'src');
const inDir = (dir: string) =>
  (readdirSync(join(SRC, dir)) as string[]).filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)).map((name) => `${dir}/${name}`);
/** Impostazioni, Amministrazione and the admin's parts. Tests apart. */
const files = [...inDir('components/features/settings'), 'pages/AdminPage.tsx', ...inDir('components/features/admin')].sort();
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');
/** The questions over the content still here (L-74: erasing an account, a new version of a text, the courses' switch). */
const WINDOWS = ['components/features/admin/CoursesSwitchAdmin.tsx', 'components/features/admin/StudiaTextsAdmin.tsx', 'pages/AdminPage.tsx'];
const lines = (path: string, pattern: RegExp) => read(path).split('\n').flatMap((line, at) => (pattern.test(line) ? [`${path}:${at + 1}`] : []));

// LC115: Impostazioni and Amministrazione speak the common components' language, as Pratiche (LC106), Opus (LC110),
// Learn (LC112), the reader (LC113) and the Forum (LC114). A bare `<button>`, `<select>`, `<input>` or `<textarea>` stays
// only with its reason written on the line above (`bare-input: …`): a checkbox, a row that is a whole entry.
describe('Impostazioni and Amministrazione, no bare controls', () => {
  it('reads the settings, the admin page and its parts', () => {
    expect(files).toEqual(expect.arrayContaining([
      'components/features/settings/SettingsPage.tsx', 'components/features/settings/AliasSection.tsx',
      'pages/AdminPage.tsx', 'components/features/admin/StudiaTextsAdmin.tsx', 'components/features/admin/StudiaSoglieAdmin.tsx',
    ]));
  });

  it('draws every button with `Button` or `IconButton`, every menu with `Select`, every field with `Input` or `Textarea`', () => {
    const bare = files.flatMap((path) => {
      const source = read(path).split('\n');
      return source.flatMap((line, at) => {
        if (!/<(button|select|input|textarea|motion\.button)\b/.test(line)) return [];
        return /bare-(button|select|input|textarea): \S/.test(source[at - 1] ?? '') ? [] : [`${path}:${at + 1}: ${line.trim()}`];
      });
    });
    expect(bare).toEqual([]);
  });

  it('keeps no local button or field look of its own', () => {
    expect(files.filter((path) => /\b(FIELD|SELECT|LABEL|ICON_BUTTON|INPUT|ACTION)\b/.test(read(path)))).toEqual([]);
  });

  it('draws the on/off settings with `Switch`, not a hand-made track', () => {
    expect(files.filter((path) => /role="switch"/.test(read(path)))).toEqual([]);
  });

  // 4 px for what is pressed or typed in (`CONTROL_RADIUS`), 8 px for what holds things (`CARD_RADIUS`).
  it('rounds its boxes at 8 px and its controls at 4, none at 6, 10 or 16', () => {
    expect(files.flatMap((path) => lines(path, /\brounded-(t-|b-|l-|r-)?(lg|xl|2xl|3xl)\b/))).toEqual([]);
  });

  // The motion tokens (`--dur-*`, `lib/motion.ts`) or the components' own. A notice's time on screen (`duration: 4000`)
  // is no motion.
  it('writes no duration by hand', () => {
    expect(files.flatMap((path) => lines(path, /\bduration-(\d|\[)|\bduration: *(0?\.\d|[1-9]\d{0,2}\b)/))).toEqual([]);
  });

  // L-73: nothing over the content. The questions are today's; no new window comes in.
  it('opens no new window over the content', () => {
    const windows = files.filter((path) => /\.tsx$/.test(path) && /(?<!\[)role="dialog"|fixed inset-0|<(Modal|ConfirmDialog|Sheet)\b/.test(read(path)));
    expect(windows).toEqual(WINDOWS);
  });
});
