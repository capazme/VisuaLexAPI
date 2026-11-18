import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = resolve(process.cwd(), 'src/components/features/planner');
const files = readdirSync(DIR).filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name));
const read = (name: string) => readFileSync(join(DIR, name), 'utf8');

// LC110: Opus speaks the common components' language, as Pratiche (LC106). A bare `<button>` or `<select>` stays only
// with its reason written on the line above (`bare-button: …`): a row's title, a day of the strip, a chip.
describe('Opus, no bare controls', () => {
  it('draws every button with `Button` or `IconButton` and every menu with `Select`', () => {
    const bare = files.flatMap((name) => {
      const lines = read(name).split('\n');
      return lines.flatMap((line, at) => {
        if (!/<(button|select)\b/.test(line)) return [];
        return /bare-(button|select): \S/.test(lines[at - 1] ?? '') ? [] : [`${name}:${at + 1}: ${line.trim()}`];
      });
    });
    expect(bare).toEqual([]);
  });

  it('keeps no local button or field look of its own', () => {
    const local = files.filter((name) => /\b(FIELD|FIELD_HINT|ICON_BUTTON|INK_BUTTON|SECONDARY_BUTTON|QUIET_BUTTON)\b/.test(read(name)));
    expect(local).toEqual([]);
  });

  it('writes no duration by hand: the motion tokens (`--dur-*`) or the components\' own', () => {
    const timed = files.flatMap((name) => read(name).split('\n').flatMap((line, at) => (/\bduration-(\d|\[)/.test(line) ? [`${name}:${at + 1}`] : [])));
    expect(timed).toEqual([]);
  });
});
