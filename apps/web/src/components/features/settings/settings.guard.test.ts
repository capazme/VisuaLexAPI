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

// LC115: Impostazioni and Amministrazione speak the common components' language, as Pratiche (LC106), Opus (LC110),
// Learn (LC112), the reader (LC113) and the Forum (LC114). A bare `<button>`, `<select>`, `<input>` or `<textarea>` stays
// only with its reason written on the line above (`bare-input: …`): a checkbox, a row that is a whole entry.
describe('Impostazioni and Amministrazione, the common components', () => {
  it('reads the settings, the admin page and its parts', () => {
    expect(files).toEqual(expect.arrayContaining([
      'components/features/settings/SettingsPage.tsx', 'components/features/settings/AliasSection.tsx',
      'pages/AdminPage.tsx', 'components/features/admin/StudiaTextsAdmin.tsx', 'components/features/admin/StudiaSoglieAdmin.tsx',
    ]));
  });
  it('keeps no local button or field look of its own', () => {
    expect(files.filter((path) => /\b(FIELD|SELECT|LABEL|ICON_BUTTON|INPUT|ACTION)\b/.test(read(path)))).toEqual([]);
  });

  it('draws the on/off settings with `Switch`, not a hand-made track', () => {
    expect(files.filter((path) => /role="switch"/.test(read(path)))).toEqual([]);
  });

  // L-73: nothing over the content. The questions are today's; no new window comes in.
  it('opens no new window over the content', () => {
    const windows = files.filter((path) => /\.tsx$/.test(path) && /(?<!\[)role="dialog"|fixed inset-0|<(Modal|ConfirmDialog|Sheet)\b/.test(read(path)));
    expect(windows).toEqual(WINDOWS);
  });
});
