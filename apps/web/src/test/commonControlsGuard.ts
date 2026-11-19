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

export type StyleRule = 'bare' | 'radius' | 'duration';
export interface StyleViolation { rule: StyleRule; line: number; text: string }

const BARE_TAG = /<(button|select|input|textarea|motion\.button)\b/;
/** A bare input of these types draws no field: nothing to hand to `Input`. */
const FREE_INPUT = /\btype="(checkbox|radio|file|hidden)"/;
// 4 px for what is pressed or typed in (`CONTROL_RADIUS`), 8 px for what holds things (`CARD_RADIUS`). A mark or a glyph
// drawn under 4 px (a citation underlined in the text, a file's icon) is drawing, not a box.
const OFF_RADIUS = /\brounded-(t-|b-|l-|r-|s-|e-|tl-|tr-|bl-|br-|ss-|se-|es-|ee-)?((lg|xl|2xl|3xl)\b|\[(?!([1-3]|4|8)px\]))/;
// The motion tokens (`--dur-*`, `lib/motion.ts`) or the components' own. A notice's time on screen is no motion.
const HAND_DURATION = /\bduration-(\d|\[)|\bduration: *(0?\.\d|[1-9]\d{0,2}\b)/;

/** An `<input …>` tag from where it opens to its `>`, braces skipped, so an arrow in a handler does not close it. */
function tagFrom(source: string[], at: number, column: number): string {
  const text = source.slice(at, at + 40).join('\n').slice(column);
  let depth = 0;
  for (let i = 1; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
    else if (text[i] === '>' && depth === 0) return text.slice(0, i + 1);
  }
  return text;
}

/**
 * The app's rules of style for one source (LC118), `path` from `src/`: no bare `<button>`, `<select>`, `<input>` (but a
 * checkbox, a radio, a file or a hidden one) or `<textarea>` outside `components/ui`, unless the line above gives its
 * reason (`bare-button: …`); radii of 4 and 8 px only; no duration by hand outside `lib/motion.ts`. Comments apart.
 */
export function styleViolations(path: string, text: string): StyleViolation[] {
  const source = text.split('\n');
  const common = path.startsWith('components/ui/');
  let inBlock = false;
  return source.flatMap((line, at): StyleViolation[] => {
    const trimmed = line.trim();
    if (inBlock) { inBlock = !trimmed.includes('*/'); return []; }
    if (/^\{?\/\*/.test(trimmed)) { inBlock = !trimmed.includes('*/'); return []; }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return [];
    const found: StyleViolation[] = [];
    const tag = BARE_TAG.exec(line);
    if (tag && !common && !/bare-(button|select|input|textarea): \S/.test(source[at - 1] ?? '')
      && !(tag[1] === 'input' && FREE_INPUT.test(tagFrom(source, at, tag.index)))) found.push({ rule: 'bare', line: at + 1, text: trimmed });
    if (OFF_RADIUS.test(line)) found.push({ rule: 'radius', line: at + 1, text: trimmed });
    if (HAND_DURATION.test(line) && path !== 'lib/motion.ts') found.push({ rule: 'duration', line: at + 1, text: trimmed });
    return found;
  });
}

/**
 * The rules of LC104–LC116 for one folder (LC117) that the app's guard (`src/styleRules.guard.test.ts`, LC118) does not
 * hold: the folder's files, no local look, `Switch` for on/off, no new window over the content. Bare controls, radii
 * and durations are the app's guard's.
 */
export function guardCommonControls({ name, dir, expected, windows = [], callsAWindow = [], localLooks }: CommonControlsGuard) {
  const DIR = resolve(process.cwd(), 'src', dir);
  const files = (readdirSync(DIR) as string[]).filter((f) => /\.tsx?$/.test(f) && !/\.(test|guard)\.tsx?$/.test(f)).sort();
  const read = (f: string) => readFileSync(join(DIR, f), 'utf8');
  const styled = files.filter((f) => !windows.includes(f) || callsAWindow.includes(f));

  describe(`${name}, the common components`, () => {
    it('reads its files', () => {
      expect(files).toEqual(expect.arrayContaining(expected));
    });

    it('keeps no local button or field look of its own', () => {
      const local = new RegExp(`\\b(${localLooks.join('|')})\\b`);
      expect(styled.filter((f) => local.test(read(f)))).toEqual([]);
    });

    it('draws the on/off settings with `Switch`, not a hand-made track', () => {
      expect(styled.filter((f) => /role="switch"/.test(read(f)))).toEqual([]);
    });

    // L-73: nothing over the content. The windows are today's; no new one comes in.
    it('opens no new window over the content', () => {
      const found = files.filter((f) => /\.tsx$/.test(f) && /(?<!\[)role="dialog"|fixed inset-0|<(Modal|ConfirmDialog|Sheet)\b/.test(read(f)));
      expect(found).toEqual([...windows].sort());
    });
  });
}
