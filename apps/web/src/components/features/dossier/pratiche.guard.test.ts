import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = resolve(process.cwd(), 'src/components/features/dossier');
const files = readdirSync(DIR).filter((name) => /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name));

// LC106: Pratiche speak the common components' language. A bare `<button>` or `<select>` stays only with its reason
// written on the line above (`bare-button: …`), e.g. a list's row that is a whole option, not a button's look.
describe('Pratiche, no bare controls', () => {
  it('draws every button with `Button` or `IconButton` and every menu with `Select`', () => {
    const bare = files.flatMap((name) => {
      const lines = readFileSync(join(DIR, name), 'utf8').split('\n');
      return lines.flatMap((line, at) => {
        if (!/<(button|select)\b/.test(line)) return [];
        return /bare-(button|select): \S/.test(lines[at - 1] ?? '') ? [] : [`${name}:${at + 1}: ${line.trim()}`];
      });
    });
    expect(bare).toEqual([]);
  });

  it('keeps no local button look of its own', () => {
    const local = files.filter((name) => /\b(LIST_MENU|HEADER_PRIMARY|LINK_BUTTON)\b/.test(readFileSync(join(DIR, name), 'utf8')));
    expect(local).toEqual([]);
  });
});
