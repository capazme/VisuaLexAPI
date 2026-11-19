import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = resolve(process.cwd(), 'src/components/features/planner');
const files = readdirSync(DIR).filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name));
const read = (name: string) => readFileSync(join(DIR, name), 'utf8');

// LC110: Opus speaks the common components' language, as Pratiche (LC106); its bare controls, radii and durations are
// the app's guard's (LC118).
describe('Opus, the common components', () => {
  it('keeps no local button or field look of its own', () => {
    const local = files.filter((name) => /\b(FIELD|FIELD_HINT|ICON_BUTTON|INK_BUTTON|SECONDARY_BUTTON|QUIET_BUTTON)\b/.test(read(name)));
    expect(local).toEqual([]);
  });
});
