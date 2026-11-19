import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FEATURES = resolve(process.cwd(), 'src/components/features');
/**
 * The search and the reader: `search/` with its sub-folders (`caseLaw/`), and `practice/`, the reading table where an
 * article, its glosses, its case law and the dossier's «Fonti» are read. Fixtures and tests apart.
 */
const DIRS = ['search', 'practice'];
const files = DIRS.flatMap((dir) => (readdirSync(join(FEATURES, dir), { recursive: true }) as string[])
  .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.includes('__tests__') && !name.includes('__fixtures__'))
  .map((name) => `${dir}/${name}`))
  .sort();
const read = (name: string) => readFileSync(join(FEATURES, name), 'utf8');
/**
 * The windows over the content still here (L-73): their own PRs bring them into the page, so this one leaves them as
 * they are, out of the checks of style below. The glosses' side view is the exception the brief names (its select and
 * its motion), with the report's question it shares with the Forum.
 */
const WINDOWS = [
  'practice/CorpusPracticesDialog.tsx', 'practice/PracticeDossierPicker.tsx',
  'search/ArticleDiscussionPanel.tsx', 'search/BlockAnnotationsSheet.tsx', 'search/NoteComposerSheet.tsx', 'search/NotesPeekPanel.tsx',
  'search/TextAtDateDialog.tsx', 'search/discussionControls.tsx',
];
const STYLED = files.filter((name) => !WINDOWS.includes(name) || ['search/ArticleDiscussionPanel.tsx', 'search/discussionControls.tsx'].includes(name));
const lines = (name: string, pattern: RegExp) => read(name).split('\n').flatMap((line, at) => (pattern.test(line) ? [`${name}:${at + 1}`] : []));

// LC113: the search and the reader speak the common components' language, as Pratiche (LC106), Opus (LC110) and Learn
// (LC112). A bare `<button>`, `<select>` or `<input>` stays only with its reason written on the line above
// (`bare-button: …`): a row that is a whole option, a mark in the text, a checkbox, a colour swatch.
describe('Search and reader, no bare controls', () => {
  it('reads the sub-folders and the reader too', () => {
    expect(files).toEqual(expect.arrayContaining(['search/caseLaw/CaseLawRow.tsx', 'search/CommandPalette.tsx', 'practice/PracticeRowShell.tsx']));
  });

  it('draws every button with `Button` or `IconButton`, every menu with `Select`, every field with `Input`', () => {
    const bare = STYLED.flatMap((name) => {
      const source = read(name).split('\n');
      return source.flatMap((line, at) => {
        if (!/<(button|select|input|motion\.button)\b/.test(line)) return [];
        return /bare-(button|select|input): \S/.test(source[at - 1] ?? '') ? [] : [`${name}:${at + 1}: ${line.trim()}`];
      });
    });
    expect(bare).toEqual([]);
  });

  it('keeps no local button or field look of its own', () => {
    const local = STYLED.filter((name) => /\b(ACTION|LINK|FIELD_INPUT|SMALL_INPUT|ICON_BUTTON|QUIET_BUTTON|TOOL_BUTTON|ADD_BUTTON|REMOVE_BUTTON|SCOPE_BUTTON|TOOL_LINK)\b/.test(read(name)));
    expect(local).toEqual([]);
  });

  // The consultant's rule (LC106): 4 px for what is pressed or typed in (`CONTROL_RADIUS`), 8 px for what holds things
  // (`Card`, `CARD_RADIUS`); the 6, 10 and 16 px of before are gone.
  it('rounds its boxes at 8 px and its controls at 4, none at 6, 10 or 16', () => {
    expect(STYLED.flatMap((name) => lines(name, /\brounded-(t-|b-|l-|r-)?(lg|xl|2xl|3xl)\b/))).toEqual([]);
  });

  // Tailwind's `duration-*`, Framer's seconds (`duration: 0.18`) and Web Animations' milliseconds (`duration: 150`):
  // the motion tokens (`--dur-*`, `lib/motion.ts`) or the components' own. A notice's time on screen (`duration: 4000`, or 0 to stay) is no motion.
  it('writes no duration by hand', () => {
    expect(STYLED.flatMap((name) => lines(name, /\bduration-(\d|\[)|\bduration: *(0?\.\d|[1-9]\d{0,2}\b)/))).toEqual([]);
  });

  // L-73: nothing over the content. The windows are today's; no new one comes in.
  it('opens no new window over the content', () => {
    const windows = files.filter((name) => /\.tsx$/.test(name) && /(?<!\[)role="dialog"|fixed inset-0|<(Modal|ConfirmDialog|Sheet)\b/.test(read(name)));
    expect(windows).toEqual([...WINDOWS].sort());
  });
});
