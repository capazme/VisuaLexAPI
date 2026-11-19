import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface CommonControlsGuard {
  /** What the guard is about, in the test's name: «Cronologia». */
  name: string;
  /** The folder under `src/`. */
  dir: string;
  /** Files that must be read, so a rename does not empty the guard. */
  expected: string[];
  /** The windows over the content still here (L-73): out of the checks of style, their own PRs bring them into the page. */
  windows?: string[];
  /** Pages that call one of today's windows: listed with the windows, kept in the checks of style. */
  callsAWindow?: string[];
  /** The names of the local «house buttons» that went (LC117). */
  localLooks: string[];
}

/**
 * The rules of LC104–LC116 for one folder (LC117): every control from the common components (a bare one only with its
 * reason on the line above, `bare-button: …`), no local look, `Switch` for on/off, radii of 4 and 8 px, no duration by
 * hand, no new window over the content. The same checks as `forum.guard` and `settings.guard`, written once.
 */
export function guardCommonControls({ name, dir, expected, windows = [], callsAWindow = [], localLooks }: CommonControlsGuard) {
  const DIR = resolve(process.cwd(), 'src', dir);
  const files = (readdirSync(DIR) as string[]).filter((f) => /\.tsx?$/.test(f) && !/\.(test|guard)\.tsx?$/.test(f)).sort();
  const read = (f: string) => readFileSync(join(DIR, f), 'utf8');
  const styled = files.filter((f) => !windows.includes(f) || callsAWindow.includes(f));
  const lines = (f: string, pattern: RegExp) => read(f).split('\n').flatMap((line, at) => (pattern.test(line) ? [`${f}:${at + 1}`] : []));

  describe(`${name}, no bare controls`, () => {
    it('reads its files', () => {
      expect(files).toEqual(expect.arrayContaining(expected));
    });

    it('draws every button with `Button` or `IconButton`, every menu with `Select`, every field with `Input` or `Textarea`', () => {
      const bare = styled.flatMap((f) => {
        const source = read(f).split('\n');
        return source.flatMap((line, at) => {
          if (!/<(button|select|input|textarea|motion\.button)\b/.test(line)) return [];
          return /bare-(button|select|input|textarea): \S/.test(source[at - 1] ?? '') ? [] : [`${f}:${at + 1}: ${line.trim()}`];
        });
      });
      expect(bare).toEqual([]);
    });

    it('keeps no local button or field look of its own', () => {
      const local = new RegExp(`\\b(${localLooks.join('|')})\\b`);
      expect(styled.filter((f) => local.test(read(f)))).toEqual([]);
    });

    it('draws the on/off settings with `Switch`, not a hand-made track', () => {
      expect(styled.filter((f) => /role="switch"/.test(read(f)))).toEqual([]);
    });

    // 4 px for what is pressed or typed in (`CONTROL_RADIUS`), 8 px for what holds things (`CARD_RADIUS`). A mark or a glyph
    // drawn under 4 px (a citation underlined in the text, a file's icon) is drawing, not a box.
    it('rounds its boxes at 8 px and its controls at 4, none at 6, 10 or 14', () => {
      expect(styled.flatMap((f) => lines(f, /\brounded-(t-|b-|l-|r-|tl-|tr-|bl-|br-)?((lg|xl|2xl|3xl)\b|\[(?!([1-3]|4|8)px\]))/))).toEqual([]);
    });

    // The motion tokens (`--dur-*`, `lib/motion.ts`) or the components' own. A notice's time on screen is no motion.
    it('writes no duration by hand', () => {
      expect(styled.flatMap((f) => lines(f, /\bduration-(\d|\[)|\bduration: *(0?\.\d|[1-9]\d{0,2}\b)/))).toEqual([]);
    });

    // L-73: nothing over the content. The windows are today's; no new one comes in.
    it('opens no new window over the content', () => {
      const found = files.filter((f) => /\.tsx$/.test(f) && /(?<!\[)role="dialog"|fixed inset-0|<(Modal|ConfirmDialog|Sheet)\b/.test(read(f)));
      expect(found).toEqual([...windows].sort());
    });
  });
}
