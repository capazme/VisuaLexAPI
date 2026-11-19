import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = resolve(process.cwd(), 'src/components/features/bulletin');
/** The Forum: «Dossier pubblici» and the Community. Fixtures and tests apart. */
const files = (readdirSync(DIR) as string[]).filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)).sort();
const read = (name: string) => readFileSync(join(DIR, name), 'utf8');
/**
 * The windows over the content still here (L-73): their own PRs bring them into the page, so this one leaves them as
 * they are, out of the checks of style below. `ArchivedEnvironmentsSection` (its deletion's question) and
 * `SharedLinkImport` (an old link's import) are parts of the page that call one: they stay in the checks.
 */
const WINDOWS = [
  'AddItemsDialog.tsx', 'AliasConflictDialog.tsx', 'ArchivedEnvironmentsSection.tsx', 'EditSuggestionDialog.tsx',
  'PublishDossierPicker.tsx', 'ReportModal.tsx', 'SharedLinkImport.tsx', 'StudyImportDialog.tsx', 'SuggestionReviewDialog.tsx', 'VersionHistoryModal.tsx',
];
const CALLS_A_DIALOG = ['ArchivedEnvironmentsSection.tsx', 'SharedLinkImport.tsx'];
const STYLED = files.filter((name) => !WINDOWS.includes(name) || CALLS_A_DIALOG.includes(name));
const lines = (name: string, pattern: RegExp) => read(name).split('\n').flatMap((line, at) => (pattern.test(line) ? [`${name}:${at + 1}`] : []));

// LC114: the Forum speaks the common components' language, as Pratiche (LC106), Opus (LC110), Learn (LC112) and the
// reader (LC113). A bare `<button>`, `<select>` or `<input>` stays only with its reason written on the line above
// (`bare-button: …`): a row that is a whole option, a checkbox.
describe('Forum, no bare controls', () => {
  it('reads the Forum and the Community', () => {
    expect(files).toEqual(expect.arrayContaining(['ForumExploreView.tsx', 'CommunityThreadView.tsx', 'SuggestContentPanel.tsx']));
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
    const local = STYLED.filter((name) => /\b(FILTER_BUTTON|INPUT|ACTION|LINK)\b/.test(read(name)));
    expect(local).toEqual([]);
  });

  // 4 px for what is pressed or typed in (`CONTROL_RADIUS`), 8 px for what holds things (`CARD_RADIUS`).
  it('rounds its boxes at 8 px and its controls at 4, none at 6, 10 or 16', () => {
    expect(STYLED.flatMap((name) => lines(name, /\brounded-(t-|b-|l-|r-)?(lg|xl|2xl|3xl)\b/))).toEqual([]);
  });

  // Tailwind's `duration-*`, Framer's seconds and Web Animations' milliseconds: the motion tokens (`--dur-*`,
  // `lib/motion.ts`) or the components' own. A notice's time on screen (`duration: 4000`) is no motion.
  it('writes no duration by hand', () => {
    expect(STYLED.flatMap((name) => lines(name, /\bduration-(\d|\[)|\bduration: *(0?\.\d|[1-9]\d{0,2}\b)/))).toEqual([]);
  });

  // L-73: nothing over the content. The windows are today's; no new one comes in.
  it('opens no new window over the content', () => {
    const windows = files.filter((name) => /\.tsx$/.test(name) && /(?<!\[)role="dialog"|fixed inset-0|<(Modal|ConfirmDialog|Sheet)\b/.test(read(name)));
    expect(windows).toEqual([...WINDOWS].sort());
  });
});
